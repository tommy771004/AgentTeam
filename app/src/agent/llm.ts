/**
 * LLM client — OpenAI-compatible Chat Completions + function calling.
 */

import type { LlmSettings, ModelSource } from './types'
import { DEFAULT_CLI_PROVIDERS } from './cliProviders.ts'
import { breakerKey, callWithResilience } from './llmResilience.ts'
import {
  effectiveOutboundGuardFromSettings,
  inspectOutbound,
  isProtectionActive,
  readBuildFlavorFromEnv,
} from './outbound/outboundGate.ts'
import { connectionIdForBuiltinLlm } from './outbound/providerConnectionId.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from './outbound/policySchema.ts'
import { compileProviderSecurityProfile } from './outbound/policyMerge.ts'
import {
  loadCompanyProfileViaOutboundIpc,
  prepareLlmEgressMessages,
} from './outbound/llmEgress.ts'

export type { LlmSettings }

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  enabled: false,
  apiProvider: 'custom',
  /** 空白 = 由使用者或一鍵偵測填入 */
  baseUrl: '',
  apiKey: '',
  model: '',
  fallbackModels: [],
  discoveredModels: [],
  roleModels: {
    orchestrator: '',
    analyst: '',
    synthesizer: '',
    executor: '',
  },
  subAgentsEnabled: false,
  authLevel: 2,
  minConfidence: 0.8,
  maxIterationsDefault: 5,
  safetyEnabled: true,
  toolsEnabled: true,
  webSearchEnabled: true,
  llmRetryMaxAttempts: 3,
  llmCircuitBreakerEnabled: true,
  defaultContextWindowTokens: 64_000,
  functionCalling: true,
  llmParseEnabled: true,
  sessionRecallEnabled: true,
  haltOnPayloadOverflow: false,
  maxToolPayloadKb: 50,
  maxToolRounds: 4,
  webhookEnabled: false,
  webhookPort: 8787,
  webhookToken: '',
  webhookTarget: '',
  customTools: [],
  customToolSecrets: {},
  pluginOAuthClients: {},
  mcpEnabled: false,
  mcpServers: [],
  mcpAgentServers: {},
  telegramEnabled: false,
  telegramBotToken: '',
  telegramAllowedChatIds: '',
  telegramAutoRun: true,
  telegramReplyWithResult: true,
  cliProviders: DEFAULT_CLI_PROVIDERS.map((p) => ({
    ...p,
    models: [],
  })),
  bashRequireAsk: true,
  approvalMode: 'auto',
  /** Progressive disclosure of capability bundles (tools + runbooks) */
  capabilitiesEnabled: true,
  alwaysOnCapabilities: [],
  toolSearchEnabled: true,
  toolSearchThreshold: 24,
  codeModeEnabled: true,
  modelProfiles: {},
  hookRules: [],
  trustedHookProjects: [],
  delegatePersonas: {},
  outboundProtectionEnabled: false,
  classificationEndpointUrl: '',
  classificationAllowPlaintextHttp: false,

  // ChatGPT-style prefs
  theme: 'dark',
  reducedMotion: 'system',
  uiFontSize: 14,
  codeFontSize: 13,
  translucentSidebar: true,
  enterBehavior: 'enter',
  followUpMode: 'steer',
  concurrentRunsEnabled: false,
  maxConcurrentRuns: 4,
  notifyOnComplete: true,
  soundOnComplete: false,
  preventSleepWhileRunning: false,
  ambientSuggestions: true,
  personality: 'default',
  customAboutUser: '',
  customResponseStyle: '',
  memoryEnabled: true,
  memoryWriteEnabled: true,
  referenceChatHistory: true,
  temporaryChatDefault: false,
  autoArchiveDays: 0,
  gitBranchPrefix: 'agent/',
  gitCommitInstructions: '',
  gitPrInstructions: '',
  gitCreateDraftPr: true,
  gitForcePush: false,
}

