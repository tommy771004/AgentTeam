import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { PiThinkingLevel } from './piAgentProfile.ts'
import { resolvePiAgentDir } from './piUserConfig.ts'
import { classifyPiTurnSettlement, piTurnProviderError, piTurnStopReason, PI_TURN_TRUNCATED_NOTICE } from '../src/agent/piHostRun.ts'
import { reducePiStepUsage, type PiReportedMessage } from '../src/agent/piStepUsage.ts'
import type { PiRecordedMessage, PiStepTiming } from '../src/agent/turnRecord.ts'
import { ensurePiPacksRegistered } from './piExtensionPacks/index.ts'
import { piPackExtensionFactories } from './piToolHost.ts'
import { buildPinnedPiSkillsPromptBlock, captureDiscoveredPiSkills, snapshotPiSkillResources } from './piSkills.ts'
import { piCodingAgentModule as piCodingAgent, piVendorDir } from './piVendor.ts'
import { SUBSCRIPTION_PROVIDERS, type SubscriptionModelInfo, type SubscriptionProviderId } from '../src/agent/subscriptionCatalog.ts'
import { bindPiSessionSkillResourceView, piActivePackToolNames, piAllPackToolNames, piBashGateExtensionFactory, registerPiPackSession, unregisterPiPackSession } from './piToolHost.ts'
import { buildPiMcpDynamicPacks } from './piExtensionPacks/mcpBridgePack.ts'

const vendorDir = piVendorDir
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
  skillSnapshotRoot?: string
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
export type PiHostHistoryMessage = PiRecordedMessage
/** Why a turn stopped short of its own settlement. */
export type PiTurnInterruptReason = 'user' | 'timeout'

/**
 * One in-flight turn.
 *
 * `cancelled` is the hard teardown (abort now, kill in-flight tools).
 * `interrupt` is the safe park: the request is remembered and the session is
 * aborted only once no tool is mid-execution, so a write or a shell command
 * that already started is allowed to finish and report its evidence instead of
 * being severed halfway.
 */
type PiActiveTurn = {
  session?: PiSessionRuntime['session']
  cancelled: boolean
  interrupt?: PiTurnInterruptReason
  toolsInFlight: number
  parked: boolean
}

const sessionRuntimes = new Map<string, PiSessionRuntime>()
const activeTurns = new Map<string, PiActiveTurn>()
const activeToolRuns = new Map<string, Set<{ controller: AbortController; cancelled: boolean }>>()
/** A cancelled run id is a permanent tombstone; late calls may never succeed. */
const cancelledToolRuns = new Set<string>()

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

/**
 * Host-owned compact facts for the catalog projection.  The turn contract is
 * still captured from the live Pi session; this helper only supplies the
 * descriptions and schemas needed before a Settings page has a turn-bound
 * session to inspect.
 */
