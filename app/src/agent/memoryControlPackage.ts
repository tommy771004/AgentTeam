export type MemoryControlPackageIdentity = {
  id: string
  revision: number
  digest: string
}

export type MemoryControlComponent = {
  id: string
  revision: number
  digest: string
  body: Readonly<Record<string, unknown>>
}

export const MEMORY_CONTROL_COMPONENT_KEYS = [
  'experientialSkills',
  'workingMemorySpec',
  'invocationPolicy',
  'checkers',
] as const

export type MemoryControlComponentKey = typeof MEMORY_CONTROL_COMPONENT_KEYS[number]

export type MemoryControlLifecycleEvent = {
  sequence: number
  kind: 'candidate-created' | 'candidate-activated' | 'candidate-rejected' | 'rollback'
  revision: number
  fromRevision?: number
  diagnosisComponent?: MemoryControlComponentKey
  reason: string
}

export type MemoryControlLineage = {
  activeRevision: number
  packages: ReadonlyArray<Pick<MemoryControlPackage, 'id' | 'revision' | 'parentRevision' | 'digest' | 'status' | 'diagnosisComponent'>>
  events: ReadonlyArray<MemoryControlLifecycleEvent>
}

export type MemoryControlPackage = MemoryControlPackageIdentity & {
  schemaVersion: 1
  parentRevision?: number
  diagnosisComponent?: MemoryControlComponentKey
  status: 'candidate' | 'active' | 'rejected'
  components: {
    experientialSkills: MemoryControlComponent
    workingMemorySpec: MemoryControlComponent
    invocationPolicy: MemoryControlComponent
    checkers: MemoryControlComponent
  }
}

export type MemoryControlPackageReader = {
  admitActive(): MemoryControlPackage
  read(input: { schemaVersion: 1; revision?: number }): MemoryControlPackage
  lineage(): MemoryControlLineage
  evaluationReports(): ReadonlyArray<import('./memoryControlEvaluationContract.ts').MemoryControlEvaluationReport>
}

export type MemoryControlJsonPatchOperation = {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

export type MemoryControlPackageAuthority = MemoryControlPackageReader & {
  createCandidate(input: {
    expectedActiveRevision: number
    diagnosisComponent: MemoryControlComponentKey
    patch: readonly MemoryControlJsonPatchOperation[]
    reason: string
  }): Promise<MemoryControlPackage>
  activateCandidate(input: { revision: number; expectedActiveRevision: number; reason: string }): Promise<MemoryControlPackage>
  rejectCandidate(input: { revision: number; reason: string }): Promise<MemoryControlPackage>
  rollback(input: { revision: number; expectedActiveRevision: number; reason: string }): Promise<MemoryControlPackage>
  settleEvaluation(input: { report: import('./memoryControlEvaluationContract.ts').MemoryControlEvaluationReport }): Promise<MemoryControlPackage>
}

const SHA256 = /^[a-f0-9]{64}$/

export function isMemoryControlPackageIdentity(value: unknown): value is MemoryControlPackageIdentity {
  if (!value || typeof value !== 'object') return false
  const identity = value as Record<string, unknown>
  return Object.keys(identity).every((key) => ['id', 'revision', 'digest'].includes(key))
    && typeof identity.id === 'string' && identity.id.length > 0 && identity.id.length <= 256
    && Number.isSafeInteger(identity.revision) && Number(identity.revision) > 0
    && typeof identity.digest === 'string' && SHA256.test(identity.digest)
}

export function memoryControlPackageIdentity(value: MemoryControlPackage): MemoryControlPackageIdentity {
  return Object.freeze({ id: value.id, revision: value.revision, digest: value.digest })
}
