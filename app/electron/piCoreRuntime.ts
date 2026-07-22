import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const vendorCandidates = [
  process.env.SUBAGENTS_PI_VENDOR_DIR,
  join(process.cwd(), 'vendor/pi'),
  join(process.cwd(), '../vendor/pi'),
].filter((candidate): candidate is string => Boolean(candidate))
const vendorDir = vendorCandidates.find((candidate) => existsSync(join(candidate, 'packages/coding-agent/dist/index.js'))) || vendorCandidates[0]
if (!vendorDir) throw new Error('Vendored Pi Core directory is not configured')
const piCodingAgent = await import(/* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/index.js')).href)
const piConfig = await import(/* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/config.js')).href)

type PiSessionRuntime = {
  sessionManager: {
    appendMessage: (message: unknown) => string
    getEntries: () => unknown[]
    getSessionFile: () => string | undefined
  }
  session: {
    prompt: (prompt: string) => Promise<void>
    abort?: () => Promise<void> | void
    subscribe: (listener: (event: { type?: string; [key: string]: unknown }) => void) => () => void
    dispose?: () => Promise<void> | void
  }
}
export type PiHostHistoryMessage = { role: 'user' | 'assistant'; content: string }
const sessionRuntimes = new Map<string, PiSessionRuntime>()
const activeTurns = new Map<string, { session: PiSessionRuntime['session']; cancelled: boolean }>()
const activeToolRuns = new Map<string, { controller: AbortController; cancelled: boolean }>()

const TOOL_FACTORIES = {
  bash: piCodingAgent.createBashToolDefinition,
  edit: piCodingAgent.createEditToolDefinition,
  find: piCodingAgent.createFindToolDefinition,
  grep: piCodingAgent.createGrepToolDefinition,
  ls: piCodingAgent.createLsToolDefinition,
  read: piCodingAgent.createReadToolDefinition,
  write: piCodingAgent.createWriteToolDefinition,
}

export type PiBuiltinToolName = keyof typeof TOOL_FACTORIES

export function piCoreRuntimeStatus() {
  return {
    loaded: Object.values(TOOL_FACTORIES).every((factory) => typeof factory === 'function'),
    package: piConfig.PACKAGE_NAME,
    version: piConfig.VERSION,
    builtinTools: Object.keys(TOOL_FACTORIES).sort(),
  }
}

export async function executePiRead(cwd: string, args: { path: string; offset?: number; limit?: number }) {
  return executePiTool('read', cwd, args)
}

export async function executePiTool(
  toolName: PiBuiltinToolName,
  cwd: string,
  args: Record<string, unknown>,
  options: { runId?: string; onUpdate?: (update: unknown) => void } = {},
) {
  const factory = TOOL_FACTORIES[toolName]
  if (typeof factory !== 'function') throw new Error(`Pi builtin tool is unavailable: ${toolName}`)
  const tool = factory(cwd)
  const controller = new AbortController()
  const active = options.runId ? { controller, cancelled: false } : undefined
  if (options.runId && active) activeToolRuns.set(options.runId, active)
  try {
    const result = await tool.execute(`pi-host-${toolName}`, args, controller.signal, options.onUpdate, undefined)
    return active?.cancelled ? { content: [], cancelled: true } : result
  } catch (error) {
    if (active?.cancelled) return { content: [], cancelled: true }
    throw error
  } finally {
    if (options.runId) activeToolRuns.delete(options.runId)
  }
}

async function ensurePiSessionRuntime(sessionId: string, cwd: string, history: PiHostHistoryMessage[], sessionFile?: string) {
  const existing = sessionRuntimes.get(sessionId)
  if (existing) return existing
  const agentDir = process.env.SUBAGENTS_PI_AGENT_DIR
  const sessionDir = agentDir ? join(agentDir, 'sessions') : undefined
  const sessionManager = sessionFile
    ? piCodingAgent.SessionManager.open(sessionFile, sessionDir, cwd)
    : piCodingAgent.SessionManager.create(cwd, sessionDir, { id: sessionId })
  if (sessionManager.getEntries().length === 0) {
    for (const message of history) {
      if (message.role === 'user') {
        sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: message.content }], timestamp: Date.now() })
      } else {
        sessionManager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text: message.content }],
          api: 'openai-completions',
          provider: 'restored',
          model: 'restored',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: Date.now(),
        })
      }
    }
  }
  const options: Record<string, unknown> = {
    cwd,
    sessionManager,
  }
  if (agentDir) options.agentDir = agentDir
  const created = await piCodingAgent.createAgentSession(options)
  const runtime = { sessionManager, session: created.session } as PiSessionRuntime
  sessionRuntimes.set(sessionId, runtime)
  return runtime
}

export async function runPiTurn(
  sessionId: string,
  cwd: string,
  prompt: string,
  history: PiHostHistoryMessage[] = [],
  onEvent?: (event: { type?: string; [key: string]: unknown }) => void,
  runId?: string,
  sessionFile?: string,
) {
  const runtime = await ensurePiSessionRuntime(sessionId, cwd, history, sessionFile)
  const turn = { session: runtime.session, cancelled: false }
  if (runId) activeTurns.set(runId, turn)
  let completedMessages: Array<{ role?: string; content?: unknown }> = []
  const unsubscribe = runtime.session.subscribe((event) => {
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      completedMessages = event.messages as Array<{ role?: string; content?: unknown }>
    }
    onEvent?.(event)
  })
  try {
    await runtime.session.prompt(prompt)
    if (turn.cancelled) return { settlement: 'cancelled' as const, items: [] }
    return {
      settlement: 'success' as const,
      items: completedMessages
        .filter((message) => message.role === 'assistant')
        .map((message) => ({
          type: 'assistant_message',
          content: Array.isArray(message.content)
            ? message.content.filter((part): part is { type: string; text: string } => Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')).map((part) => part.text).join('')
            : typeof message.content === 'string' ? message.content : '',
          message,
        })),
    }
  } catch (error) {
    if (turn.cancelled) return { settlement: 'cancelled' as const, items: [] }
    return {
      settlement: 'failed' as const,
      items: [{ type: 'error', content: error instanceof Error ? error.message : 'Pi turn failed' }],
    }
  } finally {
    unsubscribe()
    if (runId) activeTurns.delete(runId)
  }
}

export function getPiSessionFile(sessionId: string) {
  return sessionRuntimes.get(sessionId)?.sessionManager.getSessionFile()
}

export async function cancelPiTurn(runId: string) {
  const turn = activeTurns.get(runId)
  if (!turn) return false
  turn.cancelled = true
  await turn.session.abort?.()
  return true
}

export function cancelPiTool(runId: string) {
  const tool = activeToolRuns.get(runId)
  if (!tool) return false
  tool.cancelled = true
  tool.controller.abort()
  return true
}
