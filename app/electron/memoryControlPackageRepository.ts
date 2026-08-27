import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canonicalJson } from './piToolContract.ts'
import type {
  MemoryControlComponent,
  MemoryControlPackage,
  MemoryControlPackageReader,
} from '../src/agent/memoryControlPackage.ts'

type ComponentDraft = Omit<MemoryControlComponent, 'digest'> | MemoryControlComponent
type PackageComponents = MemoryControlPackage['components']
type PackageComponentDrafts = { [K in keyof PackageComponents]: ComponentDraft }

export type MemoryControlPackageDocument = {
  schemaVersion: 1
  activeRevision: number
  packages: MemoryControlPackage[]
}

const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
export const MAX_MEMORY_CONTROL_REPOSITORY_BYTES = 2 * 1024 * 1024
export const MAX_MEMORY_CONTROL_PACKAGES = 128
export const MAX_MEMORY_CONTROL_COMPONENT_BYTES = 64 * 1024
const MAX_COMPONENT_DEPTH = 32
const MAX_COMPONENT_NODES = 10_000
const MAX_CONTAINER_ITEMS = 1_024
const MAX_STRING_BYTES = 16 * 1024

function validateBoundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1
  if (depth > MAX_COMPONENT_DEPTH || budget.nodes > MAX_COMPONENT_NODES) throw new Error('Memory-Control Package component body exceeds bounds')
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) throw new Error('Memory-Control Package component body exceeds bounds')
    return
  }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTAINER_ITEMS) throw new Error('Memory-Control Package component body exceeds bounds')
    for (const child of value) validateBoundedJson(child, depth + 1, budget)
    return
  }
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package component body is not JSON')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_CONTAINER_ITEMS) throw new Error('Memory-Control Package component body exceeds bounds')
  for (const [key, child] of entries) {
    if (Buffer.byteLength(key, 'utf8') > 256) throw new Error('Memory-Control Package component body exceeds bounds')
    validateBoundedJson(child, depth + 1, budget)
  }
}

function validateComponentBody(body: unknown): asserts body is Readonly<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Memory-Control Package component body is corrupt')
  validateBoundedJson(body)
  if (Buffer.byteLength(canonicalJson(body), 'utf8') > MAX_MEMORY_CONTROL_COMPONENT_BYTES) {
    throw new Error('Memory-Control Package component body exceeds bounds')
  }
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function immutableClone<T>(value: T): T {
  return freezeDeep(structuredClone(value))
}

function component(input: ComponentDraft): MemoryControlComponent {
  validateComponentBody(input.body)
  const identity = { id: input.id, revision: input.revision }
  return immutableClone({ ...identity, digest: sha256({ ...identity, body: input.body }), body: input.body })
}

export function createMemoryControlPackage(input: {
  id: string
  revision: number
  parentRevision?: number
  status: MemoryControlPackage['status']
  components: PackageComponentDrafts
}): MemoryControlPackage {
  const components = Object.fromEntries(Object.entries(input.components).map(([key, value]) => [key, component(value)])) as PackageComponents
  const identityBody = {
    id: input.id,
    revision: input.revision,
    ...(input.parentRevision ? { parentRevision: input.parentRevision } : {}),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, {
      id: value.id, revision: value.revision, digest: value.digest,
    }])),
  }
  return immutableClone({
    schemaVersion: 1 as const,
    ...identityBody,
    digest: sha256(identityBody),
    status: input.status,
    components,
  })
}

export const BASELINE_MEMORY_CONTROL_PACKAGE = createMemoryControlPackage({
  id: 'agentteam-memory-control-baseline',
  revision: 1,
  status: 'active',
  components: {
    experientialSkills: {
      id: 'experiential-skills', revision: 1,
      body: { source: 'frozen-skill-resource-view', selection: 'exact-tool', maxSelectedSkills: 2 },
    },
    workingMemorySpec: {
      id: 'verified-working-state', revision: 1,
      body: { schemaVersion: 1, authority: 'pi-core-host', optimisticConcurrency: true },
    },
    invocationPolicy: {
      id: 'skill-preflight-policy', revision: 1,
      body: { trigger: 'state-changing-or-contract-required', batchBarrier: true, maxSkills: 2 },
    },
    checkers: {
      id: 'host-working-state-checkers', revision: 1,
      body: { fileContent: 1, delegatedGoal: 1, modelClaimsAreEvidence: false },
    },
  },
})

export function memoryControlPackageDocument(
  packages: readonly MemoryControlPackage[],
  activeRevision: number,
): MemoryControlPackageDocument {
  return {
    schemaVersion: 1,
    activeRevision,
    packages: packages.map((entry) => immutableClone({
      ...entry,
      status: entry.revision === activeRevision ? 'active' : entry.status === 'active' ? 'rejected' : entry.status,
    })),
  }
}

function validateComponent(value: unknown): MemoryControlComponent {
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package component is corrupt')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['id', 'revision', 'digest', 'body'].includes(key))
    || typeof item.id !== 'string' || !item.id || item.id.length > 256
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || typeof item.digest !== 'string' || !item.body || typeof item.body !== 'object' || Array.isArray(item.body)) {
    throw new Error('Memory-Control Package component is corrupt')
  }
  const expected = component(item as unknown as ComponentDraft)
  if (expected.digest !== item.digest) throw new Error(`Memory-Control Package component digest mismatch: ${item.id}`)
  return expected
}

