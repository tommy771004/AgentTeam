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

export type MemoryControlPackage = MemoryControlPackageIdentity & {
  schemaVersion: 1
  parentRevision?: number
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
