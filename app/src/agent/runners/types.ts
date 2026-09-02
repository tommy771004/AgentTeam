/**
 * Runner Adapter capability contract (Phase 5 / R3).
 *
 * Built-in loop and external CLI share one outcome shape (AgentState +
 * DispatchResult) but declare different capabilities so UI and continueGoal
 * cannot pretend CLI ran Parse / DoD / replan.
 */

export type ExecutionKind = 'loop' | 'external'
export type RunnerInstructionDelivery = Readonly<{
  mode: 'explicit' | 'native' | 'unverified'
  exactSnapshot: boolean
  detail: string
}>

/**
 * Every runner the product can dispatch to. One source of truth: the delegate
 * tool schema, its argument validation, and the evaluation harness all derive
 * from this rather than each restating the list.
 */
export const RUNNER_IDS = [
  'builtin',
  'codex',
  'claude',
  'grok',
  'gemini',
  'cursor',
] as const

export type RunnerId = (typeof RUNNER_IDS)[number]

export type RunnerCapabilities = {
  /** Structured Parse / loop-type classification inside the adapter. */
  parse: boolean
  /** Evaluate Definition of Done against evidence. */
  validateDoD: boolean
  /** Gap-driven replan / iterate within the same run. */
  iterate: boolean
  /** Resume prior Goal snapshot (DoD + missing + prior digest). */
  continueGoal: boolean
  /** Progressive capability packs / tool_search / load_capability. */
  progressiveCapabilities: boolean
  /** Run-scoped progress streams (activity / cancel by runId). */
  runScopedProgress: boolean
  /** Host-authored, revisioned Working State snapshots. */
  workingState: boolean
  /** Host-owned Skill match / redraft / retry admission. */
  skillPreflight: boolean
  /** Host Checkers binding completion to execution evidence. */
  checkers: boolean
  /** Reuse one durable agent/provider conversation identity across executions. */
  sessionReuse: boolean
  /** Durable queue-only peer mailbox. */
  mailbox: boolean
  /** Authorized follow-up on the same child identity. */
  followUp: boolean
  /** Host can stop the execution and report a truthful terminal outcome. */
  interrupt: boolean
  /** Runner settlement can be delivered as an observation (never implicit DoD). */
  completion: boolean
}

/** Full Goal/Hermes loop, owned by Pi Core orchestration. */
export const BUILTIN_RUNNER_CAPABILITIES: Readonly<RunnerCapabilities> = Object.freeze({
  parse: true,
  validateDoD: true,
  iterate: true,
  continueGoal: true,
  progressiveCapabilities: true,
  runScopedProgress: true,
  workingState: true,
  skillPreflight: true,
  checkers: true,
  sessionReuse: true,
  mailbox: true,
  followUp: true,
  interrupt: true,
  completion: true,
})

/**
 * Local CLI specialists (codex / claude / …). They do not run the builtin
 * Parse/DoD/iterate/capability machinery. `continueGoal` is different: it is
 * implemented by an explicit prompt contract, so it can be enabled without
 * claiming that the CLI performed builtin validation.
 */
export const EXTERNAL_CLI_RUNNER_CAPABILITIES: Readonly<RunnerCapabilities> = Object.freeze({
  parse: false,
  validateDoD: false,
  iterate: false,
  continueGoal: true,
  progressiveCapabilities: false,
  runScopedProgress: true,
  workingState: false,
  skillPreflight: false,
  checkers: false,
  sessionReuse: false,
  mailbox: false,
  followUp: false,
  interrupt: true,
  completion: true,
})

/** Multiple external processes coordinated by a Host-authored continuation envelope. */
export const EXTERNAL_ORCHESTRATED_RUNNER_CAPABILITIES: Readonly<RunnerCapabilities> = Object.freeze({
  parse: true,
  validateDoD: false,
  iterate: true,
  continueGoal: true,
  progressiveCapabilities: false,
  runScopedProgress: true,
  workingState: false,
  skillPreflight: false,
  checkers: false,
  sessionReuse: false,
  mailbox: false,
  followUp: false,
  interrupt: true,
  completion: true,
})

/** No Host record and no frozen run snapshot means no guarantee may be inferred. */
export const UNAVAILABLE_RUNNER_CAPABILITIES: Readonly<RunnerCapabilities> = Object.freeze({
  parse: false,
  validateDoD: false,
  iterate: false,
  continueGoal: false,
  progressiveCapabilities: false,
  runScopedProgress: false,
  workingState: false,
  skillPreflight: false,
  checkers: false,
  sessionReuse: false,
  mailbox: false,
  followUp: false,
  interrupt: false,
  completion: false,
})

export type RunnerCapabilitySnapshot = Readonly<{
  runner?: string
  guarantee: 'host-verified' | 'run-snapshot' | 'reduced' | 'unavailable' | 'legacy-unrecorded'
  capabilities: Readonly<RunnerCapabilities>
}>

