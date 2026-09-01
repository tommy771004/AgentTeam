import assert from 'node:assert/strict'
import { PiHostAttachmentJournal } from '../electron/piHostAttachment.ts'
import {
  getJournalEntry,
  listJournalEntries,
  markRunAppFinalized,
  recordRunAdmitted,
  recordRunTerminal,
  resetRunJournalForTests,
} from '../src/agent/runJournal.ts'

class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
const contractDigest = 'a'.repeat(64)
const acceptanceDigest = 'b'.repeat(64)

let clock = 1_000
const journal = new PiHostAttachmentJournal({}, undefined, () => clock)
journal.begin({ runId: 'goal-terminal', sessionId: 'session-1', threadId: 'thread-1' })
journal.settle('goal-terminal', 'answered', 'done', 7, undefined, {
  executionSettlement: 'completed',
  goalVerdict: 'passed',
  goalContractDigest: contractDigest,
  acceptanceDigest,
  stopReason: 'acceptance-passed',
})
const restored = new PiHostAttachmentJournal(journal.snapshot(), undefined, () => clock)
const terminalTruth = restored.get('goal-terminal')
assert.equal(terminalTruth?.executionSettlement, 'completed')
assert.equal(terminalTruth?.goalVerdict, 'passed')
assert.equal(terminalTruth?.goalContractDigest, contractDigest)
assert.equal(terminalTruth?.acceptanceDigest, acceptanceDigest)

const claim = restored.claimFinalization('goal-terminal', 'renderer-a')
assert.equal(claim.owner, true)
clock += 1
assert.equal(restored.completeFinalization('goal-terminal', 'renderer-a', claim.claimEpoch).completed, true)
assert.deepEqual(
  {
    executionSettlement: restored.get('goal-terminal')?.executionSettlement,
    goalVerdict: restored.get('goal-terminal')?.goalVerdict,
    goalContractDigest: restored.get('goal-terminal')?.goalContractDigest,
    acceptanceDigest: restored.get('goal-terminal')?.acceptanceDigest,
  },
  { executionSettlement: 'completed', goalVerdict: 'passed', goalContractDigest: contractDigest, acceptanceDigest },
)
assert.equal(restored.acknowledge('goal-terminal'), true)

resetRunJournalForTests()
recordRunAdmitted({ runId: 'journal-terminal', objective: 'persist truth' })
recordRunTerminal({
  runId: 'journal-terminal',
  status: 'success',
  settlement: {
    executionKind: 'loop',
    turnSettlement: 'answered',
    executionSettlement: 'completed',
    goalVerdict: 'passed',
    goalContractDigest: contractDigest,
    acceptanceDigest,
    appFinalization: 'pending',
  },
})
markRunAppFinalized('journal-terminal')
const finalized = getJournalEntry('run', 'journal-terminal')
assert.equal(finalized?.appFinalization, 'completed')
assert.equal(finalized?.goalVerdict, 'passed')
assert.equal(finalized?.goalContractDigest, contractDigest)
assert.equal(finalized?.acceptanceDigest, acceptanceDigest)

resetRunJournalForTests()
memory.setItem('subagents.runJournal.v1', JSON.stringify({
  version: 1,
  updatedAt: new Date().toISOString(),
  entries: [
    { id: 'legacy-loop', kind: 'run', status: 'success', executionKind: 'loop', attempt: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'legacy-external', kind: 'run', status: 'success', executionKind: 'external', attempt: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
}))
const legacy = listJournalEntries()
assert.equal(legacy.find((entry) => entry.id === 'legacy-loop')?.goalProjection, 'legacy-unverified')
assert.equal(legacy.find((entry) => entry.id === 'legacy-loop')?.goalVerdict, undefined)
assert.equal(legacy.find((entry) => entry.id === 'legacy-external')?.goalProjection, 'not-applicable')

console.log('Goal finalization smoke: immutable Host truth, v2 journal, CAS, and conservative legacy mapping passed')