function validatePackage(value: unknown): MemoryControlPackage {
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package is corrupt')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some((key) => !['schemaVersion', 'id', 'revision', 'parentRevision', 'digest', 'status', 'components'].includes(key))
    || item.schemaVersion !== 1 || typeof item.id !== 'string' || !item.id || item.id.length > 256
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1
    || (item.parentRevision !== undefined && (!Number.isSafeInteger(item.parentRevision) || Number(item.parentRevision) < 1))
    || !['candidate', 'active', 'rejected'].includes(String(item.status))
    || !item.components || typeof item.components !== 'object' || Array.isArray(item.components)) {
    throw new Error('Memory-Control Package is corrupt')
  }
  const raw = item.components as Record<string, unknown>
  const keys = ['experientialSkills', 'workingMemorySpec', 'invocationPolicy', 'checkers'] as const
  if (Object.keys(raw).length !== keys.length || keys.some((key) => !(key in raw))) throw new Error('Memory-Control Package components are incomplete')
  const rebuilt = createMemoryControlPackage({
    id: item.id,
    revision: Number(item.revision),
    ...(item.parentRevision === undefined ? {} : { parentRevision: Number(item.parentRevision) }),
    status: item.status as MemoryControlPackage['status'],
    components: Object.fromEntries(keys.map((key) => [key, validateComponent(raw[key])])) as PackageComponentDrafts,
  })
  if (rebuilt.digest !== item.digest) throw new Error(`Memory-Control Package digest mismatch: ${item.id}@${item.revision}`)
  return rebuilt
}

function parseDocument(source: string): MemoryControlPackageDocument {
  if (Buffer.byteLength(source, 'utf8') > MAX_MEMORY_CONTROL_REPOSITORY_BYTES) throw new Error('Memory-Control Package repository exceeds bounds')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('Memory-Control Package repository is corrupt') }
  if (!value || typeof value !== 'object') throw new Error('Memory-Control Package repository is corrupt')
  const document = value as Record<string, unknown>
  if (Object.keys(document).some((key) => !['schemaVersion', 'activeRevision', 'packages'].includes(key))
    || document.schemaVersion !== 1 || !Number.isSafeInteger(document.activeRevision) || !Array.isArray(document.packages)
    || document.packages.length < 1 || document.packages.length > MAX_MEMORY_CONTROL_PACKAGES) {
    throw new Error('Memory-Control Package repository schema version or shape is invalid')
  }
  const packages = document.packages.map(validatePackage)
  const revisions = new Set<number>()
  for (const entry of packages) {
    if (revisions.has(entry.revision)) throw new Error('Memory-Control Package revision is duplicated')
    revisions.add(entry.revision)
    if (entry.parentRevision === undefined) {
      if (entry.revision !== 1) throw new Error('Memory-Control Package non-root revision has no parent')
      continue
    }
    const parent = packages.find((candidate) => candidate.revision === entry.parentRevision)
    if (!parent || parent.id !== entry.id || parent.revision >= entry.revision) {
      throw new Error('Memory-Control Package parent lineage is unknown or corrupt')
    }
  }
  const active = packages.find((entry) => entry.revision === document.activeRevision)
  if (!active || active.status !== 'active' || packages.filter((entry) => entry.status === 'active').length !== 1) {
    throw new Error('Memory-Control Package active revision is unknown or corrupt')
  }
  return immutableClone({ schemaVersion: 1, activeRevision: Number(document.activeRevision), packages })
}

async function atomicWrite(path: string, document: MemoryControlPackageDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export class JsonMemoryControlPackageRepository implements MemoryControlPackageReader {
  private readonly document: MemoryControlPackageDocument

  private constructor(document: MemoryControlPackageDocument) {
    this.document = document
  }

  static async open(path: string): Promise<JsonMemoryControlPackageRepository> {
    let source: string
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_MEMORY_CONTROL_REPOSITORY_BYTES) throw new Error('Memory-Control Package repository exceeds bounds')
      source = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const initial = memoryControlPackageDocument([BASELINE_MEMORY_CONTROL_PACKAGE], 1)
      await atomicWrite(path, initial)
      source = JSON.stringify(initial)
    }
    return new JsonMemoryControlPackageRepository(parseDocument(source))
  }

  admitActive(): MemoryControlPackage {
    return this.read({ schemaVersion: 1, revision: this.document.activeRevision })
  }

  read(input: { schemaVersion: 1; revision?: number }): MemoryControlPackage {
    if (input.schemaVersion !== 1) throw new Error('Unsupported Memory-Control Package schema version')
    const revision = input.revision ?? this.document.activeRevision
    const found = this.document.packages.find((entry) => entry.revision === revision)
    if (!found) throw new Error(`Unknown Memory-Control Package revision: ${revision}`)
    return immutableClone(found)
  }
}

export function baselineMemoryControlPackageReader(): MemoryControlPackageReader {
  return {
    admitActive: () => immutableClone(BASELINE_MEMORY_CONTROL_PACKAGE),
    read: (input) => {
      if (input.schemaVersion !== 1) throw new Error('Unsupported Memory-Control Package schema version')
      if (input.revision !== undefined && input.revision !== 1) throw new Error(`Unknown Memory-Control Package revision: ${input.revision}`)
      return immutableClone(BASELINE_MEMORY_CONTROL_PACKAGE)
    },
  }
}