/**
 * Project only facts frozen when the run executed. Current Settings are not an
 * input, so live, replay and Archive cannot rewrite historical guarantees.
 */
export function projectRunnerCapabilitySnapshot(
  declaration?: { runner: string; capabilities?: RunnerCapabilities },
  frozenRunCapabilities?: RunnerCapabilities,
  options?: { missingEvidence?: 'runtime-unavailable' | 'legacy-unrecorded' },
): RunnerCapabilitySnapshot {
  const capabilities = declaration?.capabilities || frozenRunCapabilities
  if (!capabilities) {
    return Object.freeze({
      guarantee: options?.missingEvidence === 'legacy-unrecorded'
        ? 'legacy-unrecorded' as const
        : 'unavailable' as const,
      capabilities: UNAVAILABLE_RUNNER_CAPABILITIES,
    })
  }
  const runner = declaration?.runner
  const guarantee = runner
    ? runner === 'builtin' ? 'host-verified' as const : 'reduced' as const
    : 'run-snapshot' as const
  return Object.freeze({
    ...(runner ? { runner } : {}),
    guarantee,
    capabilities: Object.freeze({
      ...UNAVAILABLE_RUNNER_CAPABILITIES,
      ...capabilities,
    }),
  })
}

export function isBuiltinRunner(runner?: string | null): boolean {
  return !runner || runner === 'builtin'
}

export function capabilitiesForRunner(runner?: string | null): RunnerCapabilities {
  return isBuiltinRunner(runner)
    ? BUILTIN_RUNNER_CAPABILITIES
    : EXTERNAL_CLI_RUNNER_CAPABILITIES
}

export function executionKindForRunner(runner?: string | null): ExecutionKind {
  return isBuiltinRunner(runner) ? 'loop' : 'external'
}

export function instructionDeliveryForRunner(runner?: string | null): RunnerInstructionDelivery {
  if (isBuiltinRunner(runner)) return Object.freeze({ mode: 'explicit', exactSnapshot: true, detail: 'Pi Host admission snapshot' })
  if (runner === 'codex' || runner === 'claude') return Object.freeze({ mode: 'native', exactSnapshot: false, detail: 'global explicit + native filesystem discovery' })
  return Object.freeze({ mode: 'unverified', exactSnapshot: false, detail: 'bounded explicit wrapper; provider discovery cannot be proven' })
}

/** Honest DoD label for external CLI — never "CLI returned" as if DoD met. */
export const EXTERNAL_CLI_DOD_LABEL =
  '外部 CLI 執行結束（未執行內建 DoD 驗證／iterate）'

/** Short UI badge for external runs. */
export const EXTERNAL_CLI_UI_LABEL = '外部 CLI 執行'

export function formatRunnerCapabilitiesSummary(caps: RunnerCapabilities): string {
  const on: string[] = []
  const off: string[] = []
  const labels: Array<[keyof RunnerCapabilities, string]> = [
    ['parse', 'Parse'],
    ['validateDoD', 'DoD'],
    ['iterate', 'Iterate'],
    ['continueGoal', 'continueGoal'],
    ['progressiveCapabilities', '能力包'],
    ['runScopedProgress', 'run 進度'],
    ['workingState', 'Verified Working State'],
    ['skillPreflight', 'Skill preflight'],
    ['checkers', 'Checkers'],
    ['sessionReuse', 'session reuse'],
    ['mailbox', 'durable mailbox'],
    ['followUp', 'same-agent follow-up'],
    ['interrupt', 'interrupt'],
    ['completion', 'completion observation'],
  ]
  for (const [key, label] of labels) {
    if (caps[key]) on.push(label)
    else off.push(label)
  }
  const parts: string[] = []
  if (on.length) parts.push(`支援：${on.join(' · ')}`)
  if (off.length) parts.push(`未支援：${off.join(' · ')}`)
  return parts.join('；') || '（無宣告能力）'
}

/**
 * Prompt contract required before CLI `continueGoal` may be enabled.
 * All fields must be explicit in the external prompt; results must return
 * verifiable evidence. The parity smoke asserts this shape for builtin and
 * external runners alike.
 */
export type CliContinueGoalPromptContract = {
  objective: string
  definitionOfDone: string
  missing: string[]
  priorDigest?: string
  projectRoot?: string
  approvalMode?: string
  userHint?: string
}

/**
 * Contract carried when a CLI is used as a delegated worker. The child gets a
 * bounded, role-specific tool surface and never receives the parent's raw
 * transcript. This is metadata as well as a prompt boundary: the coordinator
 * remains the only lifecycle ingress.
 */
