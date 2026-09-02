/**
 * Renderer helper: run prompt via local CLI and synthesize AgentState-like result
 */

import type { AgentState, ApprovalMode, ExternalRunRef, RuntimeOverrides } from './types.ts'
import type {
  ExternalCliConnectorRequirement,
  ExternalCliRunPolicy,
  ExternalCliTerminalClassification,
} from './externalCliRunSession.ts'
import { emptyKnowledge } from './knowledge.ts'
import { resolveCliApproval } from './cliApproval.ts'
import {
  EXTERNAL_CLI_DOD_LABEL,
  EXTERNAL_CLI_RUNNER_CAPABILITIES,
} from './runners/index.ts'
import {
  effectiveOutboundGuardFromSettings,
  inspectOutbound,
  isProtectionActive,
  readBuildFlavorFromEnv,
} from './outbound/outboundGate.ts'
import { connectionIdForCliProvider } from './outbound/providerConnectionId.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from './outbound/policySchema.ts'
import { compileProviderSecurityProfile } from './outbound/policyMerge.ts'
import {
  loadCompanyProfileViaOutboundIpc,
  prepareLlmEgressMessages,
} from './outbound/llmEgress.ts'
import { mapSanitizedInstructionSnapshot } from './instructionSnapshot.ts'
import {
  detectFilesystemSandboxCapability,
  allocateForbiddenCanaryPath,
  evaluateCliSandboxGate,
  probeFilesystemSandbox,
  rewriteCliPromptForView,
} from './outbound/cliSandbox.ts'

export type LocalRunnerKind = 'codex' | 'claude' | 'grok' | 'gemini' | 'cursor'

export type LocalCliAttachmentPayload = {
  name: string
  mimeType?: string
  kind?: 'image' | 'text' | 'binary'
  dataUrl?: string
  textContent?: string
}

function logCliRunSelections(opts: {
  cwd?: string
  model?: string
  depth?: string
  serviceTier?: RuntimeOverrides['providerServiceTier']
  onLog?: (line: string) => void
}): void {
  const lines = [
    opts.cwd ? `cwd: ${opts.cwd}` : '',
    opts.model ? `model: ${opts.model}` : '',
    opts.depth ? `depth: ${opts.depth}` : '',
    opts.serviceTier ? `provider service tier: ${opts.serviceTier}` : '',
  ].filter(Boolean)
  for (const line of lines) opts.onLog?.(line)
}

function logCliAttachments(
  attachments: LocalCliAttachmentPayload[] | undefined,
  onLog: ((line: string) => void) | undefined,
): void {
  if (!attachments?.length) return
  const imageCount = attachments.filter((item) => item.kind === 'image' || item.dataUrl).length
  onLog?.(
    `attachments: ${attachments.length}（圖 ${imageCount} · 檔 ${attachments.length - imageCount}）→ 寫入專案 .subagents/chat-attachments/`,
  )
}

