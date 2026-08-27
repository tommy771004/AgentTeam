import { createInterface } from 'node:readline'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { createPiHostServer } from '../electron/piHostProtocol.ts'

const databasePath = process.argv[2]
const holdFirstCommit = process.argv[3] === 'hold'
const busyTimeoutMs = Number(process.argv[4] || 50)
if (!databasePath) throw new Error('database path is required')

let releaseCommit: (() => void) | undefined
let shouldHold = holdFirstCommit
const store = await SqliteDurableMemoryStore.open(databasePath, undefined, {
  busyTimeoutMs,
  beforeCommitWrite: async () => {
    if (!shouldHold) return
    shouldHold = false
    process.stdout.write(`${JSON.stringify({ fixture: 'transaction-held' })}\n`)
    await new Promise<void>((resolve) => { releaseCommit = resolve })
  },
})
const server = createPiHostServer((message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}, undefined, undefined, undefined, undefined, store)
const lines = createInterface({ input: process.stdin })

process.stdout.write(`${JSON.stringify({ fixture: 'ready' })}\n`)
lines.on('line', (line) => {
  let input: unknown
  try { input = JSON.parse(line) } catch { return }
  if (input && typeof input === 'object' && (input as { control?: unknown }).control === 'release') {
    releaseCommit?.()
    releaseCommit = undefined
    return
  }
  void server.handle(input)
})
lines.on('close', () => {
  releaseCommit?.()
  void store.close().finally(() => process.exit())
})