export type RoleModelKey = 'orchestrator' | 'analyst' | 'synthesizer' | 'executor'

/** Map display / runtime role names → settings.roleModels key */
export function roleModelKey(role: string): RoleModelKey | null {
  if (role === 'orchestrator' || role === 'Manager' || role === 'sub-orchestrator')
    return 'orchestrator'
  if (role === 'analyst' || role === 'Analyzer-1' || role === 'leaf' || role === 'leaf-worker')
    return 'analyst'
  if (role === 'synthesizer' || role === 'Writer') return 'synthesizer'
  if (role === 'executor' || role === 'Core') return 'executor'
  return null
}

export type ResolvedRoleModel = {
  model: string
  source: ModelSource
  roleKey: RoleModelKey | null
  /** True when roleModels[role] was empty and we fell back */
  usedFallback: boolean
}

/**
 * Resolve which model a sub-agent role actually uses.
 * Config source: Settings.roleModels (in-app), NOT per-vendor agent md files.
 * Empty role slot → global settings.model (may already include thread override).
 */
export function resolveRoleModel(settings: LlmSettings, role: string): ResolvedRoleModel {
  const map = settings.roleModels || DEFAULT_LLM_SETTINGS.roleModels
  const key = roleModelKey(role)
  const roleOverride = key ? (map[key] || '').trim() : ''
  const fallback = (settings.model || '').trim()
  if (roleOverride) {
    return { model: roleOverride, source: 'role', roleKey: key, usedFallback: false }
  }
  if (fallback) {
    return { model: fallback, source: 'fallback', roleKey: key, usedFallback: true }
  }
  return { model: '', source: 'none', roleKey: key, usedFallback: true }
}

/** Resolve model for a sub-agent role. */
export function modelForRole(settings: LlmSettings, role: string): string {
  return resolveRoleModel(settings, role).model
}

export function withRoleModel(settings: LlmSettings, role: string): LlmSettings {
  const resolved = resolveRoleModel(settings, role)
  return { ...settings, model: resolved.model }
}

/** OpenAI-compatible multimodal content parts */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export type ChatMessageContent = string | null | ChatContentPart[]

export interface ChatMessageExt {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: ChatMessageContent
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: string
}

export interface LlmChatResult {
  content: string
  tokensUsed: number
  model: string
}

export interface LlmToolsResult extends LlmChatResult {
  toolCalls: ToolCallRequest[]
  finishReason?: string
}

export async function chatCompletion(
  settings: LlmSettings,
  messages: Array<{ role: string; content: string }>,
  opts?: { temperature?: number; maxTokens?: number },
): Promise<LlmChatResult> {
  const r = await chatCompletionWithTools(
    settings,
    messages.map((m) => ({ role: m.role as ChatMessageExt['role'], content: m.content })),
    [],
    { ...opts, toolChoice: 'none' },
  )
  return { content: r.content, tokensUsed: r.tokensUsed, model: r.model }
}

