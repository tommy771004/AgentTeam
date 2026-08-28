import { canonicalMemoryControlEvaluationJson } from './memoryControlEvaluationContract.ts'
import {
  MEMORY_CONTROL_COMPONENT_KEYS,
  type MemoryControlComponentKey,
  type MemoryControlJsonPatchOperation,
  type MemoryControlPackage,
  type MemoryControlPackageAuthority,
  type MemoryControlPackageIdentity,
  type MemoryControlPackageReader,
} from './memoryControlPackage.ts'
import { parseTurnRecord, turnRecordEntries, type TurnRecord, type TurnRecordEntry } from './turnRecord.ts'

const MAX_DIAGNOSTIC_ENTRIES = 4_096
const MAX_DIAGNOSTIC_EVIDENCE = 16
const MAX_META_PATCH_OPERATIONS = 16
const MAX_META_PATCH_BYTES = 16 * 1024
const SHA256 = /^[a-f0-9]{64}$/

export type MemoryControlDiagnosticEvidence = Readonly<{
  seq: number
  kind: 'working-state' | 'skill-invocation' | 'skill-context' | 'tool-evidence' | 'tool-result' | 'state-check' | 'memory-control-package'
  callId?: string
  goalId?: string
}>

type DiagnosisBase = Readonly<{
  diagnosisId: string
  packageIdentity: MemoryControlPackageIdentity
  evidence: ReadonlyArray<MemoryControlDiagnosticEvidence>
}>

export type MemoryControlDiagnosis =
  | (DiagnosisBase & Readonly<{ status: 'localized'; component: MemoryControlComponentKey }>)
  | (DiagnosisBase & Readonly<{ status: 'insufficient'; reason: 'ambiguous' | 'no-supported-signal' }>)

export type MemoryControlMetaCandidateResult = Readonly<{
  diagnosis: Extract<MemoryControlDiagnosis, { status: 'localized' }>
  candidate: MemoryControlPackage
}>

type CandidateWriter = MemoryControlPackageReader & Pick<MemoryControlPackageAuthority, 'createCandidate'>

const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child)
    Object.freeze(value)
  }
  return value
}

