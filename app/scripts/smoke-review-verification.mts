import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { InMemoryReviewArtifactStore } from '../electron/reviewArtifactStore.ts'
import { SqliteReviewVerificationStore } from '../electron/reviewVerificationStore.ts'
import { createPiHostServer, type PiHostMessage, type PiHostResponse } from '../electron/piHostProtocol.ts'

const exec = promisify(execFile)
const git = (cwd: string, args: string[]) => exec('git', ['-C', cwd, ...args])

async function request(
  host: { handle(input: unknown): Promise<void> },
  messages: PiHostMessage[],
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<PiHostResponse> {
  await host.handle({ id, method, params })
  const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
  if (!response) throw new Error(`missing response ${id}`)
  return response
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-review-verification-'))
try {
  const repo = join(root, 'repo')
  const databasePath = join(root, 'verification.sqlite')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'fixture@example.com'])
  await git(repo, ['config', 'user.name', 'Fixture'])
  await writeFile(join(repo, 'package.json'), JSON.stringify({
    scripts: {
      build: 'node -e "console.log(\'build evidence\')"',
      smoke: 'node -e "console.error(\'smoke failure detail\'); process.exit(2)"',
    },
  }))
  await writeFile(join(repo, 'source.ts'), 'export const value = 1\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'baseline'])

  const artifactStore = new InMemoryReviewArtifactStore()
  const verificationStore = await SqliteReviewVerificationStore.open(databasePath)
  const messages: PiHostMessage[] = []
  const host = createPiHostServer(
    (message) => messages.push(message),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    artifactStore, undefined, verificationStore,
  )
  await request(host, messages, 1, 'initialize', { protocolVersion: 5, capabilities: ['review-v1'] })
  const admission = await request(host, messages, 2, 'review/v1/admit', {
    runId: 'run_verify', threadId: 'thread_verify', projectRoot: repo, runnerKind: 'builtin',
  })
  const snapshotId = admission.result?.reviewAdmission?.snapshotId
  assert.ok(snapshotId)
  await request(host, messages, 3, 'review/v1/finalize', { snapshotId, settlementKind: 'completed' })

  const build = await request(host, messages, 4, 'review/v1/verification/run', { snapshotId, kind: 'build' })
  assert.equal(build.result?.reviewVerification?.status, 'passed')
  assert.equal(build.result?.reviewVerification?.runner, 'host')
  assert.equal(build.result?.reviewVerification?.exitCode, 0)
  assert.equal(build.result?.reviewVerification?.outputAvailability, 'available')

  const smoke = await request(host, messages, 5, 'review/v1/verification/run', { snapshotId, kind: 'smoke' })
  assert.equal(smoke.result?.reviewVerification?.status, 'failed')
  assert.equal(smoke.result?.reviewVerification?.exitCode, 2)

  const notRun = await request(host, messages, 6, 'review/v1/verification/run', { snapshotId, kind: 'test' })
  assert.equal(notRun.result?.reviewVerification?.status, 'not-run')
  assert.match(notRun.result?.reviewVerification?.detail || '', /No test script/)

  const listed = await request(host, messages, 7, 'review/v1/verification/list', { snapshotId })
  assert.deepEqual(new Set(listed.result?.reviewVerifications?.map((record) => record.status)), new Set(['passed', 'failed', 'not-run']))
  const outputRef = smoke.result?.reviewVerification?.outputRef
  assert.ok(outputRef)
  const output = await request(host, messages, 8, 'review/v1/verification/output', { outputRef })
  assert.match(Buffer.from(output.result?.reviewVerificationOutput?.contentBase64 || '', 'base64').toString('utf8'), /smoke failure detail/)

  await writeFile(join(repo, 'source.ts'), 'export const value = 2\n')
  const stale = await request(host, messages, 9, 'review/v1/verification/list', { snapshotId })
  assert.equal(stale.result?.reviewVerifications?.find((record) => record.kind === 'build')?.status, 'stale')
  assert.equal(stale.result?.reviewVerifications?.find((record) => record.kind === 'smoke')?.status, 'stale')
  assert.equal(stale.result?.reviewVerifications?.find((record) => record.kind === 'test')?.status, 'not-run')

  await verificationStore.close()
  const reopened = await SqliteReviewVerificationStore.open(databasePath)
  const replay = await reopened.list(snapshotId!)
  assert.equal(replay.length, 3)
  assert.equal(replay.find((record) => record.kind === 'smoke')?.outputAvailability, 'available')
  assert.match(Buffer.from((await reopened.readOutput({ outputRef: outputRef! })).content).toString('utf8'), /smoke failure detail/)
  await reopened.close()
  const rawDb = new DatabaseSync(databasePath)
  rawDb.prepare('DELETE FROM review_verification_outputs WHERE output_ref = ?').run(outputRef!)
  rawDb.close()
  const missingOutput = await SqliteReviewVerificationStore.open(databasePath)
  assert.equal((await missingOutput.list(snapshotId!)).find((record) => record.kind === 'smoke')?.outputAvailability, 'missing')
  const retainedOutputs = (await missingOutput.list(snapshotId!)).map((record) => record.outputRef).filter((value): value is string => Boolean(value))
  await missingOutput.hardDeleteSnapshot(snapshotId!)
  assert.equal((await missingOutput.list(snapshotId!)).length, 0, 'hard delete removes canonical verification records')
  for (const retainedOutput of retainedOutputs) {
    await assert.rejects(() => missingOutput.readOutput({ outputRef: retainedOutput }), /missing/, 'unreferenced verification payloads are collected')
  }
  await missingOutput.close()

  const panel = await readFile(new URL('../src/components/ReviewVerificationPanel.tsx', import.meta.url), 'utf8')
  const summary = await readFile(new URL('../src/components/InlineRunPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /listVerifications\(snapshotId\)/, 'verification tab resolves snapshot-owned records')
  assert.match(summary, /listVerifications/, 'summary resolves the same Host-owned verification records')
  assert.match(panel, /readVerificationOutput/, 'failure output is expanded from the Host-owned bounded reference')
  assert.doesNotMatch(panel, /tests? passed.*status|status.*tests? passed/i, 'renderer does not infer verification from model narration')
  console.log('smoke-review-verification passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