async function prepareCliOutboundPrompt(opts: {
  prompt: string
  effectiveMode: ReturnType<typeof effectiveOutboundGuardFromSettings>
  connectionId: string
  runId?: string
}): Promise<{ ok: true; prompt: string } | { ok: false; reason: string }> {
  if (!isProtectionActive(opts.effectiveMode)) return { ok: true, prompt: opts.prompt }
  const prepared = await prepareLlmEgressMessages({
    effectiveMode: opts.effectiveMode,
    messages: [{ role: 'user', content: opts.prompt }],
    baselineProfile: compileProviderSecurityProfile(
      BUILTIN_BASELINE_POLICY,
      emptySupplementalPolicy(opts.connectionId),
    ),
    loadCompanyProfile: () => loadCompanyProfileViaOutboundIpc(opts.connectionId),
    cacheKey: opts.runId
      ? `${opts.runId}:${opts.connectionId}`
      : `norun:${opts.connectionId}`,
  })
  return prepared.ok
    ? { ok: true, prompt: prepared.messages[0]?.content || '' }
    : { ok: false, reason: prepared.reason }
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function prepareCliInstructionRecord(opts: {
  snapshot?: RuntimeOverrides['instructionSnapshot']
  effectiveMode: ReturnType<typeof effectiveOutboundGuardFromSettings>
  connectionId: string
  runId?: string
}): Promise<RuntimeOverrides['instructionSnapshot']> {
  if (!opts.snapshot || !isProtectionActive(opts.effectiveMode)) return opts.snapshot
  const prepared = await prepareLlmEgressMessages({
    effectiveMode: opts.effectiveMode,
    messages: [
      { role: 'user', content: opts.snapshot.effectiveText },
      { role: 'user', content: opts.snapshot.globalEffectiveText },
      ...opts.snapshot.sources.map((source) => ({ role: 'user', content: source.content })),
    ],
    baselineProfile: compileProviderSecurityProfile(BUILTIN_BASELINE_POLICY, emptySupplementalPolicy(opts.connectionId)),
    loadCompanyProfile: () => loadCompanyProfileViaOutboundIpc(opts.connectionId),
    cacheKey: opts.runId ? `${opts.runId}:${opts.connectionId}` : `norun:${opts.connectionId}`,
  })
  if (!prepared.ok) throw new Error(prepared.reason)
  return mapSanitizedInstructionSnapshot(opts.snapshot, {
    effectiveText: prepared.messages[0]?.content || '',
    globalEffectiveText: prepared.messages[1]?.content || '',
    sourceContents: opts.snapshot.sources.map((_, index) => prepared.messages[index + 2]?.content || ''),
  }, sha256Text)
}

async function prepareCliProtectedPayload(opts: {
  prompt: string
  snapshot?: RuntimeOverrides['instructionSnapshot']
  effectiveMode: ReturnType<typeof effectiveOutboundGuardFromSettings>
  connectionId: string
  runId?: string
}): Promise<
  | { ok: true; prompt: string; snapshot?: RuntimeOverrides['instructionSnapshot'] }
  | { ok: false; reason: string }
> {
  try {
    const protectedPrompt = await prepareCliOutboundPrompt(opts)
    if (!protectedPrompt.ok) return protectedPrompt
    const snapshot = await prepareCliInstructionRecord(opts)
    return { ok: true, prompt: protectedPrompt.prompt, snapshot }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export async function runPromptViaLocalCli(opts: {
  kind: LocalRunnerKind
  binary?: string
  prompt: string
  cwd?: string
  model?: string
  depth?: string
  serviceTier?: RuntimeOverrides['providerServiceTier']
  agentMode?: string
  approvalMode?: ApprovalMode
  unattended?: boolean
  runId?: string
  /** Conversation/thread identity for session isolation and reconnect. */
  conversationId?: string
  /** Legacy name retained at the renderer store boundary. */
  threadId?: string
  /** Materialized on disk by Electron for CLI vision/file tools */
  attachments?: LocalCliAttachmentPayload[]
  /** External CLI delegate/continue contract; contains no parent transcript. */
  externalCliContract?: RuntimeOverrides['externalCliContract']
  /** Host-owned timing policy captured with the immutable task snapshot. */
  externalCliPolicy?: Partial<ExternalCliRunPolicy>
  requiredConnectors?: ExternalCliConnectorRequirement[]
  instructionSnapshot?: RuntimeOverrides['instructionSnapshot']
  onLog?: (line: string) => void
}): Promise<{
  ok: boolean
  output: string
  command: string
  error?: string
  terminalClassification?: ExternalCliTerminalClassification
  runId?: string
  externalRun?: ExternalRunRef
  /** Exact prompt handed to the external CLI after the outbound gate. */
  deliveredPrompt?: string
  deliveredInstructionSnapshot?: RuntimeOverrides['instructionSnapshot']
}> {
  if (!window.subagents?.cli?.runAgent) {
    return {
      ok: false,
      output: '',
      command: '',
      error: '本機 CLI 執行僅支援 Electron',
    }
  }
  opts.onLog?.(`▶ 透過本機 ${opts.kind} CLI 執行…`)
  logCliRunSelections(opts)
  logCliAttachments(opts.attachments, opts.onLog)
  const approval = resolveCliApproval(
    opts.kind,
    opts.approvalMode,
    opts.unattended,
    opts.agentMode,
  )
  opts.onLog?.(`approval: ${approval.note}`)

  // Outbound Data Gate — before process creation (same contract as builtin LLM).
  let gateSettings: {
    outboundProtectionEnabled?: boolean
    outboundGuardDeploy?: 'off' | 'demo' | 'optional' | 'required'
  } = {}
  try {
    const { useSettingsStore } = await import('../store/settingsStore.ts')
    gateSettings = useSettingsStore.getState().settings
  } catch {
    /* pure tests without store */
  }
  const effectiveMode = effectiveOutboundGuardFromSettings(gateSettings)
  const connectionId = connectionIdForCliProvider({ id: opts.kind })

  let prompt = opts.prompt
  let cwd = opts.cwd
  let viewMeta: { viewRoot: string; originalRoot: string; connectionId: string } | null = null
  if (opts.runId && window.subagents?.outbound?.viewMeta) {
    try {
      viewMeta = await window.subagents.outbound.viewMeta(opts.runId)
    } catch {
      viewMeta = null
    }
  }
  if (viewMeta) {
    prompt = rewriteCliPromptForView(prompt, {
      originalRoot: viewMeta.originalRoot,
      viewRoot: viewMeta.viewRoot,
    })
    cwd = viewMeta.viewRoot
  }

  const protectedPayload = await prepareCliProtectedPayload({
    prompt,
    snapshot: opts.instructionSnapshot,
    effectiveMode,
    connectionId,
    runId: opts.runId,
  })
  if (!protectedPayload.ok) {
    return {
      ok: false,
      output: '',
      command: '',
      error: `出站資料閘門：無法建立公司保護設定檔（${protectedPayload.reason}）`,
      runId: opts.runId,
    }
  }
  prompt = protectedPayload.prompt
  const deliveredInstructionSnapshot = protectedPayload.snapshot

  // Required CLI needs verified filesystem sandbox; optional/demo may mark unverified.
  let isolationStatus = detectFilesystemSandboxCapability()
  let sandboxEngine: 'seatbelt' | 'bwrap' | 'none' | undefined
  if (viewMeta?.viewRoot && viewMeta.originalRoot) {
    // Ticket 20: canary must not live under original project (ADR-0007).
    const forbiddenCanaryPath = allocateForbiddenCanaryPath({
      originalRoot: viewMeta.originalRoot,
      viewRoot: viewMeta.viewRoot,
    })
    const probe = await probeFilesystemSandbox({
      viewRoot: viewMeta.viewRoot,
      forbiddenCanaryPath,
    })
    isolationStatus = probe.status
    sandboxEngine = probe.engine
    if (probe.detail) opts.onLog?.(`sandbox probe: ${probe.detail}`)
  }
  const sandbox = evaluateCliSandboxGate({ effectiveMode, isolationStatus })
  if (!sandbox.allow) {
    opts.onLog?.(sandbox.reason || 'CLI sandbox gate denied')
    return {
      ok: false,
      output: '',
      command: '',
      error: sandbox.reason || 'Filesystem sandbox 不允許啟動 external CLI',
      runId: opts.runId,
    }
  }
  if (sandbox.reason) opts.onLog?.(sandbox.reason)
  if (viewMeta) {
    opts.onLog?.(
      `CLI cwd → Restricted Project View（isolation=${sandbox.isolationStatus}${sandbox.isolationVerified ? ' · verified' : ''}${sandboxEngine && sandboxEngine !== 'none' ? ` · engine=${sandboxEngine}` : ''}）`,
    )
  }

  const cliPayload = {
    prompt,
    cwd,
    kind: opts.kind,
    model: opts.model,
    attachments: opts.attachments,
    isolationStatus: sandbox.isolationStatus,
    externalCliContract: opts.externalCliContract,
  }
  const gate = inspectOutbound({
    channel: 'cli',
    runId: opts.runId,
    payload: cliPayload,
    effectiveMode,
    buildFlavor: readBuildFlavorFromEnv(),
    providerConnectionId: connectionId,
  })
  if (gate.action === 'block') {
    return {
      ok: false,
      output: '',
      command: '',
      error: gate.reason || '出站資料閘門已阻擋此 CLI 啟動',
      runId: opts.runId,
    }
  }
  const gated = gate.payload as typeof cliPayload

  // When isolation is verified, main process wraps the CLI under seatbelt/bwrap.
  const sandboxWrap =
    sandbox.isolationVerified &&
    viewMeta?.viewRoot &&
    (sandboxEngine === 'seatbelt' || sandboxEngine === 'bwrap')
      ? { engine: sandboxEngine, viewRoot: viewMeta.viewRoot }
      : undefined

  // Prefer long-lived stream subscription before invoke (if available)
  // so early stdout is not missed; agentStore also subscribes.
  const r = await window.subagents.cli.runAgent({
    kind: opts.kind,
    binary: opts.binary,
    prompt: String(gated.prompt ?? prompt),
    cwd: (gated.cwd as string | undefined) ?? cwd,
    model: gated.model ?? opts.model,
    depth: opts.depth,
    serviceTier: opts.serviceTier,
    agentMode: opts.agentMode,
    approvalMode: opts.approvalMode,
    unattended: opts.unattended,
    sandboxWrap,
    effectiveMode,
    externalCliPolicy: opts.externalCliPolicy,
    requiredConnectors: opts.requiredConnectors,
    conversationId: opts.conversationId || opts.threadId,
    runId: opts.runId,
    attachments: (gated.attachments as typeof opts.attachments) ?? opts.attachments,
    externalCliContract: opts.externalCliContract,
  })
  logLocalCliResult(r, opts.onLog)
  if (r.command) opts.onLog?.(`$ ${r.command.slice(0, 200)}`)
  return {
    ok: r.ok,
    output: r.output,
    command: r.command,
    error: r.error,
    runId: r.runId,
    terminalClassification: r.terminalClassification,
    externalRun: r.externalRun as ExternalRunRef | undefined,
    // This field is only returned after the process invocation boundary. Any
    // pre-dispatch gate failure returns above without claiming delivery.
    deliveredPrompt: String(gated.prompt ?? prompt),
    deliveredInstructionSnapshot,
  }
}

function logLocalCliResult(result: { cancelled?: boolean; ok: boolean; error?: string; code?: string | number | null }, onLog?: (line: string) => void): void {
  if (result.cancelled) {
    onLog?.('■ CLI 已取消')
    return
  }
  onLog?.(result.ok ? '✓ CLI 完成' : `✗ CLI 失敗：${result.error || result.code}`)
}

/** Cancel active local CLI agent process (Electron) */
export function emptyAgentLike(partial: Partial<AgentState> & { objective: string }): AgentState {
  const isExternal =
    partial.executionKind === 'external' ||
    partial.loopConfig?.trigger === 'local-cli' ||
    Boolean(partial.externalRunnerKind)
  return {
    id: partial.id || `cli_${Date.now().toString(36)}`,
    objective: partial.objective,
    loopConfig: partial.loopConfig || {
      loopType: 'Goal-based',
      trigger: 'local-cli',
      executionSequence: ['local-cli'],
      // Honest label: external exit is not builtin DoD met
      definitionOfDone: EXTERNAL_CLI_DOD_LABEL,
      maxIterations: 1,
      fallbackProtocol: '',
      nextState: 'Halt',
    },
    status: partial.status || 'idle',
    currentIteration: partial.currentIteration ?? 1,
    steps: partial.steps || [],
    logs: partial.logs || [],
    confidence: partial.confidence ?? 0.9,
    progress: partial.progress ?? 100,
    startedAt: partial.startedAt || new Date().toISOString(),
    finishedAt: partial.finishedAt ?? new Date().toISOString(),
    subAgents: partial.subAgents || [],
    knowledge: partial.knowledge || emptyKnowledge(),
    intervention: partial.intervention || {
      active: false,
      reason: '',
      payloadJson: '',
      safety: null,
      timeoutSec: 900,
    },
    tokensUsed: partial.tokensUsed ?? 0,
    minConfidence: partial.minConfidence ?? 0.8,
    toolCalls: partial.toolCalls || [],
    loadedCapabilityIds: partial.loadedCapabilityIds || [],
    unlockedToolNames: partial.unlockedToolNames || [],
    violation: partial.violation ?? null,
    metrics: partial.metrics || { vramLabel: 'local-cli', apiCredits: 0, executionMs: 0 },
    result: partial.result,
    reportTitle: partial.reportTitle,
    haltReason: partial.haltReason,
    executionKind: partial.executionKind ?? (isExternal ? 'external' : 'loop'),
    runnerCapabilities:
      partial.runnerCapabilities ??
      (isExternal ? { ...EXTERNAL_CLI_RUNNER_CAPABILITIES } : undefined),
    externalRunnerKind: partial.externalRunnerKind,
    interruptReason: partial.interruptReason,
    // A CLI exit is never a DoD claim, so the settlement evidence is dropped
    // for external runs instead of travelling as an unmet DoD.
    orchestration: isExternal ? undefined : partial.orchestration,
    externalRun: partial.externalRun,
    scheduleTrigger: partial.scheduleTrigger,
    eventTrigger: partial.eventTrigger,
    postState: partial.postState,
    turnRecord: partial.turnRecord,
  }
}

/**
 * Map model id → runner using provider model lists (no name hardcoding).
 * provider id anthropic → claude runner.
 */
export function inferRunnerFromModel(
  model: string,
  providers: Array<{
    id: string
    authorized?: boolean
    enabled?: boolean
    models?: Array<{ id: string }>
  }>,
): LocalRunnerKind | 'builtin' {
  if (!model.trim()) return 'builtin'
  for (const p of providers || []) {
    if (!p.enabled || !p.authorized) continue
    if (!(p.models || []).some((m) => m.id === model)) continue
    if (p.id === 'codex') return 'codex'
    if (p.id === 'anthropic' || p.id === 'claude') return 'claude'
    if (p.id === 'grok') return 'grok'
    if (p.id === 'google' || p.id === 'gemini') return 'gemini'
    if (p.id === 'cursor') return 'cursor'
  }
  return 'builtin'
}

/** Keep the thread's model and execution adapter coherent after one selection. */
export function resolveModelRunnerSelection(input: {
  currentRunner: LocalRunnerKind | 'builtin'
  selectedModel: string
  providers: Array<{
    id: string
    authorized?: boolean
    enabled?: boolean
    models?: Array<{ id: string }>
  }>
}): { threadModel: string; runner: LocalRunnerKind | 'builtin' } {
  const threadModel = input.selectedModel.trim()
  return {
    threadModel,
    runner: inferRunnerFromModel(threadModel, input.providers),
  }
}
