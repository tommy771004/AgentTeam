import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonMemoryControlPackageRepository, MAX_MEMORY_CONTROL_REASON_BYTES } from '../electron/memoryControlPackageRepository.ts'

const directory = await mkdtemp(join(tmpdir(), 'memory-control-candidates-'))
const repositoryPath = join(directory, 'packages.json')

try {
  const repository = await JsonMemoryControlPackageRepository.open(repositoryPath)
  const baseline = repository.admitActive()
  const policyCandidate = await repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'invocationPolicy',
    patch: [{ op: 'replace', path: '/maxSkills', value: 1 }],
    reason: 'source trace missed a required exact-tool skill',
  })
  assert.equal(policyCandidate.status, 'candidate')
  assert.equal(policyCandidate.parentRevision, 1)
  assert.equal(policyCandidate.diagnosisComponent, 'invocationPolicy')
  assert.equal(repository.admitActive().revision, 1, 'candidate creation cannot switch active')
  for (const key of ['experientialSkills', 'workingMemorySpec', 'checkers'] as const) {
    assert.equal(policyCandidate.components[key].digest, baseline.components[key].digest,
      `${key} must retain the exact parent digest`)
  }
  assert.notEqual(policyCandidate.components.invocationPolicy.digest, baseline.components.invocationPolicy.digest)

  const checkerCandidate = await repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'checkers',
    patch: [{ op: 'replace', path: '/fileContent', value: 0 }],
    reason: 'checker accepted an unsupported completion claim',
  })
  const competingRepository = await JsonMemoryControlPackageRepository.open(repositoryPath)
  const race = await Promise.allSettled([
    repository.activateCandidate({ revision: policyCandidate.revision, expectedActiveRevision: 1, reason: 'evaluation gate passed' }),
    competingRepository.activateCandidate({ revision: checkerCandidate.revision, expectedActiveRevision: 1, reason: 'competing evaluation gate passed' }),
  ])
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1, 'activation CAS admits exactly one winner')
  assert.equal(race.filter((result) => result.status === 'rejected').length, 1, 'activation CAS rejects the stale contender')
  const winner = repository.admitActive()
  assert.ok([policyCandidate.revision, checkerCandidate.revision].includes(winner.revision))
  assert.equal(Object.isFrozen(winner.components), true)

  const loser = winner.revision === policyCandidate.revision ? checkerCandidate : policyCandidate
  await repository.rejectCandidate({ revision: loser.revision, reason: 'lost promotion race; evaluation must be repeated' })
  assert.equal(repository.read({ schemaVersion: 1, revision: loser.revision }).status, 'rejected')
  assert.equal(repository.admitActive().revision, winner.revision)
  await assert.rejects(() => repository.rollback({
    revision: loser.revision,
    expectedActiveRevision: winner.revision,
    reason: 'must not reactivate a failed candidate',
  }), /never validated and active/i)

  const rolledBack = await repository.rollback({
    revision: 1,
    expectedActiveRevision: winner.revision,
    reason: 'post-promotion production invariant regressed',
  })
  assert.equal(rolledBack.revision, 1)
  assert.equal(rolledBack.digest, baseline.digest, 'rollback selects immutable history instead of rewriting it')

  const lineage = repository.lineage()
  assert.equal(lineage.activeRevision, 1)
  assert.deepEqual(lineage.events.map((event) => event.kind), [
    'candidate-created', 'candidate-created', 'candidate-activated', 'candidate-rejected', 'rollback',
  ])
  assert.equal(Object.isFrozen(lineage.events), true)
  assert.match(lineage.events.at(-1)?.reason || '', /production invariant/)

  await assert.rejects(() => repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'not-a-component' as any,
    patch: [{ op: 'replace', path: '/maxSkills', value: 2 }],
    reason: 'invalid diagnosis',
  }), /diagnosis component/i)
  await assert.rejects(() => repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'invocationPolicy',
    patch: [{ op: 'copy' as any, path: '/maxSkills', value: 2 }],
    reason: 'unsupported operation',
  }), /patch operation/i)
  await assert.rejects(() => repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'invocationPolicy',
    patch: [{ op: 'replace', path: '/maxSkills', value: 2 }],
    reason: 'x'.repeat(MAX_MEMORY_CONTROL_REASON_BYTES + 1),
  }), /reason.*bounds/i)
  const cyclic: any = {}
  cyclic.self = cyclic
  await assert.rejects(() => repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'invocationPolicy',
    patch: [{ op: 'add', path: '/cyclic', value: cyclic }],
    reason: 'cyclic input must fail before canonicalization',
  }), /exceeds bounds/i)

  await writeFile(`${repositoryPath}.lock`, JSON.stringify({ pid: 2_147_483_647 }), { mode: 0o600 })
  const recoveryCandidate = await repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'workingMemorySpec',
    patch: [{ op: 'add', path: '/lockRecovery', value: true }],
    reason: 'recover a lock whose owner process no longer exists',
  })
  await repository.rejectCandidate({ revision: recoveryCandidate.revision, reason: 'lock recovery qualification complete' })
  await writeFile(`${repositoryPath}.lock`, '{partial', { mode: 0o600 })
  const staleAt = new Date(Date.now() - 31_000)
  await utimes(`${repositoryPath}.lock`, staleAt, staleAt)
  const partialLockCandidate = await repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'experientialSkills',
    patch: [{ op: 'add', path: '/partialLockRecovery', value: true }],
    reason: 'recover stale lock left before owner metadata completed',
  })
  await repository.rejectCandidate({ revision: partialLockCandidate.revision, reason: 'partial lock recovery qualification complete' })
  await writeFile(`${repositoryPath}.lock`, JSON.stringify({ pid: 0 }), { mode: 0o600 })
  await utimes(`${repositoryPath}.lock`, staleAt, staleAt)
  const invalidOwnerCandidate = await repository.createCandidate({
    expectedActiveRevision: 1,
    diagnosisComponent: 'checkers',
    patch: [{ op: 'add', path: '/invalidOwnerLockRecovery', value: true }],
    reason: 'recover stale lock containing parseable but invalid owner metadata',
  })
  await repository.rejectCandidate({ revision: invalidOwnerCandidate.revision, reason: 'invalid owner lock recovery qualification complete' })
  const finalLineage = repository.lineage()

  const persisted = await readFile(repositoryPath, 'utf8')
  const forgedHistory = JSON.parse(persisted)
  forgedHistory.events.push({
    sequence: forgedHistory.events.length + 1,
    kind: 'candidate-activated',
    revision: loser.revision,
    fromRevision: 1,
    diagnosisComponent: loser.diagnosisComponent,
    reason: 'forged activation must not establish rollback provenance',
  })
  await writeFile(repositoryPath, JSON.stringify(forgedHistory), { mode: 0o600 })
  await assert.rejects(() => JsonMemoryControlPackageRepository.open(repositoryPath), /activation history|status projection/i)
  await writeFile(repositoryPath, persisted, { mode: 0o600 })
  const corrupt = JSON.parse(persisted)
  corrupt.packages[1].components.experientialSkills.body.selection = 'tampered-undetected-change'
  await writeFile(repositoryPath, JSON.stringify(corrupt), { mode: 0o600 })
  await assert.rejects(() => JsonMemoryControlPackageRepository.open(repositoryPath), /digest mismatch/i)
  await writeFile(repositoryPath, persisted, { mode: 0o600 })
  const restarted = await JsonMemoryControlPackageRepository.open(repositoryPath)
  assert.equal(restarted.admitActive().revision, 1)
  assert.equal(restarted.lineage().events.length, finalLineage.events.length)

  console.log('Memory-Control candidates are component-local, CAS-activated, auditable, and rollback selects immutable history')
} finally {
  await rm(directory, { recursive: true, force: true })
}
