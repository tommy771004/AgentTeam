import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { canonicalProjectId } from '../electron/durableMemoryStore.ts'

const database = process.argv[2]
if (!database) process.exit(2)
const store = await SqliteDurableMemoryStore.open(database)
const project = canonicalProjectId('/workspace/wal-crash')
await store.upsert({
  access: {
    origin: 'runtime', canonicalProject: project,
    memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false,
    runId: 'wal-run', sessionId: 'wal-session', callId: 'wal-call',
  },
  scope: { kind: 'project', project },
  logicalKey: 'committed-before-kill',
  kind: 'memory',
  text: 'committed WAL survives immediate kill',
  tags: ['wal'],
  createdAt: '2026-08-27T00:00:00.000Z',
})
process.exit(73)