async function sha256(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalMemoryControlEvaluationJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameIdentity(left: MemoryControlPackageIdentity, right: MemoryControlPackageIdentity): boolean {
  return left.id === right.id && left.revision === right.revision && left.digest === right.digest
}

function governingIdentity(entries: readonly TurnRecordEntry[]): MemoryControlPackageIdentity {
  const identities = entries.flatMap((entry) => entry.kind === 'memory-control-package' ? [entry.packageIdentity] : [])
  if (!identities.length || !identities.every((identity) => sameIdentity(identity, identities[0]))) {
    throw new Error('Meta-Agent diagnosis requires one structured governing package identity')
  }
  const identity = identities[0]
  for (const entry of entries) {
    const linked = entry.kind === 'skill-invocation' ? entry.invocation.packageIdentity
      : entry.kind === 'state-check' ? entry.packageIdentity
        : undefined
    if (linked && !sameIdentity(linked, identity)) throw new Error('Meta-Agent diagnosis trace mixes Memory-Control Package identities')
  }
  return frozen({ ...identity })
}

function evidenceRef(entry: TurnRecordEntry): MemoryControlDiagnosticEvidence | undefined {
  if (!['working-state', 'skill-invocation', 'skill-context', 'tool-evidence', 'tool-result', 'state-check', 'memory-control-package'].includes(entry.kind)) return undefined
  const callId = entry.kind === 'skill-invocation' ? entry.invocation.callId
    : entry.kind === 'skill-context' ? entry.injection.originalCallId
      : entry.kind === 'tool-result' || entry.kind === 'tool-evidence' ? entry.callId
        : entry.kind === 'state-check' ? entry.check.callId
          : undefined
  const goalId = entry.kind === 'state-check' ? entry.check.goalId : undefined
  return frozen({ seq: entry.seq, kind: entry.kind as MemoryControlDiagnosticEvidence['kind'], ...(callId ? { callId } : {}), ...(goalId ? { goalId } : {}) })
}

function checkerSignal(entries: readonly TurnRecordEntry[]): TurnRecordEntry[] | undefined {
  for (const checked of entries) {
    if (checked.kind !== 'state-check' || checked.check.verdict !== 'rejected') continue
    const result = entries.find((entry) => entry.seq < checked.seq && entry.kind === 'tool-result'
      && entry.callId === checked.check.callId && entry.settlement === 'success' && Boolean(entry.executionEvidence))
    const audit = entries.find((entry) => entry.seq < checked.seq && entry.kind === 'tool-evidence'
      && entry.callId === checked.check.callId && entry.phase === 'result' && entry.settlement === 'success')
    if (result && audit) return [audit, result, checked]
  }
  return undefined
}

function workingMemorySignal(entries: readonly TurnRecordEntry[]): TurnRecordEntry[] | undefined {
  for (const checked of entries) {
    if (checked.kind !== 'state-check' || checked.check.verdict !== 'accepted' || checked.check.committedRevision === undefined) continue
    if (checked.check.reason === 'completed-predicate-invalidated' || checked.check.reason.startsWith('goal-blocked:')) continue
    const state = entries.find((entry) => entry.seq > checked.seq && entry.kind === 'working-state'
      && entry.state.revision === checked.check.committedRevision)
    if (state?.kind !== 'working-state') continue
    const goal = state.state.goals.find((item) => item.id === checked.check.goalId)
    if (!goal || goal.status !== 'done' || goal.evidence.length === 0) {
      const evidence = entries.filter((entry) => entry.seq < checked.seq
        && (entry.kind === 'tool-result' || entry.kind === 'tool-evidence') && entry.callId === checked.check.callId)
      return [...evidence.slice(-2), checked, state]
    }
  }
  return undefined
}

function invocationPolicySignal(entries: readonly TurnRecordEntry[]): TurnRecordEntry[] | undefined {
  for (const invoked of entries) {
    if (invoked.kind !== 'skill-invocation' || invoked.invocation.decision !== 'pass-through' || invoked.invocation.matchCount !== 0) continue
    const result = entries.find((entry) => entry.seq > invoked.seq && entry.kind === 'tool-result'
      && entry.callId === invoked.invocation.callId && (entry.settlement === 'failed' || entry.settlement === 'denied'))
    if (result) return [invoked, result]
  }
  return undefined
}

function experientialSkillSignal(entries: readonly TurnRecordEntry[]): TurnRecordEntry[] | undefined {
  for (const invoked of entries) {
    if (invoked.kind !== 'skill-invocation' || invoked.invocation.decision !== 'redraft' || !invoked.invocation.selectedSkills?.length) continue
    const context = entries.find((entry) => entry.seq > invoked.seq && entry.kind === 'skill-context'
      && entry.injection.originalCallId === invoked.invocation.callId
      && entry.injection.tool === invoked.invocation.toolIdentity.tool)
    if (!context || context.kind !== 'skill-context') continue
    const result = entries.find((entry) => entry.seq > context.seq && entry.kind === 'tool-result'
      && entry.callId !== invoked.invocation.callId && entry.tool === context.injection.tool
      && (entry.settlement === 'failed' || entry.settlement === 'denied'))
    if (result) return [invoked, context, result]
  }
  return undefined
}

/** Localize only from bounded Host-authored control entries; prose is ignored. */
export async function diagnoseMemoryControlFailure(record: TurnRecord): Promise<MemoryControlDiagnosis> {
  const parsedResult = parseTurnRecord(record)
  if (parsedResult.tornTail) throw new Error('Meta-Agent diagnosis refuses a torn Turn Record')
  const parsed = parsedResult.record
  const entries = turnRecordEntries(parsed)
  if (!entries.length || entries.length > MAX_DIAGNOSTIC_ENTRIES) throw new Error('Meta-Agent diagnosis trace is empty or exceeds bounds')
  const packageIdentity = governingIdentity(entries)
  const signals = new Map<MemoryControlComponentKey, TurnRecordEntry[]>()
  const candidates = [
    ['experientialSkills', experientialSkillSignal(entries)],
    ['workingMemorySpec', workingMemorySignal(entries)],
    ['invocationPolicy', invocationPolicySignal(entries)],
    ['checkers', checkerSignal(entries)],
  ] as const
  for (const [component, signal] of candidates) if (signal) signals.set(component, signal)
  const selected = [...signals.entries()]
  const signalEntries = selected.flatMap(([, evidence]) => evidence)
  const evidence = [...new Map(signalEntries.flatMap((entry) => {
    const ref = evidenceRef(entry)
    return ref ? [[entry.seq, ref] as const] : []
  })).values()].sort((left, right) => left.seq - right.seq).slice(0, MAX_DIAGNOSTIC_EVIDENCE)
  const component = selected.length === 1 ? selected[0][0] : undefined
  const diagnosisId = await sha256({ packageIdentity, components: selected.map(([key]) => key), evidence })
  if (!component) return frozen({
    status: 'insufficient' as const,
    diagnosisId,
    packageIdentity,
    evidence,
    reason: selected.length > 1 ? 'ambiguous' as const : 'no-supported-signal' as const,
  })
  return frozen({ status: 'localized' as const, diagnosisId, packageIdentity, evidence, component })
}

type ValueRule = (value: unknown) => boolean
const integer = (minimum: number, maximum: number): ValueRule =>
  (value) => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
const oneOf = (...values: readonly unknown[]): ValueRule => (value) => values.includes(value)

const COMPONENT_PATCH_SCHEMA: Readonly<Record<MemoryControlComponentKey, Readonly<Record<string, ValueRule>>>> = frozen({
  experientialSkills: {
    '/source': oneOf('frozen-skill-resource-view'),
    '/selection': oneOf('exact-tool', 'tool-and-goal'),
    '/maxSelectedSkills': integer(1, 2),
  },
  workingMemorySpec: {
    '/schemaVersion': oneOf(1),
    '/authority': oneOf('pi-core-host'),
    '/optimisticConcurrency': oneOf(true),
  },
  invocationPolicy: {
    '/trigger': oneOf('state-changing-or-contract-required', 'contract-required'),
    '/batchBarrier': oneOf(true),
    '/maxSkills': integer(1, 2),
  },
  checkers: {
    '/fileContent': oneOf(1),
    '/delegatedGoal': oneOf(1),
    '/modelClaimsAreEvidence': oneOf(false),
  },
})

function validateMetaPatch(
  component: MemoryControlComponentKey,
  output: unknown,
  currentBody: Readonly<Record<string, unknown>>,
): readonly MemoryControlJsonPatchOperation[] {
  if (!Array.isArray(output) || output.length < 1 || output.length > MAX_META_PATCH_OPERATIONS) {
    throw new Error('Meta-Agent output must be one bounded JSON Patch array')
  }
  let encoded: string
  try { encoded = JSON.stringify(output) } catch { throw new Error('Meta-Agent JSON Patch is not serializable') }
  if (new TextEncoder().encode(encoded).byteLength > MAX_META_PATCH_BYTES) throw new Error('Meta-Agent JSON Patch exceeds bounds')
  const allowed = COMPONENT_PATCH_SCHEMA[component]
  const seen = new Set<string>()
  return frozen(output.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Meta-Agent JSON Patch operation is invalid')
    const operation = raw as Record<string, unknown>
    if (Object.keys(operation).length !== 3 || operation.op !== 'replace' || typeof operation.path !== 'string' || !('value' in operation)) {
      throw new Error('Meta-Agent output may only replace schema-declared component fields')
    }
    const rule = allowed[operation.path]
    if (!rule || !rule(operation.value) || seen.has(operation.path) || !Object.prototype.hasOwnProperty.call(currentBody, operation.path.slice(1))) {
      throw new Error('Meta-Agent JSON Patch violates the diagnosed component schema')
    }
    if (canonicalMemoryControlEvaluationJson(currentBody[operation.path.slice(1)]) === canonicalMemoryControlEvaluationJson(operation.value)) {
      throw new Error('Meta-Agent JSON Patch must change the diagnosed component')
    }
    seen.add(operation.path)
    return frozen({ op: 'replace' as const, path: operation.path, value: structuredClone(operation.value) })
  }))
}

