import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { PiThinkingLevel } from './piAgentProfile.ts'
import { resolvePiAgentDir } from './piUserConfig.ts'

const vendorCandidates = [
  process.env.SUBAGENTS_PI_VENDOR_DIR,
  join(process.cwd(), 'vendor/pi'),
  join(process.cwd(), '../vendor/pi'),
].filter((candidate): candidate is string => Boolean(candidate))
const vendorDir = vendorCandidates.find((candidate) => existsSync(join(candidate, 'packages/coding-agent/dist/index.js'))) || vendorCandidates[0]
if (!vendorDir) throw new Error('Vendored Pi Core directory is not configured')
const piCodingAgent = await import(/* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/index.js')).href)
const piConfig = await import(/* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/config.js')).href)
const piAuthStorage = await import(
  /* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/core/auth-storage.js')).href
) as {
  AuthStorage: {
    create: (authPath: string) => {
      modify: (
        provider: string,
        update: (current: unknown) => Promise<{ type: 'api_key'; key: string }>,
      ) => Promise<unknown>
    }
  }
}

type PiSessionRuntime = {
  activeToolsKey: string
  contextWindowTokens?: number
  requestContext?: { value: string; includeHistory: boolean }
  sessionManager: {
    appendMessage: (message: unknown) => string
    getEntries: () => unknown[]
    getSessionFile: () => string | undefined
  }
  session: {
    prompt: (prompt: string) => Promise<void>
    steer?: (message: string) => Promise<void> | void
    followUp?: (message: string) => Promise<void> | void
    abort?: () => Promise<void> | void
    subscribe: (listener: (event: { type?: string; [key: string]: unknown }) => void) => () => void
    dispose?: () => Promise<void> | void
  }
}
export type PiHostHistoryMessage = { role: 'user' | 'assistant'; content: string }
const sessionRuntimes = new Map<string, PiSessionRuntime>()
const activeTurns = new Map<string, { session?: PiSessionRuntime['session']; cancelled: boolean }>()
const activeToolRuns = new Map<string, Set<{ controller: AbortController; cancelled: boolean }>>()

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
  if (options.runId && active) {
    const runs = activeToolRuns.get(options.runId) || new Set<{ controller: AbortController; cancelled: boolean }>()
    runs.add(active)
    activeToolRuns.set(options.runId, runs)
  }
  try {
    const result = await tool.execute(`pi-host-${toolName}`, args, controller.signal, options.onUpdate, undefined)
    return active?.cancelled ? { content: [], cancelled: true } : result
  } catch (error) {
    if (active?.cancelled) return { content: [], cancelled: true }
    throw error
  } finally {
    if (options.runId && active) {
      const runs = activeToolRuns.get(options.runId)
      runs?.delete(active)
      if (runs?.size === 0) activeToolRuns.delete(options.runId)
    }
  }
}

export type PiRuntimeSettings = {
  provider?: string
  model?: string
  thinkingLevel?: PiThinkingLevel
  activeTools?: string[]
}

export type PiLegacyModelConfig = {
  provider: string
  model: string
  baseUrl: string
}

/** Official endpoints that let Pi register models newer than its vendored catalog. */
export function piProviderDefaultBaseUrl(provider: string): string | undefined {
  if (provider.trim().toLowerCase() === 'openrouter') return 'https://openrouter.ai/api/v1'
  return undefined
}

/** Merge a legacy OpenAI-compatible endpoint into Pi's credential-blind models config. */
export function mergePiLegacyModelConfig(input: unknown, patch: PiLegacyModelConfig): Record<string, unknown> {
  const root = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const providerMap = root.providers && typeof root.providers === 'object' && !Array.isArray(root.providers)
    ? root.providers as Record<string, unknown>
    : {}
  const previous = providerMap[patch.provider] && typeof providerMap[patch.provider] === 'object' && !Array.isArray(providerMap[patch.provider])
    ? providerMap[patch.provider] as Record<string, unknown>
    : {}
  const previousModels = Array.isArray(previous.models)
    ? previous.models.filter((model): model is Record<string, unknown> => Boolean(model && typeof model === 'object' && !Array.isArray(model)))
    : []
  const existingModel = previousModels.find((model) => model.id === patch.model) || {}
  const model = {
    ...existingModel,
    id: patch.model,
    name: typeof existingModel.name === 'string' && existingModel.name ? existingModel.name : patch.model,
    api: 'openai-completions',
    baseUrl: patch.baseUrl,
  }
  const models = [...previousModels.filter((candidate) => candidate.id !== patch.model), model]
  return {
    ...root,
    providers: {
      ...providerMap,
      [patch.provider]: {
        ...previous,
        api: 'openai-completions',
        baseUrl: patch.baseUrl,
        models,
      },
    },
  }
}

/** Persist a legacy custom endpoint without placing credentials in models.json. */
export async function persistPiLegacyModelConfig(patch: PiLegacyModelConfig | null): Promise<boolean> {
  const agentDir = resolvePiAgentDir()
  if (!patch || !agentDir || !patch.provider.trim() || !patch.model.trim() || !patch.baseUrl.trim()) return false
  const modelsPath = join(agentDir, 'models.json')
  let existing: unknown = {}
  try {
    existing = JSON.parse(await readFile(modelsPath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const merged = mergePiLegacyModelConfig(existing, {
    provider: patch.provider.trim(),
    model: patch.model.trim(),
    baseUrl: patch.baseUrl.trim(),
  })
  await mkdir(agentDir, { recursive: true })
  const temporaryPath = `${modelsPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, modelsPath)
  return true
}

/** Import the one legacy API key into Pi's main-process auth.json. */
export async function persistPiLegacyCredential(provider: string, apiKey: string): Promise<void> {
  const agentDir = resolvePiAgentDir()
  if (!agentDir || !provider.trim() || !apiKey.trim()) return
  const authStorage = piAuthStorage.AuthStorage.create(join(agentDir, 'auth.json'))
  await authStorage.modify(
    provider.trim(),
    async () => ({ type: 'api_key', key: apiKey.trim() }),
  )
}

async function ensurePiSessionRuntime(sessionId: string, cwd: string, history: PiHostHistoryMessage[], sessionFile?: string, settings: PiRuntimeSettings = {}) {
  const existing = sessionRuntimes.get(sessionId)
  const activeToolsKey = JSON.stringify(settings)
  if (existing && existing.activeToolsKey === activeToolsKey) return existing
  const agentDir = resolvePiAgentDir()
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
  let contextWindowTokens: number | undefined
  const requestContext = { value: '', includeHistory: true }
  if (agentDir && typeof piCodingAgent.DefaultResourceLoader === 'function') {
    const resourceLoader = new piCodingAgent.DefaultResourceLoader({
      cwd,
      agentDir,
      extensionFactories: [{
        name: 'subagents-session-context',
        hidden: true,
        factory: (pi: { on: (event: string, handler: (input: Record<string, unknown>) => unknown) => void }) => {
          pi.on('before_agent_start', (event) => requestContext.value && typeof event.systemPrompt === 'string'
            ? { systemPrompt: `${event.systemPrompt}\n\n${requestContext.value}` }
            : undefined)
          pi.on('context', (event) => {
            if (requestContext.includeHistory || !Array.isArray(event.messages)) return undefined
            let lastUser = -1
            for (let index = event.messages.length - 1; index >= 0; index -= 1) {
              const message = event.messages[index]
              if (message && typeof message === 'object' && (message as { role?: unknown }).role === 'user') {
                lastUser = index
                break
              }
            }
            return lastUser >= 0 ? { messages: event.messages.slice(lastUser) } : undefined
          })
        },
      }],
    })
    await resourceLoader.reload()
    options.resourceLoader = resourceLoader
  }
  if (settings.activeTools?.length) options.tools = [...settings.activeTools]
  if (settings.thinkingLevel) options.thinkingLevel = settings.thinkingLevel
  if (agentDir) options.agentDir = agentDir
  if (settings.provider && settings.model && typeof piCodingAgent.ModelRuntime?.create === 'function') {
    const modelRuntime = await piCodingAgent.ModelRuntime.create({
      authPath: agentDir ? join(agentDir, 'auth.json') : undefined,
      modelsPath: agentDir ? join(agentDir, 'models.json') : undefined,
    })
    const model = modelRuntime.getModel(settings.provider, settings.model)
    if (!model) throw new Error(`Pi model is not configured: ${settings.provider}/${settings.model}`)
    options.modelRuntime = modelRuntime
    options.model = model
    contextWindowTokens = model.contextWindow
  }
  const created = await piCodingAgent.createAgentSession(options)
  const runtime = {
    activeToolsKey,
    sessionManager,
    session: created.session,
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(options.resourceLoader ? { requestContext } : {}),
  } as PiSessionRuntime
  if (existing) await existing.session.dispose?.()
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
  settings: PiRuntimeSettings = {},
  requestContext = '',
  referenceChatHistory = true,
  onRuntimeReady?: (contextWindowTokens?: number) => void,
) {
  const turn: { session?: PiSessionRuntime['session']; cancelled: boolean } = { cancelled: false }
  if (runId) {
    if (activeTurns.has(runId)) throw new Error(`Pi run is already active: ${runId}`)
    activeTurns.set(runId, turn)
  }
  let runtime: PiSessionRuntime
  try {
    runtime = await ensurePiSessionRuntime(sessionId, cwd, history, sessionFile, settings)
  } catch (error) {
    if (runId) activeTurns.delete(runId)
    throw error
  }
  turn.session = runtime.session
  if (turn.cancelled) {
    if (runId) activeTurns.delete(runId)
    return { settlement: 'cancelled' as const, items: [] }
  }
  try {
    onRuntimeReady?.(runtime.contextWindowTokens)
  } catch (error) {
    if (runId) activeTurns.delete(runId)
    throw error
  }
  let completedMessages: Array<{ role?: string; content?: unknown }> = []
  const unsubscribe = runtime.session.subscribe((event) => {
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      completedMessages = event.messages as Array<{ role?: string; content?: unknown }>
    }
    onEvent?.(event)
  })
  try {
    if (runtime.requestContext) {
      runtime.requestContext.value = requestContext
      runtime.requestContext.includeHistory = referenceChatHistory
    }
    await runtime.session.prompt(runtime.requestContext || !requestContext ? prompt : `${requestContext}\n## Current request\n${prompt}`)
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
    if (runtime.requestContext) {
      runtime.requestContext.value = ''
      runtime.requestContext.includeHistory = true
    }
    unsubscribe()
    if (runId) activeTurns.delete(runId)
  }
}

export function getPiSessionFile(sessionId: string) {
  return sessionRuntimes.get(sessionId)?.sessionManager.getSessionFile()
}

export function forkPiSession(sessionId: string) {
  const runtime = sessionRuntimes.get(sessionId)
  if (!runtime) return undefined
  const leafId = (runtime.sessionManager as { getLeafId?: () => string | null }).getLeafId?.()
  if (!leafId) return undefined
  return (runtime.sessionManager as { createBranchedSession?: (id: string) => string | undefined }).createBranchedSession?.(leafId)
}

export async function disposePiSession(sessionId: string) {
  const runtime = sessionRuntimes.get(sessionId)
  if (!runtime) return
  await runtime.session.dispose?.()
  sessionRuntimes.delete(sessionId)
}

export function compactPiSession(
  sessionId: string,
  keepMessages = 4,
  summary = 'Pi Host compacted the conversation while preserving the recent message window.',
) {
  const runtime = sessionRuntimes.get(sessionId)
  if (!runtime) return false
  const entries = runtime.sessionManager.getEntries() as Array<{ type?: string; id?: string }>
  const messages = entries.filter((entry) => entry.type === 'message' && entry.id)
  if (messages.length <= keepMessages) return false
  const firstKeptEntryId = messages[messages.length - keepMessages]?.id
  if (!firstKeptEntryId) return false
  ;(runtime.sessionManager as { appendCompaction?: (summary: string, firstKeptEntryId: string, tokensBefore: number) => string }).appendCompaction?.(
    summary,
    firstKeptEntryId,
    messages.length,
  )
  return true
}

export async function cancelPiTurn(runId: string) {
  const turn = activeTurns.get(runId)
  if (!turn) return false
  turn.cancelled = true
  await turn.session?.abort?.()
  return true
}

export function steerPiTurn(sessionId: string, prompt: string): boolean {
  const runtime = sessionRuntimes.get(sessionId)
  if (!runtime?.session.steer) return false
  void runtime.session.steer(prompt)
  return true
}

export function followUpPiTurn(sessionId: string, prompt: string): boolean {
  const runtime = sessionRuntimes.get(sessionId)
  if (!runtime?.session.followUp) return false
  void runtime.session.followUp(prompt)
  return true
}

export function cancelPiTool(runId: string) {
  const runs = activeToolRuns.get(runId)
  if (!runs || runs.size === 0) return false
  for (const tool of runs) {
    tool.cancelled = true
    tool.controller.abort()
  }
  return true
}
