/**
 * Renderer helper: run prompt via local CLI and synthesize AgentState-like result
 */

import type { AgentState, ApprovalMode, CliConfigSnapshot, ExternalRunRef, RuntimeOverrides } from './types'
import { emptyKnowledge } from './knowledge'
import { resolveCliApproval } from './cliApproval'
import {
  EXTERNAL_CLI_DOD_LABEL,
  EXTERNAL_CLI_RUNNER_CAPABILITIES,
} from './runners'
import {
  effectiveOutboundGuardFromSettings,
  inspectOutbound,
  readBuildFlavorFromEnv,
} from './outbound/outboundGate.ts'
import {
  detectFilesystemSandboxCapability,
  allocateForbiddenCanaryPath,
  evaluateCliSandboxGate,
  probeFilesystemSandbox,
  rewriteCliPromptForView,
} from './outbound/cliSandbox.ts'

export type LocalRunnerKind = 'codex' | 'claude' | 'grok' | 'opencode' | 'gemini' | 'cursor'
export type LocalCliConfigSnapshot = CliConfigSnapshot

export type LocalCliAttachmentPayload = {
  name: string
  mimeType?: string
  kind?: 'image' | 'text' | 'binary'
  dataUrl?: string
  textContent?: string
}

export async function runPromptViaLocalCli(opts: {
  kind: LocalRunnerKind
  binary?: string
  prompt: string
  cwd?: string
  model?: string
  depth?: string
  agentMode?: string
  approvalMode?: ApprovalMode
  unattended?: boolean
  runId?: string
  configSnapshot?: LocalCliConfigSnapshot
  /** Materialized on disk by Electron for CLI vision/file tools */
  attachments?: LocalCliAttachmentPayload[]
  /** External CLI delegate/continue contract; contains no parent transcript. */
  externalCliContract?: RuntimeOverrides['externalCliContract']
  onLog?: (line: string) => void
}): Promise<{
  ok: boolean
  output: string
  command: string
  error?: string
  runId?: string
  externalRun?: ExternalRunRef
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
  if (opts.cwd) opts.onLog?.(`cwd: ${opts.cwd}`)
  if (opts.model) opts.onLog?.(`model: ${opts.model}`)
  if (opts.depth) opts.onLog?.(`depth: ${opts.depth}`)
  if (opts.attachments?.length) {
    const nImg = opts.attachments.filter((a) => a.kind === 'image' || a.dataUrl).length
    const nOther = opts.attachments.length - nImg
    opts.onLog?.(
      `attachments: ${opts.attachments.length}（圖 ${nImg} · 檔 ${nOther}）→ 寫入專案 .subagents/chat-attachments/`,
    )
  }
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
    const { useSettingsStore } = await import('../store/settingsStore')
    gateSettings = useSettingsStore.getState().settings
  } catch {
    /* pure tests without store */
  }
  const effectiveMode = effectiveOutboundGuardFromSettings(gateSettings)

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
    agentMode: opts.agentMode,
    approvalMode: opts.approvalMode,
    unattended: opts.unattended,
    sandboxWrap,
    effectiveMode,
    timeoutMs: 300_000,
    runId: opts.runId,
    attachments: (gated.attachments as typeof opts.attachments) ?? opts.attachments,
    configSnapshot: opts.configSnapshot,
    externalCliContract: opts.externalCliContract,
  })
  if (r.cancelled) {
    opts.onLog?.('■ CLI 已取消')
  } else {
    opts.onLog?.(r.ok ? '✓ CLI 完成' : `✗ CLI 失敗：${r.error || r.code}`)
  }
  if (r.command) opts.onLog?.(`$ ${r.command.slice(0, 200)}`)
  return {
    ok: r.ok,
    output: r.output,
    command: r.command,
    error: r.error,
    runId: r.runId,
    externalRun: r.externalRun as ExternalRunRef | undefined,
  }
}

/** Cancel active local CLI agent process (Electron) */
export async function cancelLocalCliAgent(runId?: string): Promise<{ ok: boolean; killed: number }> {
  if (!window.subagents?.cli?.cancel) return { ok: false, killed: 0 }
  return window.subagents.cli.cancel(runId)
}

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
    externalRun: partial.externalRun,
    cliConfigSnapshot: partial.cliConfigSnapshot,
    scheduleTrigger: partial.scheduleTrigger,
    eventTrigger: partial.eventTrigger,
    postState: partial.postState,
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
    if (p.id === 'opencode') return 'opencode'
    if (p.id === 'google' || p.id === 'gemini') return 'gemini'
    if (p.id === 'cursor') return 'cursor'
  }
  return 'builtin'
}
