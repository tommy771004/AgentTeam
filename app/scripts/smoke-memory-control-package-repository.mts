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

  const second = createMemoryControlPackage({
    id: first.id,
    revision: 2,
    parentRevision: 1,
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
  assert.equal(restarted.admitActive().revision, 2)
  assert.equal(restarted.read({ schemaVersion: 1, revision: 1 }).digest, first.digest)
  assert.equal(restarted.read({ schemaVersion: 1, revision: 2 }).components.experientialSkills.digest,
    first.components.experientialSkills.digest, 'unchanged component identity survives lineage')

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
