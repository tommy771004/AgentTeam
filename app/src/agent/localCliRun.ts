/**
 * Renderer helper: run prompt via local CLI and synthesize AgentState-like result
 */

import type { AgentState, ApprovalMode, CliConfigSnapshot, ExternalRunRef } from './types'
import { emptyKnowledge } from './knowledge'
import { resolveCliApproval } from './cliApproval'

export type LocalRunnerKind = 'codex' | 'claude' | 'grok' | 'opencode' | 'cursor'
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

  // Prefer long-lived stream subscription before invoke (if available)
  // so early stdout is not missed; agentStore also subscribes.
  const r = await window.subagents.cli.runAgent({
    kind: opts.kind,
    binary: opts.binary,
    prompt: opts.prompt,
    cwd: opts.cwd,
    model: opts.model,
    depth: opts.depth,
    agentMode: opts.agentMode,
    approvalMode: opts.approvalMode,
    unattended: opts.unattended,
    timeoutMs: 300_000,
    runId: opts.runId,
    attachments: opts.attachments,
    configSnapshot: opts.configSnapshot,
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
export async function cancelLocalCliAgent(): Promise<{ ok: boolean; killed: number }> {
  if (!window.subagents?.cli?.cancel) return { ok: false, killed: 0 }
  return window.subagents.cli.cancel()
}

export function emptyAgentLike(partial: Partial<AgentState> & { objective: string }): AgentState {
  return {
    id: partial.id || `cli_${Date.now().toString(36)}`,
    objective: partial.objective,
    loopConfig: partial.loopConfig || {
      loopType: 'Goal-based',
      trigger: 'local-cli',
      executionSequence: ['local-cli'],
      definitionOfDone: 'CLI returned',
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
    if (p.id === 'cursor') return 'cursor'
  }
  return 'builtin'
}
