import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
const qualification = packageJson.scripts['smoke:pi-parity-qualification'] || ''

/**
 * This is the one-hop evidence index for the durable-memory effort. Each named
 * smoke executes before this file in the same npm command and exercises shipped
 * modules at its owning seam. Keeping the index executable prevents tracker
 * prose from claiming coverage that the main gate no longer runs.
 */
const lifecycleEvidence = [
  ['store parity, Unicode, pagination, quota, retry', 'smoke-durable-memory-store.mts'],
  ['SQLite adapter and restart durability', 'smoke-sqlite-durable-memory-store.mts'],
  ['authority policy and scope', 'smoke-durable-memory-authority.mts'],
  ['legacy migration and quarantine', 'smoke-durable-memory-migration.mts'],
  ['runtime policy negative matrix', 'smoke-pi-host-memory-policy-matrix.mts'],
  ['protocol negotiation, revision, restart', 'smoke-pi-host-durable-memory.mts'],
  ['cutover, downgrade barrier, recovery', 'smoke-pi-host-memory-migration.mts'],
  ['Memory Pack tool writes and recall', 'smoke-pi-memory-pack-lifecycle.mts'],
  ['automatic and explicit final settlement', 'smoke-run-learning-settlement.mts'],
  ['renderer invalidation and refetch', 'smoke-memory-ui-projection.mts'],
  ['scoped clear and hard delete', 'smoke-memory-scoped-delete.mts'],
  ['atomic Dream consolidation', 'smoke-memory-dream-consolidation.mts'],
  ['canonical export', 'smoke-canonical-memory-export.mts'],
  ['preview-first atomic import', 'smoke-canonical-memory-import.mts'],
  ['corruption, degraded state, WAL shutdown', 'smoke-memory-storage-lifecycle.mts'],
  ['disk, lock, concurrency, kill, privacy', 'smoke-memory-failure-matrix.mts'],
] as const

let previous = -1
for (const [claim, file] of lifecycleEvidence) {
  const at = qualification.indexOf(`scripts/${file}`)
  assert.ok(at > previous, `${claim} evidence must be present in deterministic order in smoke:pi-parity-qualification`)
  previous = at
}
assert.match(packageJson.scripts.smoke, /npm run smoke:pi-parity-qualification/, 'the full smoke chain must reach durable-memory qualification')
assert.match(qualification, /smoke-durable-memory-workflow-qualification\.mts$/, 'the one-hop audit must close the qualification chain')

const protocol = read('electron/piHostProtocol.ts')
assert.match(protocol, /PI_HOST_PROTOCOL_VERSION = 5 as const/)
assert.doesNotMatch(protocol, /'memory\/(?:list|add|delete|clear|recall)'/)
assert.doesNotMatch(protocol, /result:\s*\{[^\n]*memories\b/)
assert.doesNotMatch(protocol, /snapshot:\s*\{[^\n]*memories\b/)

const state = read('electron/piHostState.ts')
assert.doesNotMatch(state, /^\s*memories\??:\s*PiMemory\[\]/m)
assert.match(state, /schemaVersion:\s*snapshot\.memoryAuthority \? 4 : 2/)

const productionBoundary = [
  'electron/main.ts',
  'electron/preload.ts',
  'electron/piHostSupervisor.ts',
  'src/store/learningStore.ts',
  'src/agent/hermes/dream.ts',
].map(read).join('\n')
assert.doesNotMatch(productionBoundary, /pi-host:memory:(?:list|add|delete|clear|recall)/)
assert.match(productionBoundary, /memoryProjection/, 'renderer consumers must remain disposable Host projections')
assert.match(read('electron/piDurableMemory.ts'), /store\.(?:upsert|append|recall|get)/, 'runtime memory bridge must delegate to DurableMemoryStore')

console.log(`durable-memory workflow qualification: ${lifecycleEvidence.length} ordered gates, protocol v5, one mutation authority, no legacy owner`)
