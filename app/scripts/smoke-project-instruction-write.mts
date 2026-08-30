import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProjectInstructionWriteError,
  recoverProjectInstruction,
  writeProjectInstruction,
} from '../electron/projectInstructionWriter.ts'
import { InMemoryInstructionRepository } from '../electron/instructionRepository.ts'
import { createPiHostServer, type PiHostMessage, type PiHostResponse } from '../electron/piHostProtocol.ts'
import { openInstructionSource } from '../electron/instructionSourceOpen.ts'

const root = await mkdtemp(join(tmpdir(), 'agentstudio-project-instruction-write-'))
try {
  const created = await writeProjectInstruction({
    projectRoot: root,
    target: 'AGENTS.md',
    expectedHash: '',
    content: 'first committed rule',
  })
  assert.equal(created.created, true)
  assert.equal(created.bytes, Buffer.byteLength('first committed rule'))
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'first committed rule')
  assert.equal((await stat(join(root, 'AGENTS.md'))).mode & 0o777, 0o600)

  await writeFile(join(root, 'AGENTS.md'), 'external editor wins')
  await assert.rejects(
    writeProjectInstruction({
      projectRoot: root,
      target: 'AGENTS.md',
      expectedHash: created.hash,
      content: 'stale renderer draft',
    }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'conflict',
  )
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'external editor wins')

  let externalHash = (await import('node:crypto')).createHash('sha256').update('external editor wins').digest('hex')
  // Two renderer windows can submit the same observed hash concurrently. The
  // shared production writer lock serializes the CAS window, so exactly one
  // public write wins and the other receives a typed conflict.
  const concurrentWrites = await Promise.allSettled([
    writeProjectInstruction({ projectRoot: root, target: 'AGENTS.md', expectedHash: externalHash, content: 'WINDOW_A_WINS_OR_LOSES' }),
    writeProjectInstruction({ projectRoot: root, target: 'AGENTS.md', expectedHash: externalHash, content: 'WINDOW_B_WINS_OR_LOSES' }),
  ])
  assert.equal(concurrentWrites.filter((result) => result.status === 'fulfilled').length, 1, 'concurrent project CAS has one winner')
  assert.equal(concurrentWrites.filter((result) => result.status === 'rejected' && result.reason instanceof ProjectInstructionWriteError && result.reason.code === 'conflict').length, 1, 'concurrent project CAS has one typed conflict')
  const concurrentWinner = await readFile(join(root, 'AGENTS.md'), 'utf8')
  assert.ok(['WINDOW_A_WINS_OR_LOSES', 'WINDOW_B_WINS_OR_LOSES'].includes(concurrentWinner))
  externalHash = (await import('node:crypto')).createHash('sha256').update(concurrentWinner).digest('hex')
  await assert.rejects(
    writeProjectInstruction({
      projectRoot: root,
      target: 'AGENTS.md',
      expectedHash: externalHash,
      content: 'must not commit',
    }, {
      beforeCommit: async () => { throw Object.assign(new Error('synthetic atomic rename failure'), { code: 'EIO' }) },
    }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'io_error',
  )
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), concurrentWinner)
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])

  for (const mode of ['sync', 'close'] as const) {
    let calls = 0
    await assert.rejects(
      writeProjectInstruction({
        projectRoot: root,
        target: 'AGENTS.md',
        expectedHash: externalHash,
        content: `must rollback ${mode}`,
      }, {
        openDirectory: async () => ({
          sync: async () => {
            calls += 1
            if (mode === 'sync' && calls === 1) throw Object.assign(new Error('synthetic directory sync failure'), { code: 'EIO' })
          },
          close: async () => {
            if (mode === 'close' && calls === 1) throw Object.assign(new Error('synthetic directory close failure'), { code: 'EIO' })
          },
        }),
      }),
      (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'io_error',
    )
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), concurrentWinner)
    assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
  }

  for (const [failureCode, expectedCode] of [
    ['ENOSPC', 'disk_full'],
    ['EILSEQ', 'encoding_failure'],
  ] as const) {
    await assert.rejects(
      writeProjectInstruction({
        projectRoot: root,
        target: 'AGENTS.md',
        expectedHash: externalHash,
        content: `must not commit ${failureCode}`,
      }, {
        beforeCommit: async () => { throw Object.assign(new Error(`synthetic ${failureCode}`), { code: failureCode }) },
      }),
      (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === expectedCode,
    )
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), concurrentWinner)
  }
  await assert.rejects(
    writeProjectInstruction({
      projectRoot: root,
      target: 'AGENTS.md',
      expectedHash: externalHash,
      content: 'must not rename',
    }, {
      renameFile: async () => { throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' }) },
    }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'rename_failure',
  )
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), concurrentWinner)
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])

  await assert.rejects(
    writeProjectInstruction({ projectRoot: root, target: '../AGENTS.md', expectedHash: '', content: 'escape' }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'invalid_target',
  )
  await assert.rejects(
    writeProjectInstruction({ projectRoot: root, target: 'AGENTS.md', expectedHash: externalHash, content: 'x'.repeat(128 * 1024 + 1) }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'invalid_content',
  )

  const updated = await writeProjectInstruction({
    projectRoot: root,
    target: 'AGENTS.md',
    expectedHash: externalHash,
    content: 'second committed rule',
  })
  assert.equal(updated.created, false)
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'second committed rule')

  // A live resolver may request recovery while the writer has durably staged
  // its journal but has not renamed the target yet. Recovery must serialize
  // behind that in-process write; otherwise it mistakes the live transaction
  // for a crash and removes the writer's backup/temp artifacts.
  const concurrentRecoveryTarget = join(root, 'CLAUDE.md')
  const concurrentRecoveryOriginal = 'concurrent recovery original'
  await writeFile(concurrentRecoveryTarget, concurrentRecoveryOriginal)
  await chmod(concurrentRecoveryTarget, 0o600)
  const concurrentRecoveryHash = (await import('node:crypto')).createHash('sha256').update(concurrentRecoveryOriginal).digest('hex')
  let releaseConcurrentCommit!: () => void
  let signalConcurrentCommit!: () => void
  const concurrentCommitReached = new Promise<void>((resolve) => { signalConcurrentCommit = resolve })
  const concurrentCommitRelease = new Promise<void>((resolve) => { releaseConcurrentCommit = resolve })
  const concurrentWrite = writeProjectInstruction({
    projectRoot: root,
    target: 'CLAUDE.md',
    expectedHash: concurrentRecoveryHash,
    content: 'concurrent recovery committed',
  }, {
    beforeCommit: async () => {
      signalConcurrentCommit()
      await concurrentCommitRelease
    },
  })
  await concurrentCommitReached
  const concurrentRecovery = recoverProjectInstruction(root, 'CLAUDE.md')
  await new Promise<void>((resolve) => setImmediate(resolve))
  releaseConcurrentCommit()
  await Promise.all([concurrentWrite, concurrentRecovery])
  assert.equal(await readFile(concurrentRecoveryTarget, 'utf8'), 'concurrent recovery committed')
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('.CLAUDE.md.') || name === '.CLAUDE.md.recovery.json'), [])
  await rm(concurrentRecoveryTarget)

  let tamperedBackup = false
  await assert.rejects(
    writeProjectInstruction({ projectRoot: root, target: 'AGENTS.md', expectedHash: updated.hash, content: 'backup mode must reject' }, {
      beforeCommit: async () => {
        if (tamperedBackup) return
        const backup = (await readdir(root)).find((name) => name.endsWith('.backup.tmp'))
        if (backup) { await chmod(join(root, backup), 0o777); tamperedBackup = true }
      },
    }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'integrity_failure',
  )
  assert.equal((await stat(join(root, 'AGENTS.md'))).mode & 0o777, 0o600)

  // If rollback itself cannot restore the backup, report integrity_failure and
  // retain the backup for operator recovery instead of claiming success or
  // pretending the original target is still durable.
  await assert.rejects(
    writeProjectInstruction({
      projectRoot: root,
      target: 'AGENTS.md',
      expectedHash: updated.hash,
      content: 'must surface integrity failure',
    }, {
      openDirectory: async () => ({
        sync: async () => { throw Object.assign(new Error('synthetic post-rename fsync failure'), { code: 'EIO' }) },
        close: async () => {},
      }),
      renameFile: async (from, to) => {
        if (from.endsWith('.backup.tmp')) throw Object.assign(new Error('synthetic rollback rename failure'), { code: 'EIO' })
        await rename(from, to)
      },
    }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'integrity_failure',
  )
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'second committed rule')
  assert.equal((await readdir(root)).some((name) => name.includes('.backup.tmp')), true, 'integrity failure retains recoverable backup')
  assert.equal((await readdir(root)).some((name) => name.endsWith('.recovery.json')), true, 'integrity failure persists recovery journal')
  await recoverProjectInstruction(root, 'AGENTS.md')
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'second committed rule')
  assert.deepEqual((await readdir(root)).filter((name) => name.includes('.backup.tmp') || name.includes('.recovery.json')), [])

  // A beforeCommit editor race is a typed CAS conflict and cannot overwrite
  // the external body. The hook models the last-moment mutation immediately
  // before the production final read/rename boundary.
  const latestHash = (await import('node:crypto')).createHash('sha256').update('second committed rule').digest('hex')
  await assert.rejects(
    writeProjectInstruction({ projectRoot: root, target: 'AGENTS.md', expectedHash: latestHash, content: 'stale after hook' }, {
      beforeCommit: async ({ targetPath }) => { await writeFile(targetPath, 'beforeCommit external wins') },
    }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'conflict',
  )
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'beforeCommit external wins')

  // Journal fields are untrusted data. Invalid path-shaped legacy fields must
  // fence recovery without touching a canary outside the project root.
  const canary = join(root, '..', `agentstudio-recovery-canary-${process.pid}`)
  await writeFile(canary, 'must survive malicious journal')
  await writeFile(join(root, '.AGENTS.md.recovery.json'), JSON.stringify({
    version: 1,
    phase: 'replace-pending',
    targetPath: canary,
    temporaryPath: canary,
    expectedHash: '',
    originalHash: '',
    originalExists: true,
  }))
  await assert.rejects(
    recoverProjectInstruction(root, 'AGENTS.md'),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'integrity_failure',
  )
  assert.equal(await readFile(canary, 'utf8'), 'must survive malicious journal')
  await rm(canary, { force: true })
  await rm(join(root, '.AGENTS.md.recovery.json'), { force: true })

  // A valid committed-crash journal must verify new and old metadata against
  // their own bodies; different lengths are expected and safe to finalize.
  const oldBody = 'old'
  const newBody = 'new body with a different length'
  const tx = randomUUID()
  const oldHash = createHash('sha256').update(oldBody).digest('hex')
  const newHash = createHash('sha256').update(newBody).digest('hex')
  await writeFile(join(root, 'AGENTS.md'), newBody)
  await writeFile(join(root, `.AGENTS.md.${tx}.backup.tmp`), oldBody)
  await chmod(join(root, `.AGENTS.md.${tx}.backup.tmp`), 0o600)
  await writeFile(join(root, `.AGENTS.md.${tx}.tmp`), newBody)
  await writeFile(join(root, '.AGENTS.md.recovery.json'), JSON.stringify({ version: 1, phase: 'replace-pending', target: 'AGENTS.md', transactionId: tx, hasBackup: true, expectedHash: newHash, expectedBytes: Buffer.byteLength(newBody), expectedMode: 0o600, originalMode: 0o600, originalHash: oldHash, originalBytes: Buffer.byteLength(oldBody), originalExists: true }))
  await recoverProjectInstruction(root, 'AGENTS.md')
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), newBody)
  assert.deepEqual((await readdir(root)).filter((name) => name.includes(tx) || name.endsWith('.recovery.json')), [])

  // A valid UUID does not make traversal/path-shaped journal fields trusted.
  const traversalTx = randomUUID()
  await writeFile(join(root, '.AGENTS.md.recovery.json'), JSON.stringify({ version: 1, phase: 'replace-pending', target: '../AGENTS.md', transactionId: traversalTx, hasBackup: true, expectedHash: newHash, expectedBytes: Buffer.byteLength(newBody), expectedMode: 0o600, originalMode: 0o600, originalHash: oldHash, originalBytes: Buffer.byteLength(oldBody), originalExists: true }))
  await assert.rejects(recoverProjectInstruction(root, 'AGENTS.md'), (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'integrity_failure')
  await rm(join(root, '.AGENTS.md.recovery.json'), { force: true })

  // Derived artifact symlink/non-regular files are rejected before any
  // unlink/rename, preserving the outside canary.
  const artifactTx = randomUUID()
  const artifactCanary = join(root, '..', `agentstudio-artifact-canary-${process.pid}`)
  await writeFile(artifactCanary, 'must survive artifact attack')
  await writeFile(join(root, `.AGENTS.md.${artifactTx}.tmp`), 'staged')
  await symlink(artifactCanary, join(root, `.AGENTS.md.${artifactTx}.backup.tmp`))
  await writeFile(join(root, '.AGENTS.md.recovery.json'), JSON.stringify({ version: 1, phase: 'replace-pending', target: 'AGENTS.md', transactionId: artifactTx, hasBackup: true, expectedHash: newHash, expectedBytes: Buffer.byteLength(newBody), expectedMode: 0o600, originalMode: 0o600, originalHash: oldHash, originalBytes: Buffer.byteLength(oldBody), originalExists: true }))
  await assert.rejects(recoverProjectInstruction(root, 'AGENTS.md'), (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'integrity_failure')
  assert.equal(await readFile(artifactCanary, 'utf8'), 'must survive artifact attack')
  await rm(artifactCanary, { force: true })
  await rm(join(root, `.AGENTS.md.${artifactTx}.tmp`), { force: true })
  await rm(join(root, `.AGENTS.md.${artifactTx}.backup.tmp`), { force: true })
  await rm(join(root, '.AGENTS.md.recovery.json'), { force: true })

  const messages: PiHostMessage[] = []
  const host = createPiHostServer(
    (message) => messages.push(message),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new InMemoryInstructionRepository(),
  )
  const request = async (id: number, method: string, params: Record<string, unknown> = {}) => {
    await host.handle({ id, method, params })
    const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
    assert.ok(response, `missing Host response for ${method}`)
    return response
  }
  await request(1, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })
  const eventCount = () => messages.filter((message) => 'event' in message && message.event === 'instruction/changed').length
  const beforeInvalid = eventCount()
  const invalid = await request(2, 'instructions/v1/project-write', {
    projectRoot: root,
    target: '../CLAUDE.md',
    expectedHash: '',
    content: 'escape',
  })
  assert.equal(invalid.error?.code, 'invalid_target')
  assert.equal(eventCount(), beforeInvalid, 'failed public write must not publish a success revision')
  const committed = await request(3, 'instructions/v1/project-write', {
    projectRoot: root,
    target: 'CLAUDE.md',
    expectedHash: '',
    content: 'public Host commit',
  })
  assert.equal(committed.error, undefined)
  assert.equal(committed.result?.projectInstructionWrite?.path, join(await realpath(root), 'CLAUDE.md'))
  assert.equal(await readFile(join(root, 'CLAUDE.md'), 'utf8'), 'public Host commit')
  assert.equal(eventCount(), beforeInvalid + 1, 'success event is published only after atomic commit')
  const hostRead = await request(4, 'instructions/v1/project-read', { projectRoot: root, workPath: root, target: 'AGENTS.md' })
  assert.equal(hostRead.error, undefined)
  assert.equal(hostRead.result?.projectInstructionRead?.path, join(await realpath(root), 'AGENTS.md'))
  assert.equal(hostRead.result?.projectInstructionRead?.content, newBody)
  const degradedTx = randomUUID()
  await writeFile(join(root, '.AGENTS.md.recovery.json'), JSON.stringify({ version: 1, phase: 'degraded', target: 'AGENTS.md', transactionId: degradedTx, hasBackup: false, expectedHash: newHash, expectedBytes: Buffer.byteLength(newBody), expectedMode: 0o600, originalMode: 0o600, originalHash: oldHash, originalBytes: Buffer.byteLength(oldBody), originalExists: true }))
  const fenced = await request(5, 'instructions/v1/resolve', { projectRoot: root, workPath: root })
  assert.equal(fenced.error?.code, 'integrity_failure', 'degraded journal fences public Host resolve')
  const fencedRead = await request(6, 'instructions/v1/project-read', { projectRoot: root, workPath: root, target: 'AGENTS.md' })
  assert.equal(fencedRead.error?.code, 'integrity_failure', 'degraded journal fences public Host read')
  const fencedWrite = await request(7, 'instructions/v1/project-write', { projectRoot: root, target: 'AGENTS.md', expectedHash: newHash, content: 'must not write while degraded' })
  assert.equal(fencedWrite.error?.code, 'integrity_failure', 'degraded journal fences public Host write')
  let shellCalled = false
  await assert.rejects(
    openInstructionSource({
      projectRoot: root,
      workPath: root,
      path: join(root, 'AGENTS.md'),
      resolveCurrent: async () => {
        const response = await request(8, 'instructions/v1/resolve', { projectRoot: root, workPath: root })
        if (response.error) throw new Error(response.error.message)
        return response.result!.instructionSnapshot!
      },
      shellOpen: async () => { shellCalled = true; return '' },
    }),
    (error: unknown) => error instanceof Error && error.name === 'InstructionSourceOpenError',
  )
  assert.equal(shellCalled, false, 'degraded Host resolve prevents shell opener invocation')
  await rm(join(root, '.AGENTS.md.recovery.json'), { force: true })
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('project instruction write smoke: explicit create, CAS conflict, atomic failure preservation, target bounds passed')