export async function chatCompletionWithTools(
  settings: LlmSettings,
  messages: ChatMessageExt[],
  tools: unknown[],
  opts?: {
    temperature?: number
    maxTokens?: number
    toolChoice?: 'auto' | 'none' | 'required'
    /** retry / breaker 事件回報(進 run log) */
    onResilienceEvent?: (message: string) => void
    /** Optional run id for outbound evidence correlation (later tickets). */
    runId?: string
  },
): Promise<LlmToolsResult> {
  if (!settings.enabled) {
    throw new Error('LLM is disabled. Enable it in Settings.')
  }
  if (!settings.apiKey.trim()) {
    throw new Error('API key is missing. Configure it in Settings.')
  }

  const body = {
    model: settings.model,
    messages,
    temperature: opts?.temperature ?? 0.4,
    max_tokens: opts?.maxTokens ?? 1200,
    ...(tools.length
      ? {
          tools,
          tool_choice: opts?.toolChoice ?? 'auto',
        }
      : {}),
  }

  // Outbound Data Gate — every builtin LLM round, including FC follow-ups.
  // Ticket 19: sanitize with company Provider Security Profile (main ensurePolicy),
  // not baseline-only, so company detectors apply at true egress.
  const effectiveMode = effectiveOutboundGuardFromSettings(settings)
  const connectionId = connectionIdForBuiltinLlm({
    apiProvider: settings.apiProvider,
    baseUrl: settings.baseUrl,
  })
  let egressPayload: typeof body = body
  let outboundProfileSource: 'company' | 'baseline' | 'none' = 'none'
  if (isProtectionActive(effectiveMode)) {
    const baselineProfile = compileProviderSecurityProfile(
      BUILTIN_BASELINE_POLICY,
      emptySupplementalPolicy(connectionId),
    )
    const lite = (body.messages || []).map((m) => ({
      role: String(m.role || 'user'),
      content:
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    }))
    const prepared = await prepareLlmEgressMessages({
      effectiveMode,
      messages: lite,
      baselineProfile,
      loadCompanyProfile: () => loadCompanyProfileViaOutboundIpc(connectionId),
      cacheKey: opts?.runId
        ? `${opts.runId}:${connectionId}`
        : `norun:${connectionId}`,
    })
    if (!prepared.ok) {
      throw new Error(`出站資料閘門：無法建立公司保護設定檔（${prepared.reason}）`)
    }
    outboundProfileSource = prepared.source
    egressPayload = {
      ...body,
      messages: prepared.messages.map((m, i) => {
        const orig = body.messages[i] as (typeof body.messages)[number]
        return { ...orig, role: m.role as typeof orig.role, content: m.content }
      }) as typeof body.messages,
    }
  }
  const gate = inspectOutbound({
    channel: 'llm',
    runId: opts?.runId,
    payload: egressPayload,
    effectiveMode,
    buildFlavor: readBuildFlavorFromEnv(),
    providerConnectionId: connectionId,
  })
  if (gate.action === 'block') {
    throw new Error(gate.reason || '出站資料閘門已阻擋此 LLM 請求')
  }
  const gatedBody = gate.payload as typeof body

  return callWithResilience(
    breakerKey(settings.baseUrl, settings.apiProvider),
    async () => {
      if (window.subagents?.llm?.chat) {
        const r = await window.subagents.llm.chat({
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          fallbackModels: settings.fallbackModels,
          ...gatedBody,
          // Ticket 24: main records metadata-only evidence at true transport
          runId: opts?.runId,
          effectiveMode,
          providerConnectionId: connectionId,
          outboundProfileSource,
        })
        return normalizeChatResult(r, settings.model)
      }

      const base = settings.baseUrl.replace(/\/$/, '')
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(gatedBody),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText)
        const retryAfter = Number(res.headers.get('retry-after') || '')
        const hint =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? ` (retry-after:${Math.ceil(retryAfter)}s)`
            : ''
        throw new Error(`LLM HTTP ${res.status}${hint}: ${errText.slice(0, 200)}`)
      }

      const data = await res.json()
      return normalizeChatResult(data, settings.model)
    },
    {
      maxAttempts: settings.llmRetryMaxAttempts,
      breakerEnabled: settings.llmCircuitBreakerEnabled !== false,
      onEvent: opts?.onResilienceEvent,
    },
  )
}

