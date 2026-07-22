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
  session: {
    prompt: (prompt: string) => Promise<void>
    subscribe: (listener: (event: { type?: string; [key: string]: unknown }) => void) => () => void
    dispose?: () => Promise<void> | void
  }
}
export type PiHostHistoryMessage = { role: 'user' | 'assistant'; content: string }
const sessionRuntimes = new Map<string, PiSessionRuntime>()

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

export async function executePiTool(toolName: PiBuiltinToolName, cwd: string, args: Record<string, unknown>) {
  const factory = TOOL_FACTORIES[toolName]
  if (typeof factory !== 'function') throw new Error(`Pi builtin tool is unavailable: ${toolName}`)
  const tool = factory(cwd)
  return tool.execute(`pi-host-${toolName}`, args, undefined, undefined, undefined)
}

async function ensurePiSessionRuntime(sessionId: string, cwd: string, history: PiHostHistoryMessage[]) {
  const existing = sessionRuntimes.get(sessionId)
  if (existing) return existing
  const sessionManager = piCodingAgent.SessionManager.inMemory(cwd)
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
  const options: Record<string, unknown> = {
    cwd,
    noTools: 'all',
    sessionManager,
  }
  if (process.env.SUBAGENTS_PI_AGENT_DIR) options.agentDir = process.env.SUBAGENTS_PI_AGENT_DIR
  const created = await piCodingAgent.createAgentSession(options)
  const runtime = { session: created.session } as PiSessionRuntime
  sessionRuntimes.set(sessionId, runtime)
  return runtime
}

export async function runPiTurn(
  sessionId: string,
  cwd: string,
  prompt: string,
  history: PiHostHistoryMessage[] = [],
  onEvent?: (event: { type?: string; [key: string]: unknown }) => void,
) {
  const runtime = await ensurePiSessionRuntime(sessionId, cwd, history)
  let completedMessages: Array<{ role?: string; content?: unknown }> = []
  const unsubscribe = runtime.session.subscribe((event) => {
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      completedMessages = event.messages as Array<{ role?: string; content?: unknown }>
    }
    onEvent?.(event)
  })
  try {
    await runtime.session.prompt(prompt)
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
    return {
      settlement: 'failed' as const,
      items: [{ type: 'error', content: error instanceof Error ? error.message : 'Pi turn failed' }],
    }
  } finally {
    unsubscribe()
  }
}
