import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  acceptsMemoryProjectionResponse,
  invalidateMemoryProjection,
  memoryProjectionBridgeAvailable,
  memoryProjectionBundle,
  type MemoryProjectionEntry,
} from '../src/agent/memoryProjection.ts'

let state = { generation: 1, revision: 4, invalidatedRevision: 4 }
assert.equal(memoryProjectionBridgeAvailable(undefined), false)
assert.equal(memoryProjectionBridgeAvailable({
  list() {}, countAll() {}, get() {}, upsert() {}, deleteEntry() {}, clearProject() {},
  clearGlobal() {}, clearAll() {}, deletionCapability() {}, consolidateDream() {},
}), true)
assert.equal(invalidateMemoryProjection(state, 3), state, 'out-of-order invalidation must be ignored')
state = invalidateMemoryProjection(state, 6)
assert.equal(state.invalidatedRevision, 6)
assert.equal(invalidateMemoryProjection(state, 6), state, 'duplicate invalidation must be ignored')

assert.equal(acceptsMemoryProjectionResponse(state, { generation: 1, minimumRevision: 6 }, 6), true)
assert.equal(acceptsMemoryProjectionResponse(state, { generation: 0, minimumRevision: 4 }, 7), false, 'stale generation must not win')
assert.equal(acceptsMemoryProjectionResponse(state, { generation: 1, minimumRevision: 6 }, 5), false, 'pre-invalidation page must not resurrect deleted content')

const base: Omit<MemoryProjectionEntry, 'id' | 'logicalKey' | 'kind' | 'text' | 'tags'> = {
  scope: { kind: 'global' }, createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z', revision: 6,
}
const profile: MemoryProjectionEntry = { ...base, id: 'profile', logicalKey: 'profile:user', kind: 'profile', text: 'USER', tags: ['always-recall'] }
const document: MemoryProjectionEntry = { ...base, id: 'document', logicalKey: 'memory:document', kind: 'document', text: 'MEMORY', tags: ['always-recall'] }
const memory: MemoryProjectionEntry = { ...base, id: 'memory', logicalKey: 'note', kind: 'memory', text: 'NOTE', tags: [] }
const bundle = memoryProjectionBundle({ items: [profile, document, memory], total: 3, revision: 6 }, { profile, document })
assert.equal(bundle.userProfile, 'USER')
assert.equal(bundle.memory, 'MEMORY')
assert.deepEqual(bundle.entries, [{ id: 'memory', kind: 'memory', text: 'NOTE', createdAt: base.createdAt, tags: [] }])
assert.ok(Date.parse(bundle.updatedAt))

const learningStoreSource = readFileSync(new URL('../src/store/learningStore.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(learningStoreSource, /syncLearningMemoriesToPiHost|piHost\?\.memory\?\.list/)
assert.match(learningStoreSource, /limit: MEMORY_PAGE_SIZE/)
assert.match(learningStoreSource, /acceptsMemoryProjectionResponse/)
assert.match(appSource, /event === 'memory\/changed'/)
assert.match(preloadSource, /pi-host:memory-projection:list/)
assert.match(preloadSource, /pi-host:memory-projection:clear-all/)
assert.doesNotMatch(settingsSource, /onChange=\{\(e\) => void setUserProfile/)
assert.match(settingsSource, /目前數字不是 canonical count/)
assert.match(settingsSource, /不會以空清單覆寫原資料/)

console.log('memory UI projection smoke: ok')
