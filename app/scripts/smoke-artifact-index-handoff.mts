import assert from 'node:assert/strict'
import {
  buildArtifactIndexFromRun,
  buildHandoffDocument,
  loadArtifactIndexes,
  buildArtifactEvidenceFromRun,
  recordArtifactEvidence,
  recordArtifactRun,
  saveArtifactIndexes,
  upsertArtifactIndex,
  type ArtifactEvidence,
  type ArtifactIndex,
} from '../src/agent/artifactIndex.ts'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const storage = new MemoryStorage()
const base: ArtifactIndex = {
  id: 'artifact:thread-1:run-1',
  threadId: 'thread-1',
  runId: 'run-1',
  status: 'active',
  currentStatus: '執行中',
  decisions: ['使用本機索引'],
  blockers: [],
  suggestedNextSkills: ['tdd'],
  updatedAt: '2026-07-19T00:00:00.000Z',
  entries: [],
}

const evidence: ArtifactEvidence[] = [
  { type: 'spec', source: 'docs/spec.md', title: 'Spec', status: 'complete', revision: 1 },
  { type: 'ticket', source: '.scratch/issues/11.md', title: 'Ticket', status: 'complete', revision: 1 },
  { type: 'test', source: 'app/scripts/smoke.mts', title: 'Smoke', status: 'complete', revision: 2 },
  { type: 'diff', source: 'git:working-tree', title: 'Diff', status: 'complete', digest: 'fnv1a:abc' },
  { type: 'review', source: 'review:run-1', title: 'Review', status: 'complete', revision: 1 },
  { type: 'decision', source: 'decision:local-only', title: 'Decision', status: 'complete', revision: 1 },
  { type: 'final-output', source: 'run:run-1/summary', title: 'Output', status: 'complete', digest: 'fnv1a:def' },
]

const indexed = evidence.reduce((current, item) => recordArtifactEvidence(current, item, '2026-07-19T00:01:00.000Z'), base)
saveArtifactIndexes(storage, [indexed])
const loaded = loadArtifactIndexes(storage)
assert.equal(loaded.length, 1)
assert.equal(loaded[0].entries.length, 7)
assert.equal(new Set(loaded[0].entries.map((entry) => entry.id)).size, 7)
assert.ok(loaded[0].entries.every((entry) => entry.id && entry.type && entry.status && entry.source && entry.at))
assert.ok(loaded[0].entries.every((entry) => entry.digest || entry.revision != null))
assert.equal(JSON.stringify(loaded).includes('full transcript'), false)

const updated = recordArtifactEvidence(indexed, {
  ...evidence[2],
  title: 'Smoke v3',
  revision: 3,
}, '2026-07-19T00:02:00.000Z')
assert.equal(updated.entries.length, 7)
assert.equal(updated.entries.find((entry) => entry.type === 'test')?.revision, 3)

const fromRun = buildArtifactIndexFromRun({
  threadId: 'thread-2',
  runId: 'run-2',
  objective: '完成 ticket-99 的測試與 review',
  status: 'failed',
  generatedAt: '2026-07-19T00:03:00.000Z',
  result: '需要修正權限',
  blockers: ['權限未核准'],
  decisions: ['保留本機交接'],
  suggestedNextSkills: ['code-review'],
  evidence,
})
assert.equal(fromRun.status, 'failed')
assert.deepEqual(fromRun.blockers, ['權限未核准'])
assert.match(fromRun.currentStatus, /需要修正權限/)

const autoEvidence = buildArtifactEvidenceFromRun({
  threadId: 'thread-3',
  runId: 'run-3',
  objective: '完成 ticket-99',
  status: 'success',
  diff: 'small diff',
  operations: [
    { id: 'test-1', kind: 'test', title: 'smoke test', ok: true },
    { id: 'review-1', kind: 'review', title: 'review', ok: true },
  ],
  plan: [{ id: 'p1', text: '完成', status: 'done' }],
  review: { source: 'review:run-3', status: 'complete' },
})
assert.deepEqual(new Set(autoEvidence.map((item) => item.type)), new Set([
  'spec', 'ticket', 'test', 'diff', 'review', 'decision', 'final-output',
]))
const storedRun = recordArtifactRun(storage, {
  threadId: 'thread-3',
  runId: 'run-3',
  objective: '完成 ticket-99',
  status: 'success',
  result: '完成',
  evidence: autoEvidence,
  generatedAt: '2026-07-19T00:03:30.000Z',
})
assert.equal(storedRun.entries.length, 7)

const stale = recordArtifactEvidence(fromRun, {
  type: 'diff',
  source: 'missing:diff.patch',
  title: 'Missing diff',
  status: 'stale',
  revision: 2,
}, '2026-07-19T00:04:00.000Z')
const handoff = buildHandoffDocument({
  threadId: stale.threadId,
  runId: stale.runId,
  index: stale,
  generatedAt: '2026-07-19T00:05:00.000Z',
})
assert.match(handoff, /Current status/)
assert.match(handoff, /Decisions/)
assert.match(handoff, /Blockers/)
assert.match(handoff, /Suggested next skills/)
assert.match(handoff, /STALE|MISSING/)
assert.match(handoff, /missing:diff\.patch/)
assert.match(handoff, /delivery was not performed|not uploaded/i)

const same = buildHandoffDocument({
  threadId: stale.threadId,
  runId: stale.runId,
  index: stale,
  generatedAt: '2026-07-19T00:05:00.000Z',
})
assert.equal(handoff, same)

const merged = upsertArtifactIndex(storage, stale)
assert.equal(merged.entries.length, 8)
assert.equal(loadArtifactIndexes(storage).length, 3)

console.log('artifact-index-handoff smoke: 8 assertions passed')
