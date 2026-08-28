import type { MemoryControlPackage } from '../src/agent/memoryControlPackage.ts'
import { parsePreflightSkill } from './piSkills.ts'

/** Executable, versioned policy. Package JSON can select supported behavior, never code. */
export type MemoryControlRuntime = Readonly<{
  maxGoals: number
  fileContentChecker: boolean
  delegatedGoalChecker: boolean
  trigger: 'state-changing-or-contract-required' | 'contract-required'
  selection: 'exact-tool' | 'tool-and-goal'
  maxSkills: 1 | 2
  secondSkillReason?: string
  skillOverrides: Readonly<Record<string, string>>
}>

function fields(body: Readonly<Record<string, unknown>>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('Unsupported Memory-Control component field')
}

function count(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new Error('Unsupported Memory-Control bound')
  return Number(value)
}

function checker(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw new Error('Unsupported Memory-Control Checker version')
  return value === 1
}

function overrides(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({})
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) throw new Error('Invalid Memory-Control Skill overrides')
  for (const [id, raw] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || typeof raw !== 'string'
      || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 16_384) throw new Error('Invalid Memory-Control Skill override')
    if (parsePreflightSkill(raw)?.id !== id) throw new Error('Memory-Control Skill override must contain its exact valid identity and tool contract')
  }
  return Object.freeze({ ...value } as Record<string, string>)
}

/** Also called before activation/rollback, so unsupported packages never become active. */
export function compileMemoryControlRuntime(value: MemoryControlPackage, goalCount = 0): MemoryControlRuntime {
  const skills = value.components.experientialSkills.body
  const working = value.components.workingMemorySpec.body
  const policy = value.components.invocationPolicy.body
  const checks = value.components.checkers.body
  fields(skills, ['source', 'selection', 'maxSelectedSkills', 'overrides'])
  fields(working, ['schemaVersion', 'authority', 'optimisticConcurrency', 'maxGoals'])
  fields(policy, ['trigger', 'batchBarrier', 'maxSkills', 'secondSkillReason'])
  fields(checks, ['fileContent', 'delegatedGoal', 'modelClaimsAreEvidence'])
  if (skills.source !== 'frozen-skill-resource-view'
    || (skills.selection !== 'exact-tool' && skills.selection !== 'tool-and-goal')
    || working.schemaVersion !== 1 || working.authority !== 'pi-core-host' || working.optimisticConcurrency !== true
    || policy.batchBarrier !== true || checks.modelClaimsAreEvidence !== false
    || (policy.trigger !== 'state-changing-or-contract-required' && policy.trigger !== 'contract-required')) {
    throw new Error('Unsupported Memory-Control policy or weakened Host invariant')
  }
  const reason = policy.secondSkillReason
  if (reason !== undefined && (typeof reason !== 'string' || !reason.trim() || reason.length > 400)) throw new Error('Invalid second Skill reason')
  const maximum = Math.min(count(skills.maxSelectedSkills, 2), count(policy.maxSkills, 2))
  const maxGoals = count(working.maxGoals ?? 100, 100)
  if (goalCount > maxGoals) throw new Error('Working goals exceed the governing Memory-Control Package bound')
  return Object.freeze({
    maxGoals,
    fileContentChecker: checker(checks.fileContent),
    delegatedGoalChecker: checker(checks.delegatedGoal),
    trigger: policy.trigger,
    selection: skills.selection,
    // A second Skill remains opt-in with a recorded explicit justification.
    maxSkills: maximum === 2 && reason ? 2 : 1,
    ...(reason ? { secondSkillReason: reason as string } : {}),
    skillOverrides: overrides(skills.overrides),
  })
}
