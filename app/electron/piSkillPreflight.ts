import { createHash } from 'node:crypto'
import { canonicalJson } from './piToolContract.ts'
import { shouldRunSkillPreflight, type PiInvocationContractIdentity } from './piPolicyEvidence.ts'
import type { SkillInvocationTrace, SkillPreflightPackageIdentity, SkillRevisionIdentity } from '../src/agent/skillPreflight.ts'
import type { WorkingState } from '../src/agent/workingState.ts'

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const MAX_DRAFT_SAMPLE_BYTES = 4_096
export const MAX_SKILL_PREFLIGHT_DRAFT_BYTES = 65_536
const MAX_CANONICAL_DEPTH = 64

export const BASELINE_MEMORY_CONTROL_PACKAGE: SkillPreflightPackageIdentity = Object.freeze({
  id: 'agentteam-memory-control-baseline',
  revision: 1,
  digest: 'bc97618bbaddba54582e8aad3771f896b77dbf08b88b0e4ed7b4ff1b85dae691',
})

export { shouldRunSkillPreflight }

function hashCanonicalDraft(value: unknown): { digest: string; serializedBytes: number } {
  const hash = createHash('sha256')
  const ancestors = new Set<object>()
  let serializedBytes = 0
  const write = (fragment: string) => {
    const bytes = Buffer.byteLength(fragment, 'utf8')
    if (serializedBytes + bytes > MAX_SKILL_PREFLIGHT_DRAFT_BYTES) {
      throw new Error(`Skill preflight draft exceeds ${MAX_SKILL_PREFLIGHT_DRAFT_BYTES} bytes`)
    }
    serializedBytes += bytes
    hash.update(fragment, 'utf8')
  }
  const writeString = (fragment: string) => {
    // JSON escaping can only increase the encoded length. Reject a large raw
    // string before allocating its escaped representation.
    if (Buffer.byteLength(fragment, 'utf8') + 2 > MAX_SKILL_PREFLIGHT_DRAFT_BYTES - serializedBytes) {
      throw new Error(`Skill preflight draft exceeds ${MAX_SKILL_PREFLIGHT_DRAFT_BYTES} bytes`)
    }
    write(JSON.stringify(fragment))
  }
  const visit = (current: unknown, depth: number, arraySlot = false): void => {
    if (depth > MAX_CANONICAL_DEPTH) throw new Error(`Skill preflight draft exceeds ${MAX_CANONICAL_DEPTH} levels`)
    if (current === null || typeof current === 'boolean') return write(String(current))
    if (typeof current === 'number') return write(Number.isFinite(current) ? JSON.stringify(current) : 'null')
    if (typeof current === 'string') return writeString(current)
    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') {
      if (arraySlot) write('null')
      return
    }
    if (typeof current !== 'object') throw new Error('Skill preflight draft is not JSON serializable')
    if (ancestors.has(current)) throw new Error('Skill preflight draft contains a cycle')
    ancestors.add(current)
    if (Array.isArray(current)) {
      write('[')
      current.forEach((item, index) => {
        if (index) write(',')
        visit(item, depth + 1, true)
      })
      write(']')
    } else {
      write('{')
      const object = current as Record<string, unknown>
      const keys = Object.keys(object).filter((key) => object[key] !== undefined).sort()
      keys.forEach((key, index) => {
        if (index) write(',')
        writeString(key)
        write(':')
        visit(object[key], depth + 1)
      })
      write('}')
    }
    ancestors.delete(current)
  }
  visit(value, 0)
  return { digest: hash.digest('hex'), serializedBytes }
}

function draftCharacteristics(args: Record<string, unknown>): SkillInvocationTrace['draft'] {
  const canonical = hashCanonicalDraft(args)
  return {
    keys: Object.keys(args).sort().slice(0, 64).map((key) => key.slice(0, 128)),
    serializedBytes: canonical.serializedBytes,
    sampleBytes: Math.min(canonical.serializedBytes, MAX_DRAFT_SAMPLE_BYTES),
    // The trace stores no draft body, but its identity covers the WHOLE
    // canonical draft so equal prefixes cannot alias different side effects.
    digest: canonical.digest,
  }
}

export function createSkillPreflight(input: {
  state: WorkingState
  /** Active execution run; resumed Working State may retain the checkpoint owner's runId. */
  runId?: string
  step: number
  tool: string
  callId: string
  batchId: string
  identity: PiInvocationContractIdentity
  args: Record<string, unknown>
  trigger?: SkillInvocationTrace['trigger']
  selectedSkills?: SkillRevisionIdentity[]
}): SkillInvocationTrace {
  const runId = input.runId || input.state.runId
  const goalIds = input.state.goals
    .filter((goal) => goal.status === 'pending' || goal.status === 'blocked')
    .map((goal) => goal.id)
  const blockers = input.state.goals
    .filter((goal) => goal.status === 'blocked' && goal.blocker)
    .map((goal) => ({ id: goal.id, blocker: goal.blocker }))
  const draft = draftCharacteristics(input.args)
  const toolIdentity = { tool: input.tool, ...input.identity }
  const retrievalKeyDigest = sha256(canonicalJson({
    workingStateRevision: input.state.revision,
    goalIds,
    constraints: input.state.constraints,
    blockers,
    toolIdentity,
    draft,
  }))
  const identityDigest = sha256(canonicalJson({
    runId,
    step: input.step,
    batchId: input.batchId,
    callId: input.callId,
    workingStateRevision: input.state.revision,
    toolIdentity,
    draft,
  }))
  const selectedSkills = input.selectedSkills?.slice(0, 2)
  return {
    schemaVersion: 2,
    invocationId: `skill-preflight:${runId}:${input.step}:${input.batchId}:${input.callId}:${input.state.revision}`.slice(0, 512),
    runId,
    step: input.step,
    callId: input.callId,
    batchId: input.batchId,
    identityDigest,
    trigger: input.trigger || 'state-changing-tool-call',
    workingStateRevision: input.state.revision,
    goalIds,
    retrievalKeyDigest,
    matchCount: (selectedSkills?.length || 0) as 0 | 1 | 2,
    decision: selectedSkills?.length ? 'redraft' : 'pass-through',
    ...(selectedSkills?.length ? { selectedSkills } : {}),
    packageIdentity: BASELINE_MEMORY_CONTROL_PACKAGE,
    toolIdentity,
    draft,
  }
}

export function createZeroHitSkillPreflight(input: Omit<Parameters<typeof createSkillPreflight>[0], 'selectedSkills'>): SkillInvocationTrace {
  return createSkillPreflight(input)
}