export type ExternalCliDelegateContract = {
  kind: 'external-cli-delegate'
  role: 'leaf' | 'orchestrator'
  parentTranscript: 'none'
  unattended: boolean
  blockedTools: string[]
  collaboration: {
    identity: 'new-execution'
    send: 'unsupported'
    wait: 'unsupported'
    followUp: 'new-execution'
    interrupt: 'host-process'
    completion: 'runner-settlement'
  }
  continueGoal?: CliContinueGoalPromptContract
}

/**
 * Tools a leaf worker never gets, regardless of runner.
 */
export const LEAF_BLOCKED_TOOLS = [
  'skill_save',
  'delegate_task',
  'run_code',
  'bash',
  'workspace_write',
  'workspace_download',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
  'design_artifact_register',
  'design_artifact_export',
  'message_send',
  'mcp_call',
] as const

export function buildExternalCliDelegateContract(opts: {
  role?: 'leaf' | 'orchestrator'
  unattended?: boolean
  continueGoal?: CliContinueGoalPromptContract
} = {}): ExternalCliDelegateContract {
  return {
    kind: 'external-cli-delegate',
    role: opts.role || 'leaf',
    parentTranscript: 'none',
    unattended: opts.unattended !== false,
    blockedTools:
      opts.role === 'orchestrator'
        ? ['delegate_task']
        : [...LEAF_BLOCKED_TOOLS],
    collaboration: {
      identity: 'new-execution',
      send: 'unsupported',
      wait: 'unsupported',
      followUp: 'new-execution',
      interrupt: 'host-process',
      completion: 'runner-settlement',
    },
    continueGoal: opts.continueGoal,
  }
}

/**
 * Derive the CLI continueGoal contract from the same `continueGoal` override
 * the builtin runner restores from. Extracted so parity is provable: both
 * runners read one source of DoD / missing / digest rather than each shaping
 * its own. An explicit `externalCliContract.continueGoal` wins when present.
 */
export function buildCliContinueGoalContract(
  overrides: {
    continueGoal?: {
      objective: string
      definitionOfDone: string
      missing?: string[]
      priorDigest?: string
      userHint?: string
    }
    externalCliContract?: { continueGoal?: CliContinueGoalPromptContract }
    approvalMode?: string
  },
  context: { projectRoot?: string; approvalMode?: string } = {},
): CliContinueGoalPromptContract | undefined {
  const explicit = overrides.externalCliContract?.continueGoal
  if (explicit) return explicit
  const resume = overrides.continueGoal
  if (!resume) return undefined
  return {
    objective: resume.objective,
    definitionOfDone: resume.definitionOfDone,
    missing: resume.missing || [],
    priorDigest: resume.priorDigest,
    projectRoot: context.projectRoot,
    approvalMode: overrides.approvalMode || context.approvalMode,
    userHint: resume.userHint,
  }
}

/** Build a corrective CLI prompt only after the capability is turned on. */
export function formatCliContinueGoalPrompt(
  contract: CliContinueGoalPromptContract,
): string {
  const missing =
    contract.missing.length > 0
      ? contract.missing.map((m, i) => `${i + 1}. ${m}`).join('\n')
      : '（無明細缺口 — 請依 DoD 自行檢查）'
  return [
    '# Continue Goal — external CLI contract',
    'You are resuming a Goal that did not meet Definition of Done.',
    'Do not invent prior tool evidence; use only the digest and missing list.',
    '',
    '## Objective',
    contract.objective.trim(),
    '',
    '## Definition of Done (must satisfy)',
    contract.definitionOfDone.trim(),
    '',
    '## Missing gaps',
    missing,
    '',
    contract.priorDigest?.trim()
      ? `## Prior digest\n${contract.priorDigest.trim().slice(0, 2500)}`
      : '## Prior digest\n（無）',
    '',
    contract.projectRoot?.trim()
      ? `## Project root\n${contract.projectRoot.trim()}`
      : '## Project root\n（未指定）',
    '',
    contract.approvalMode
      ? `## Approval mode\n${contract.approvalMode}`
      : '## Approval mode\n（預設）',
    '',
    contract.userHint?.trim()
      ? `## Current user hint\n${contract.userHint.trim().slice(0, 1200)}`
      : '',
    '',
    '## Required output',
    '- Address every missing gap with concrete evidence.',
    '- State clearly whether Definition of Done is met.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Validate that a contract is complete enough for a CLI continueGoal run. */
export function isCompleteCliContinueGoalContract(
  value: unknown,
): value is CliContinueGoalPromptContract {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<CliContinueGoalPromptContract>
  return (
    typeof v.objective === 'string' &&
    v.objective.trim().length > 0 &&
    typeof v.definitionOfDone === 'string' &&
    v.definitionOfDone.trim().length > 0 &&
    Array.isArray(v.missing)
  )
}
