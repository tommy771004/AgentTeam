/**
 * Runner Adapter capability contract (Phase 5 / R3).
 *
 * Built-in loop and external CLI share one outcome shape (AgentState +
 * DispatchResult) but declare different capabilities so UI and continueGoal
 * cannot pretend CLI ran Parse / DoD / replan.
 */

export type ExecutionKind = 'loop' | 'external'

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
}

/** Full Goal/Hermes loop — agentEngine. */
export const BUILTIN_RUNNER_CAPABILITIES: RunnerCapabilities = {
  parse: true,
  validateDoD: true,
  iterate: true,
  continueGoal: true,
  progressiveCapabilities: true,
  runScopedProgress: true,
}

/**
 * Local CLI specialists (codex / claude / …).
 * Phase 5 keeps all Loop capabilities false until a prompt/evidence contract
 * and smoke fixture exist (see formatCliContinueGoalPrompt).
 */
export const EXTERNAL_CLI_RUNNER_CAPABILITIES: RunnerCapabilities = {
  parse: false,
  validateDoD: false,
  iterate: false,
  continueGoal: false,
  progressiveCapabilities: false,
  runScopedProgress: true,
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
 * verifiable evidence. Smoke fixtures assert this shape — capability stays false
 * until a runner-specific fixture is green.
 */
export type CliContinueGoalPromptContract = {
  objective: string
  definitionOfDone: string
  missing: string[]
  priorDigest?: string
  projectRoot?: string
  approvalMode?: string
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
    '## Required output',
    '- Address every missing gap with concrete evidence.',
    '- State clearly whether Definition of Done is met.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Validate that a contract is complete enough for a future CLI continueGoal fixture. */
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