export function piCoreRuntimeToolCatalog(cwd = process.cwd()): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return Object.entries(TOOL_FACTORIES).map(([name, factory]) => {
    try {
      const definition = factory(cwd) as { description?: unknown; parameters?: unknown }
      return {
        name,
        description: typeof definition.description === 'string' ? definition.description : `Pi builtin ${name}`,
        parameters: definition.parameters && typeof definition.parameters === 'object' && !Array.isArray(definition.parameters)
          ? definition.parameters as Record<string, unknown>
          : {},
      }
    } catch {
      return { name, description: `Pi builtin ${name}`, parameters: {} }
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
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
  if (options.runId && cancelledToolRuns.has(options.runId)) return { content: [], cancelled: true }
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
  /** Temporary chats read no memory and write none; pack tools honour it too. */
  temporaryChat?: boolean
  /** Capability ids preloaded for this turn (per-thread prefs ride in from the renderer). */
  preloadedCapabilities?: string[]
  /** Tools unlocked by loaded capabilities; the active set unions them in. */
  unlockedTools?: string[]
  /** MCP registry generation frozen at Host turn admission. */
  mcpGenerationKey?: string
  /** Owning capability was already loaded when this turn was admitted. */
  mcpCapabilityActive?: boolean
}

export type PiLegacyModelConfig = {
  provider: string
  model: string
  baseUrl: string
}

/**
 * The ModelRuntime view of each subscription provider's model catalog
 * (ADR-0052 ticket 02). Built with the SAME auth/models files a session uses,
 * so what the catalog claims is exactly what a run would see. One provider's
 * failure never blanks the others: errors surface as per-provider reason
 * strings and the projection renders them honestly unavailable.
 */
export async function buildPiSubscriptionModelView(): Promise<{
  models: Partial<Record<SubscriptionProviderId, SubscriptionModelInfo[]>>
  errors: Partial<Record<SubscriptionProviderId, string>>
}> {
  const agentDir = resolvePiAgentDir()
  if (!agentDir) {
    return {
      models: {},
      errors: Object.fromEntries(SUBSCRIPTION_PROVIDERS.map((id) => [id, 'Pi agent 目錄不可用；無法列舉訂閱模型。'])),
    }
  }
  let getModels: (providerId?: string) => ReadonlyArray<{
    id?: unknown
    name?: unknown
    contextWindow?: unknown
    reasoning?: unknown
  }>
  try {
    if (typeof piCodingAgent?.ModelRuntime?.create !== 'function') {
      throw new Error('vendored Pi ModelRuntime unavailable')
    }
    const runtime = await piCodingAgent.ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    })
    if (typeof runtime?.getModels !== 'function') throw new Error('ModelRuntime.getModels unavailable')
    getModels = (providerId?: string) => runtime.getModels(providerId)
  } catch (error) {
    const reason = `訂閱模型目錄建構失敗：${error instanceof Error ? error.message : String(error)}`
    return { models: {}, errors: Object.fromEntries(SUBSCRIPTION_PROVIDERS.map((id) => [id, reason])) }
  }
  const models: Partial<Record<SubscriptionProviderId, SubscriptionModelInfo[]>> = {}
  const errors: Partial<Record<SubscriptionProviderId, string>> = {}
  for (const id of SUBSCRIPTION_PROVIDERS) {
    try {
      const projected: SubscriptionModelInfo[] = []
      for (const raw of getModels(id) || []) {
        if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue
        projected.push({
          id: raw.id,
          ...(typeof raw.name === 'string' && raw.name ? { label: raw.name } : {}),
          ...(typeof raw.contextWindow === 'number' && Number.isFinite(raw.contextWindow)
            ? { contextWindow: raw.contextWindow }
            : {}),
          ...(raw.reasoning === true ? { reasoning: true } : {}),
        })
      }
      models[id] = projected
    } catch (error) {
      errors[id] = `模型列舉失敗：${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { models, errors }
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
  const agentDir = resolvePiAgentDir()
  const skillSnapshot = await snapshotPiSkillResources(agentDir, sessionId)
  const activeToolsKey = JSON.stringify({ settings, cwd, skillSnapshotDigest: skillSnapshot?.digest })
  if (skillSnapshot) bindPiSessionSkillResourceView(sessionId, skillSnapshot)
  if (existing && existing.activeToolsKey === activeToolsKey) return existing
  try {
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
  const piSkillsDir = skillSnapshot?.root
  const mcpDynamic = await buildPiMcpDynamicPacks()
  if (agentDir && typeof piCodingAgent.DefaultResourceLoader === 'function') {
    // The pack factories register the SubAgents extension tools next to the
    // hidden session-context factory, so the model sees one tool catalog
    // owned by the Host (issue 01). `additionalSkillPaths` points the same
    // loader at the Host-owned skills directory (issue 02).
    ensurePiPacksRegistered()
    const resourceLoader = new piCodingAgent.DefaultResourceLoader({
      cwd,
      agentDir,
      // Default global/project discovery points at mutable source files.
      // Only the Host-created frozen snapshot may be advertised this turn.
      noSkills: true,
      additionalSkillPaths: piSkillsDir ? [piSkillsDir] : undefined,
      extensionFactories: [
        ...piPackExtensionFactories({ sessionId, cwd, temporaryChat: settings.temporaryChat }, mcpDynamic.packs),
        // ADR-0047: builtin shell stays outside the external-CLI sandbox and
        // fail-closed under Outbound Guard `required` — enforced here where
        // in-turn bash actually executes.
        piBashGateExtensionFactory({ sessionId }),
        // Pinned skills expand up front (issue 16): the same files the loader
        // discovered, read into the system prompt before the agent starts.
        {
          name: 'subagents-pinned-skills',
          hidden: true,
          factory: (pi: { on: (event: string, handler: (input: Record<string, unknown>) => unknown) => void }) => {
            pi.on('before_agent_start', async (event) => {
              const block = await buildPinnedPiSkillsPromptBlock(agentDir, piSkillsDir)
              if (!block || typeof event.systemPrompt !== 'string') return undefined
              return { systemPrompt: `${event.systemPrompt}\n\n${block}` }
            })
          },
        },
        {
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
      },
      ],
    })
    await resourceLoader.reload()
    options.resourceLoader = resourceLoader
    if (typeof resourceLoader.getSkills === 'function') {
      captureDiscoveredPiSkills(resourceLoader.getSkills())
    }
  }
  if (settings.activeTools?.length) {
    // A restricted allowlist must still ADMIT every pack tool into the
    // registry, or load_capability could never reveal one mid-run. Being in
    // the registry is not the same as being active: the active set below is
    // what reaches the model.
    options.tools = [...new Set([
      ...settings.activeTools,
      ...piAllPackToolNames(),
      ...mcpDynamic.tools.map((tool) => tool.modelName),
    ])]
  }
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
  // The active set is stated explicitly so the model sees exactly what the
  // catalog projection claims: restricted allowlists union their unlocked
  // capability tools; an unrestricted run gets the Pi defaults plus every
  // always-on pack tool. Without this, Pi would auto-activate every
  // registered extension tool and the catalog would understate reality.
  const desiredActive = [
    ...(settings.activeTools?.length ? settings.activeTools : Object.keys(TOOL_FACTORIES)),
    ...piActivePackToolNames(settings.activeTools || [], settings.unlockedTools || []),
    ...mcpDynamic.tools
      .filter((tool) => settings.mcpCapabilityActive === true || (settings.unlockedTools || []).includes(tool.modelName) || (settings.activeTools || []).includes(tool.modelName))
      .map((tool) => tool.modelName),
  ]
  try {
    created.session.setActiveToolsByName?.([...new Set(desiredActive)])
  } catch {
    /* a session that cannot accept an active set still runs on Pi's default */
  }
  // The session handle is the ONLY thing packs may touch mid-run: activating
  // registered tools. load_capability drives it; nothing else is exposed.
  registerPiPackSession(sessionId, {
    setActiveTools: (names) => {
      try {
        created.session.setActiveToolsByName?.(names)
        return true
      } catch {
        return false
      }
    },
    getActiveTools: () => {
      try {
        return (created.session.getActiveToolNames?.() || []) as string[]
      } catch {
        return []
      }
    },
  })
  const runtime = {
    activeToolsKey,
    ...(skillSnapshot ? { skillSnapshotRoot: skillSnapshot.root } : {}),
    sessionManager,
    session: created.session,
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(options.resourceLoader ? { requestContext } : {}),
  } as PiSessionRuntime
  if (existing) {
    await existing.session.dispose?.()
    if (existing.skillSnapshotRoot && existing.skillSnapshotRoot !== skillSnapshot?.root) {
      await rm(existing.skillSnapshotRoot, { recursive: true, force: true })
    }
  }
  sessionRuntimes.set(sessionId, runtime)
  return runtime
  } catch (error) {
    // A failed loader/model/session construction must not strand a readable
    // snapshot that no live turn owns. Preserve only the previous runtime's
    // snapshot, which remains valid until a replacement succeeds.
    if (skillSnapshot?.root && skillSnapshot.root !== existing?.skillSnapshotRoot) {
      await rm(skillSnapshot.root, { recursive: true, force: true })
    }
    throw error
  }
}

/**
 * Whether this moment is a safe place to stop.
 *
 * Pure so the rule can be driven directly by tests: a park happens only when a
 * stop is pending, nothing is mid-execution, and we have not parked already.
 */
export function shouldParkTurn(state: {
  interrupt?: PiTurnInterruptReason
  toolsInFlight: number
  parked: boolean
}): boolean {
  return Boolean(state.interrupt) && state.toolsInFlight === 0 && !state.parked
}

/** Abort exactly once, and only from a tool boundary. */
function parkInterruptedTurn(turn: PiActiveTurn): void {
  if (!shouldParkTurn(turn)) return
  turn.parked = true
  void turn.session?.abort?.()
}

/**
 * An interrupted turn keeps whatever the assistant had already produced.
 *
 * The partial answer is real work the user paid for; discarding it would make
 * a stop indistinguishable from a failure. The caller seals it in the feed.
 */
/** One assistant message, projected into the item shape the protocol carries. */
function assistantMessageItems(messages: Array<{ role?: string; content?: unknown }>) {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      type: 'assistant_message',
      content: Array.isArray(message.content)
        ? message.content
            .filter((part): part is { type: string; text: string } => Boolean(
              part && typeof part === 'object'
              && (part as { type?: unknown }).type === 'text'
              && typeof (part as { text?: unknown }).text === 'string',
            ))
            .map((part) => part.text)
            .join('')
        : typeof message.content === 'string' ? message.content : '',
      message,
    }))
}

/**
 * An interrupted turn keeps whatever the assistant had already produced.
 *
 * The partial answer is real work the user paid for; discarding it would make
 * a stop indistinguishable from a failure. Each assistant message stays its own
 * item, so the message the model was writing when it stopped remains separable
 * from the narration it opened with — welding them together is what made a
 * stop return the preamble as if it were the answer. When a stop lands before
 * any message completes, the text the user watched stream in stands in, still
 * one item per message.
 */
function interruptedTurnResult(
  turn: PiActiveTurn,
  messages: Array<{ role?: string; content?: unknown }>,
  streamedSegments: string[] = [],
) {
  const completed = assistantMessageItems(messages)
  const items = completed.some((item) => item.content.trim())
    ? completed
    : streamedSegments
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => ({ type: 'assistant_message', content: segment, message: undefined }))
  return {
    settlement: 'interrupted' as const,
    interruptReason: turn.interrupt || ('user' as PiTurnInterruptReason),
    items,
  }
}

/**
 * Ask a turn to stop at its next tool boundary.
 *
 * Returns false when the run is not active, so the protocol can answer
 * honestly instead of acknowledging a stop that never reached anything.
 */
export function interruptPiTurn(runId: string, reason: PiTurnInterruptReason = 'user'): boolean {
  const turn = activeTurns.get(runId)
  if (!turn) return false
  if (!turn.interrupt) turn.interrupt = reason
  // No tool is mid-flight, so this call site already is the boundary.
  if (turn.toolsInFlight === 0) parkInterruptedTurn(turn)
  return true
}

/** Whether a turn has been asked to park (Host-side assertion seam). */
export function piTurnInterruptState(runId: string): { interrupt?: PiTurnInterruptReason; toolsInFlight: number; parked: boolean } | undefined {
  const turn = activeTurns.get(runId)
  return turn ? { interrupt: turn.interrupt, toolsInFlight: turn.toolsInFlight, parked: turn.parked } : undefined
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
  onRuntimeReady?: (contextWindowTokens?: number, session?: unknown) => void,
) {
  const turn: PiActiveTurn = { cancelled: false, toolsInFlight: 0, parked: false }
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
  if (turn.interrupt) {
    if (runId) activeTurns.delete(runId)
    return interruptedTurnResult(turn, [])
  }
  if (turn.cancelled) {
    if (runId) activeTurns.delete(runId)
    return { settlement: 'cancelled' as const, items: [] }
  }
  try {
    onRuntimeReady?.(runtime.contextWindowTokens, runtime.session)
  } catch (error) {
    if (runId) activeTurns.delete(runId)
    throw error
  }
  let completedMessages: Array<{ role?: string; content?: unknown }> = []
  // What the user has watched arrive, kept one message at a time so a stop can
  // hand back the message being written without the ones before it.
  const streamedSegments: string[] = ['']
  // Measured at the boundary that makes the request, so nobody downstream has
  // to infer a duration from timestamps that were never its edges.
  const timing: PiStepTiming = { requestAt: Date.now(), completedAt: 0 }
  const unsubscribe = runtime.session.subscribe((event) => {
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      completedMessages = event.messages as Array<{ role?: string; content?: unknown }>
    }
    if (event.type === 'message_start' || event.type === 'tool_execution_start') streamedSegments.push('')
    const streamed = (event as { assistantMessageEvent?: { type?: unknown; delta?: unknown } }).assistantMessageEvent
    if (streamed?.type === 'text_delta' && typeof streamed.delta === 'string') {
      // The moment the model stopped thinking and started writing.
      timing.firstTokenAt ??= Date.now()
      streamedSegments[streamedSegments.length - 1] += streamed.delta
    }
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      // Pi already measures all of this per assistant message and prices it
      // from its own model catalog. The reducer used to keep three fields and
      // drop the rest, which is why nobody could answer «這個 run 為什麼燒了
      // 這麼多 token» — the cache split and the cost were measured, published,
      // and thrown away one line before they were recorded.
      //
      // The reduction itself lives in `piStepUsage.ts` so its two easy-to-get-
      // wrong rules (never write an unreported field as 0; take the prompt
      // from the last call, not the sum) are checkable by a test rather than
      // buried in a subscribe callback.
      const stepUsage = reducePiStepUsage(event.messages as PiReportedMessage[])
      if (stepUsage) {
        timing.usage = stepUsage
        // The catalog's window for the model that served THIS step, so a
        // mid-run model switch is measured against the model that ran.
        if (runtime.contextWindowTokens) timing.contextWindow = runtime.contextWindowTokens
      }
    }
    // Tool boundaries are the only safe place to stop: between calls the agent
    // owns no half-applied edit and no orphaned child process.
    if (event.type === 'tool_execution_start') turn.toolsInFlight += 1
    if (event.type === 'tool_execution_end') {
      turn.toolsInFlight = Math.max(0, turn.toolsInFlight - 1)
      if (turn.interrupt && turn.toolsInFlight === 0) parkInterruptedTurn(turn)
    }
    onEvent?.(event)
  })
  try {
    if (runtime.requestContext) {
      runtime.requestContext.value = requestContext
      runtime.requestContext.includeHistory = referenceChatHistory
    }
    await runtime.session.prompt(runtime.requestContext || !requestContext ? prompt : `${requestContext}\n## Current request\n${prompt}`)
    if (turn.interrupt) return { ...interruptedTurnResult(turn, completedMessages, streamedSegments), timing }
    if (turn.cancelled) return { settlement: 'cancelled' as const, items: [], timing }
    // A rejected request never throws here: Pi records it as an empty assistant
    // message carrying the provider's error, so a failed call must not be
    // mistaken for a turn that simply produced nothing.
    const providerError = piTurnProviderError(completedMessages as ReadonlyArray<{ role?: string; stopReason?: string; errorMessage?: string }>)
    if (providerError) return { settlement: 'failed' as const, items: [{ type: 'error', content: providerError }], timing }
    const items = assistantMessageItems(completedMessages)
    // A clean provider call that carried no text is `empty`, not `answered`:
    // the run finished without producing anything for the user to read. One
    // cut off by the output budget (`stopReason: 'length'`) is `truncated`
    // instead — a wall the same prompt will hit again, so it must read as a
    // failure with the knob that fixes it. Items travel either way; one
    // classification decides both the settlement and the notice.
    const stopReason = piTurnStopReason(completedMessages as ReadonlyArray<{ role?: string; stopReason?: string }>)
    const settlement = classifyPiTurnSettlement(items, stopReason)
    if (settlement === 'truncated') {
      return { settlement, items: [...items, { type: 'truncation_notice', content: PI_TURN_TRUNCATED_NOTICE }], timing }
    }
    return { settlement, items, timing }
  } catch (error) {
    // An aborted prompt throws; an interrupt is a deliberate stop, never a failure.
    if (turn.interrupt) return { ...interruptedTurnResult(turn, completedMessages, streamedSegments), timing }
    if (turn.cancelled) return { settlement: 'cancelled' as const, items: [], timing }
    return {
      timing,
      settlement: 'failed' as const,
      items: [{ type: 'error', content: error instanceof Error ? error.message : 'Pi turn failed' }],
    }
  } finally {
    timing.completedAt = Date.now()
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
  unregisterPiPackSession(sessionId)
  try {
    await runtime.session.dispose?.()
  } finally {
    if (runtime.skillSnapshotRoot) await rm(runtime.skillSnapshotRoot, { recursive: true, force: true })
    sessionRuntimes.delete(sessionId)
  }
}

/** Release every per-session runtime and its Host-owned resource snapshot. */
export async function disposeAllPiSessions(): Promise<void> {
  await Promise.allSettled([...sessionRuntimes.keys()].map((sessionId) => disposePiSession(sessionId)))
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
  cancelledToolRuns.add(runId)
  for (const tool of runs) {
    tool.cancelled = true
    tool.controller.abort()
  }
  return true
}
