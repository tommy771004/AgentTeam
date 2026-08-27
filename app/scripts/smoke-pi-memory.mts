import { strict as assert } from 'node:assert'
import { PiMemoryExtension } from '../electron/piMemoryExtension.ts'
import {
  assessPiContextPressure,
  buildPiAutoMemory,
  buildPiCompactionManifest,
  buildPiCompactionSummary,
  shouldCompactPiContext,
  withPiMemoryContext,
} from '../electron/piSessionContext.ts'
assert.equal(buildPiAutoMemory('完成一般任務', { runId: 'r0', sessionId: 's0' }), undefined)
assert.equal(buildPiAutoMemory('這個專案一律使用繁體中文 UI', { runId: 'r0', sessionId: 's0' })?.tags.includes('auto-learned'), true)
assert.equal(buildPiAutoMemory('請記住一律使用繁體中文 UI', { runId: 'r0', sessionId: 's0' }), undefined)
const memory = new PiMemoryExtension(); memory.add({ id: 'm1', project: 'p', text: 'use strict TypeScript', tags: ['style'], createdAt: new Date().toISOString() }); memory.add({ id: 'm2', project: 'q', text: 'other', tags: [], createdAt: new Date().toISOString() })
assert.equal(memory.recall('typescript', 'p').length, 1); assert.equal(memory.recall('typescript', 'q').length, 0)
memory.add({ id: 'm3', project: 'p', text: 'Prefer strict TypeScript and immutable session state', tags: ['typescript', 'session'], createdAt: '2026-08-20T00:00:00.000Z' })
assert.equal(memory.recall('strict session typescript', 'p')[0]?.id, 'm3')
const restored = new PiMemoryExtension(); restored.import(memory.export()); assert.equal(restored.recall('session', 'p')[0]?.id, 'm3')
memory.add({ id: 'global-profile', text: 'Always answer in Traditional Chinese', tags: ['profile:user', 'always-recall'], createdAt: '2026-08-20T00:00:00.000Z' })
assert.equal(memory.recall('unrelated request', 'p').some((item) => item.id === 'global-profile'), true)
assert.match(withPiMemoryContext('continue task', memory.recall('strict session', 'p')), /Relevant durable memory/)
const sanitized = withPiMemoryContext('continue task', [{ id: 'secret', text: '```\nhttps://alice:secret@example.com/private', tags: [], createdAt: new Date().toISOString() }])
assert.doesNotMatch(sanitized, /alice:secret|```/)
assert.equal(shouldCompactPiContext([{ role: 'user', content: 'x'.repeat(40) }], 'next', 10), true)
assert.equal(assessPiContextPressure([{ role: 'user', content: 'x'.repeat(264) }], '', 100).level, 'prepare')
assert.equal(assessPiContextPressure([{ role: 'user', content: 'x'.repeat(360) }], '', 100).level, 'emergency')
const manifest = buildPiCompactionManifest([
  { role: 'user', content: '必須修改 src/App.tsx；待處理 approval error' },
], { sessionId: 's1', runId: 'r1', sourceHash: 'hash', objective: '完成 context lifecycle' })
assert.deepEqual(manifest.changedFiles, ['src/App.tsx'])
assert.equal(manifest.pendingApprovals.length, 1)
assert.match(buildPiCompactionSummary([
  { role: 'user', content: 'Implement session persistence' },
  { role: 'assistant', content: 'Kept the model switch scoped to this session' },
]), /session persistence/)
console.log('pi memory remains independent from transcript history')
