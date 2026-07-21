/**
 * Policy Source Mode — independent of guard mode (ADR-0013).
 * No implicit auto; only local | workspace.
 */

export type PolicySourceMode = 'local' | 'workspace'

export function parsePolicySourceMode(raw: string | undefined | null): PolicySourceMode {
  if (raw == null || String(raw).trim() === '') return 'local'
  const v = String(raw).trim().toLowerCase()
  if (v === 'local' || v === 'workspace') return v
  throw new Error(
    `Invalid SUBAGENTS_POLICY_SOURCE="${raw}". Expected local|workspace (no auto).`,
  )
}
