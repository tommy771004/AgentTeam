/**
 * Durable run-journal mirror (hermes delivery-ledger lesson, item 1).
 *
 * localStorage can be evicted under quota pressure and has no torn-write
 * protection. The renderer journal therefore mirrors every persisted state
 * into the main process, and hydrates from that mirror at startup when local
 * storage holds nothing usable — BEFORE reconcileStartup marks runs
 * interrupted, so recovery sees restored history rather than an empty journal.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  JournalMirrorStore,
} from '../electron/journalMirrorStore.ts'
import {
  getJournalEntry,
  hydrateRunJournalFromDurable,
  listRecoveryReports,
  recordRunAdmitted,
  recordRunStarted,
  reconcileStartup,
  resetRunJournalForTests,
  setRunJournalMirrorBridge,
} from '../src/agent/runJournal.ts'

class MemoryStorage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })

// ── JournalMirrorStore: atomic save / read round-trip + backup fallback ──
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-mirror-'))
  const store = new JournalMirrorStore(root)
  assert.ok(store.save(JSON.stringify({ version: 1, entries: [{ id: 'a' }] })).ok)
  const primary = store.read()
  assert.equal(primary?.fromBackup, false)
  assert.ok(primary?.state.includes('"id":"a"'))
  assert.equal(store.owner.pid, process.pid)

  // Second save moves the previous snapshot to the backup slot.
  assert.ok(store.save(JSON.stringify({ version: 1, entries: [{ id: 'b' }] })).ok)
  // A torn/corrupted primary fails its checksum and falls back to the backup.
  fs.writeFileSync(path.join(root, 'run-journal-mirror.json'), '{"version":1,"state":"torn","checksum":"bad"}')
  const fallback = store.read()
  assert.equal(fallback?.fromBackup, true)
  assert.ok(fallback?.state.includes('"id":"a"'))

  // Oversized or non-string payloads are rejected without writing.
  assert.equal(store.save('x'.repeat(600_000)).ok, false)

  fs.rmSync(root, { recursive: true, force: true })
}

// ── Renderer bridge: every persist mirrors; hydrate restores before startup ──
let mirroredPayload: string | null = null
setRunJournalMirrorBridge({
  read: () => Promise.resolve(mirroredPayload ? { state: mirroredPayload } : null),
  write: (state: string) => {
    mirroredPayload = state
    return Promise.resolve({ ok: true })
  },
})
resetRunJournalForTests()

recordRunAdmitted({ runId: 'run-mirrored', objective: 'survive eviction', sourceKind: 'composer' })
assert.ok(mirroredPayload, 'persistState must queue a durable mirror write')
assert.ok(mirroredPayload.includes('run-mirrored'))

// Simulate browser eviction: local state gone, mirror still has it.
memory.clear()

const restored = await hydrateRunJournalFromDurable()
assert.equal(restored, true, 'hydrate must restore from the mirror after local eviction')
assert.equal(getJournalEntry('run', 'run-mirrored')?.status, 'admitted')
const restoreReports = listRecoveryReports().filter((report) =>
  report.items.some((item) => item.kind === 'storage' && item.action === 'restored'))
assert.ok(restoreReports.length >= 1, 'restore must be reported, never silent')

// Hydrate is a no-op while local storage already holds entries.
assert.equal(await hydrateRunJournalFromDurable(), false)

// Startup reconciliation then sees the RESTORED entry, not an empty journal.
const report = reconcileStartup()
assert.ok(report?.items.some((item) => item.id === 'run-mirrored' && item.action === 'marked-interrupted'))

// ── Hydrate refuses to run without a bridge or without usable mirror data ──
resetRunJournalForTests()
mirroredPayload = null
assert.equal(await hydrateRunJournalFromDurable(), false, 'no bridge data → no restore')
setRunJournalMirrorBridge({
  read: () => Promise.resolve({ state: 'not-json' }),
  write: () => Promise.resolve({ ok: true }),
})
assert.equal(await hydrateRunJournalFromDurable(), false, 'corrupt mirror payload → no restore')

setRunJournalMirrorBridge(null)
console.log('smoke-run-journal-durability: all assertions passed')