function normalizeChatResult(data: unknown, fallbackModel: string): LlmToolsResult {
  const d = data as {
    content?: string
    tokensUsed?: number
    model?: string
    toolCalls?: ToolCallRequest[]
    finishReason?: string
    choices?: Array<{
      finish_reason?: string
      message?: {
        content?: string | null
        tool_calls?: Array<{
          id: string
          type?: string
          function?: { name?: string; arguments?: string }
        }>
      }
    }>
    usage?: { total_tokens?: number }
  }

  // Already normalized from IPC
  if (d.toolCalls || (typeof d.content === 'string' && !d.choices)) {
    return {
      content: (d.content || '').trim(),
      tokensUsed: d.tokensUsed ?? 0,
      model: d.model || fallbackModel,
      toolCalls: d.toolCalls || [],
      finishReason: d.finishReason,
    }
  }

  const choice = d.choices?.[0]
  const msg = choice?.message
  const toolCalls: ToolCallRequest[] = (msg?.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name || '',
    arguments: tc.function?.arguments || '{}',
  }))

  return {
    content: (msg?.content || '').trim(),
    tokensUsed: d.usage?.total_tokens ?? 0,
    model: d.model || fallbackModel,
    toolCalls,
    finishReason: choice?.finish_reason,
  }
}

export async function runSubAgentTask(
  settings: LlmSettings,
  role: string,
  objective: string,
  step: string,
  context: string,
  toolContext?: string,
  opts?: {
    /** Multimodal user content (vision) — when set, bypasses plain string chatCompletion */
    userContent?: ChatMessageContent
  },
): Promise<LlmChatResult> {
  const system = settings.subAgentsEnabled === true
    ? `You are the "${role}" sub-agent in SubAgents AI multi-agent framework.
Follow the loop protocol: process only your assigned step, be concise, factual, and structured in Markdown.
Use tool results as primary evidence. Never invent credentials or private data. If data is unavailable mark as N/A.
If the user message includes images, describe and use them as primary evidence.`
    : `You are the primary agent in SubAgents AI.
Process the assigned step directly using the available evidence, be concise, factual, and structured in Markdown.
Never invent credentials or private data. If data is unavailable mark as N/A.
If the user message includes images, describe and use them as primary evidence.`

  const textBody = `Objective: ${objective}\n\nYour step: ${step}\n\nTool results:\n${toolContext || '(no tools ran)'}\n\nContext so far:\n${context || '(none)'}\n\nProduce the step output only.`

  if (opts?.userContent && typeof opts.userContent !== 'string') {
    const r = await chatCompletionWithTools(
      settings,
      [
        { role: 'system', content: system },
        { role: 'user', content: opts.userContent },
      ],
      [],
      { toolChoice: 'none', maxTokens: 1400 },
    )
    return { content: r.content, tokensUsed: r.tokensUsed, model: r.model }
  }

  return chatCompletion(settings, [
    { role: 'system', content: system },
    {
      role: 'user',
      content:
        typeof opts?.userContent === 'string' ? opts.userContent : textBody,
    },
  ])
}

/** Execute a step with the primary agent; never consults roleModels. */
export async function runPrimaryAgentTask(
  settings: LlmSettings,
  objective: string,
  step: string,
  context: string,
  toolContext?: string,
  opts?: { userContent?: ChatMessageContent },
): Promise<LlmChatResult> {
  return runSubAgentTask(
    { ...settings, subAgentsEnabled: false },
    'primary',
    objective,
    step,
    context,
    toolContext,
    opts,
  )
}

export async function synthesizeReport(
  settings: LlmSettings,
  objective: string,
  stepOutputs: string[],
  dod: string,
): Promise<LlmChatResult> {
  return chatCompletion(
    settings,
    [
      {
        role: 'system',
        content:
          settings.subAgentsEnabled === true
            ? 'You are the Writer/Synthesizer sub-agent. Produce a polished Markdown report with title, executive summary, key findings, and a short JSON example block if relevant.'
            : 'You are the primary agent. Produce a polished Markdown report with title, executive summary, key findings, and a short JSON example block if relevant.',
      },
      {
        role: 'user',
        content: `Objective: ${objective}\n\nDefinition of Done: ${dod}\n\nStep outputs:\n${stepOutputs.map((s, i) => `### Step ${i + 1}\n${s}`).join('\n\n')}`,
      },
    ],
    { maxTokens: 2000 },
  )
}