/**
 * Candidate-only authority. The supplied interface deliberately has no
 * activate/reject/settle method, so this path cannot bypass evaluation.
 */
export async function createMemoryControlMetaCandidate(input: {
  packages: CandidateWriter
  record: TurnRecord
  output: unknown
}): Promise<MemoryControlMetaCandidateResult> {
  const diagnosis = await diagnoseMemoryControlFailure(input.record)
  if (diagnosis.status !== 'localized') throw new Error(`Meta-Agent diagnosis is insufficient: ${diagnosis.reason}`)
  if (!MEMORY_CONTROL_COMPONENT_KEYS.includes(diagnosis.component) || !SHA256.test(diagnosis.diagnosisId)) {
    throw new Error('Meta-Agent diagnosis is invalid')
  }
  const active = input.packages.admitActive()
  if (!sameIdentity(active, diagnosis.packageIdentity)) throw new Error('Meta-Agent diagnosis does not govern the active package')
  const patch = validateMetaPatch(diagnosis.component, input.output, active.components[diagnosis.component].body)
  const candidate = await input.packages.createCandidate({
    expectedActiveRevision: active.revision,
    diagnosisComponent: diagnosis.component,
    patch,
    reason: `meta-agent diagnosis ${diagnosis.diagnosisId}; trace seq ${diagnosis.evidence.map((entry) => entry.seq).join(',')}`,
  })
  const stillActive = input.packages.admitActive()
  if (!sameIdentity(stillActive, active) || candidate.status !== 'candidate' || candidate.parentRevision !== active.revision) {
    throw new Error('Meta-Agent candidate-only postcondition failed')
  }
  for (const key of MEMORY_CONTROL_COMPONENT_KEYS) {
    if (key !== diagnosis.component && candidate.components[key].digest !== active.components[key].digest) {
      throw new Error('Meta-Agent candidate changed an undiagnosed component')
    }
  }
  return frozen({ diagnosis, candidate })
}
