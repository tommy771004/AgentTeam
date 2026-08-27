import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { canonicalProjectId, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { runDurableMemoryContract } from './smoke-durable-memory-store.mts'

const stateDir = await mkdtemp(join(tmpdir(), 'subagents-memory-sqlite-contract-'))
let index = 0
try {
  await runDurableMemoryContract(() => SqliteDurableMemoryStore.open(join(stateDir, `contract-${index++}.sqlite`)))
  const restartPath = join(stateDir, 'restart.sqlite')
  const project = canonicalProjectId('/workspace/restart')
  const access: MemoryAccessContext = {
    origin: 'runtime',
    canonicalProject: project,
    memoryReadEnabled: true,
    memoryWriteEnabled: true,
    temporary: false,
    runId: 'run-sqlite-contract',
    sessionId: 'session-sqlite-contract',
    callId: 'call-sqlite-contract',
  }
  const beforeRestart = await SqliteDurableMemoryStore.open(restartPath)
  const acknowledged = await beforeRestart.upsert({
    access,
    scope: { kind: 'project', project },
    logicalKey: 'restart-proof',
    kind: 'memory',
    text: 'acknowledged rows survive process restart',
    tags: ['durability'],
    createdAt: '2026-08-27T00:00:00.000Z',
  })
  await beforeRestart.close()
  const afterRestart = await SqliteDurableMemoryStore.open(restartPath)
  assert.equal((await afterRestart.get({ access, scope: { kind: 'project', project }, logicalKey: 'restart-proof' }))?.id, acknowledged.id)
  assert.equal(await afterRestart.revision(), acknowledged.revision)
  await afterRestart.close()
  const concurrent = await SqliteDurableMemoryStore.open(join(stateDir, 'concurrent.sqlite'))
  await Promise.all(Array.from({ length: 20 }, (_, item) => concurrent.upsert({
    access,
    scope: { kind: 'project', project },
    logicalKey: `concurrent-${item}`,
    kind: 'memory',
    text: `serialized write ${item}`,
    tags: ['concurrency'],
    createdAt: `2026-08-27T00:00:${String(item).padStart(2, '0')}.000Z`,
  })))
  assert.equal(await concurrent.revision(), 20)
  assert.equal((await concurrent.list({ access })).total, 20)
  await concurrent.close()
  console.log('sqlite durable memory contract: shared fixtures passed')
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
