import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createMemoryControlPackage,
  JsonMemoryControlPackageRepository,
  MAX_MEMORY_CONTROL_COMPONENT_BYTES,
  MAX_MEMORY_CONTROL_PACKAGES,
  memoryControlPackageDocument,
} from '../electron/memoryControlPackageRepository.ts'
import { compileMemoryControlRuntime } from '../electron/memoryControlRuntime.ts'

const directory = await mkdtemp(join(tmpdir(), 'memory-control-package-'))
const repositoryPath = join(directory, 'packages.json')

try {
  const repository = await JsonMemoryControlPackageRepository.open(repositoryPath)
  const first = repository.admitActive()
  assert.equal(first.status, 'active')
  assert.equal(first.revision, 1)
  assert.match(first.digest, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(first.components).sort(), [
    'checkers', 'experientialSkills', 'invocationPolicy', 'workingMemorySpec',
  ])
  for (const component of Object.values(first.components)) {
    assert.equal(component.revision, 1)
    assert.match(component.digest, /^[a-f0-9]{64}$/)
    assert.equal(Object.isFrozen(component.body), true)
  }
  assert.deepEqual(repository.read({ schemaVersion: 1, revision: 1 }), first)
  assert.throws(() => repository.read({ schemaVersion: 2 as 1 }), /schema version/i)
  assert.equal(compileMemoryControlRuntime(first).fileContentChecker, true)
  assert.throws(() => compileMemoryControlRuntime(first, 101), /goals exceed/i)
  for (const [component, field, value] of [
    ['checkers', 'fileContent', 2],
    ['checkers', 'modelClaimsAreEvidence', true],
    ['invocationPolicy', 'batchBarrier', false],
    ['workingMemorySpec', 'optimisticConcurrency', false],
    ['experientialSkills', 'source', 'curated-skill-resource-view'],
    ['experientialSkills', 'unknownField', true],
  ] as const) {
    const candidate = await repository.createCandidate({
      expectedActiveRevision: 1, diagnosisComponent: component,
      patch: [{ op: field === 'unknownField' ? 'add' : 'replace', path: `/${field}`, value }], reason: 'unsupported runtime policy',
    })
    assert.throws(() => compileMemoryControlRuntime(candidate), /unsupported|mandatory Host invariant/i)
    await repository.rejectCandidate({ revision: candidate.revision, reason: 'unsupported runtime policy' })
    assert.equal(repository.admitActive().revision, 1)
  }

  const second = createMemoryControlPackage({
    id: first.id,
    revision: 2,
    parentRevision: 1,
    diagnosisComponent: 'invocationPolicy',
    status: 'active',
    components: {
      ...first.components,
      invocationPolicy: {
        id: first.components.invocationPolicy.id,
        revision: 2,
        body: { ...first.components.invocationPolicy.body, maxSkills: 1 },
      },
    },
  })
  await writeFile(repositoryPath, `${JSON.stringify(memoryControlPackageDocument([first, second], 2))}\n`, { mode: 0o600 })
  const restarted = await JsonMemoryControlPackageRepository.open(repositoryPath)
  assert.equal(restarted.admitActive().revision, 1, 'an active revision without a promoted evaluation fails closed')
  assert.equal(restarted.lineage().packages.find((entry) => entry.revision === 2)?.qualification, 'legacy-unqualified')
  assert.equal(restarted.read({ schemaVersion: 1, revision: 1 }).digest, first.digest)
  assert.equal(restarted.read({ schemaVersion: 1, revision: 2 }).components.experientialSkills.digest,
    first.components.experientialSkills.digest, 'unchanged component identity survives lineage')

  const legacySecond = createMemoryControlPackage({
    id: first.id,
    revision: 2,
    parentRevision: 1,
    status: 'active',
    components: second.components,
  })
  await writeFile(repositoryPath, JSON.stringify(memoryControlPackageDocument([first, legacySecond], 2)), { mode: 0o600 })
  const migratedLegacy = await JsonMemoryControlPackageRepository.open(repositoryPath)
  assert.equal(migratedLegacy.admitActive().digest, first.digest,
    'legacy schema-v1 active packages are preserved for audit but cannot bypass qualification')
  const legacyChild = await migratedLegacy.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'workingMemorySpec',
    patch: [{ op: 'add', path: '/maxGoals', value: 50 }],
    reason: 'candidate remains inactive before canonical evaluation',
  })
  assert.equal(compileMemoryControlRuntime(legacyChild).maxGoals, 50)
  assert.equal(migratedLegacy.admitActive().revision, 1)
  await migratedLegacy.rejectCandidate({ revision: legacyChild.revision, reason: 'evaluation not supplied' })
  await assert.rejects(
    migratedLegacy.rollback({ revision: 2, expectedActiveRevision: 1, reason: 'legacy active revision must be requalified' }),
    /never validated/i,
  )

  for (const invalid of [
    createMemoryControlPackage({ ...second, parentRevision: 2, components: second.components }),
    createMemoryControlPackage({ ...second, parentRevision: 3, components: second.components }),
    createMemoryControlPackage({ ...second, id: 'foreign-lineage', components: second.components }),
  ]) {
    const roots = invalid.id === first.id ? [first] : [createMemoryControlPackage({
      ...first, id: 'different-root', components: first.components,
    })]
    await writeFile(repositoryPath, JSON.stringify(memoryControlPackageDocument([...roots, invalid], invalid.revision)), { mode: 0o600 })
    await assert.rejects(() => JsonMemoryControlPackageRepository.open(repositoryPath), /lineage|parent/i)
  }

  assert.throws(() => createMemoryControlPackage({
    ...second,
    components: {
      ...second.components,
      invocationPolicy: {
        id: 'oversized-policy', revision: 3,
        body: { content: 'x'.repeat(MAX_MEMORY_CONTROL_COMPONENT_BYTES + 1) },
      },
    },
  }), /exceeds bounds/)
  const tooMany = memoryControlPackageDocument([first], 1) as any
  tooMany.packages = Array.from({ length: MAX_MEMORY_CONTROL_PACKAGES + 1 }, () => first)
  await writeFile(repositoryPath, JSON.stringify(tooMany), { mode: 0o600 })
  await assert.rejects(() => JsonMemoryControlPackageRepository.open(repositoryPath), /schema version or shape|bounds/i)

  let nested: Record<string, unknown> = { value: true }
  for (let depth = 0; depth < 40; depth += 1) nested = { nested }
  const tooDeep = JSON.parse(JSON.stringify(memoryControlPackageDocument([first], 1))) as any
  tooDeep.packages[0].components.checkers.body = nested
  await writeFile(repositoryPath, JSON.stringify(tooDeep), { mode: 0o600 })
  await assert.rejects(() => JsonMemoryControlPackageRepository.open(repositoryPath), /exceeds bounds/)

  await writeFile(repositoryPath, `${JSON.stringify(memoryControlPackageDocument([first, second], 2))}\n`, { mode: 0o600 })
  const corrupt = JSON.parse(await readFile(repositoryPath, 'utf8'))
  corrupt.packages[1].components.invocationPolicy.body.maxSkills = 99
  await writeFile(repositoryPath, JSON.stringify(corrupt), { mode: 0o600 })
  await assert.rejects(() => JsonMemoryControlPackageRepository.open(repositoryPath), /digest mismatch/i)

  console.log('Memory-Control Package repository preserves immutable four-component lineage and fails closed')
} finally {
  await rm(directory, { recursive: true, force: true })
}

await import('./memory-control-package-candidates.mts')
