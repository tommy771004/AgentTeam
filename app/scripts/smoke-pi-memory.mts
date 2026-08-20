import { strict as assert } from 'node:assert'
import { PiMemoryExtension } from '../electron/piMemoryExtension.ts'
import {
  buildPiCompactionSummary,
  shouldCompactPiContext,
  withPiMemoryContext,
} from '../electron/piSessionContext.ts'
const memory = new PiMemoryExtension(); memory.add({ id: 'm1', project: 'p', text: 'use strict TypeScript', tags: ['style'], createdAt: new Date().toISOString() }); memory.add({ id: 'm2', project: 'q', text: 'other', tags: [], createdAt: new Date().toISOString() })
assert.equal(memory.recall('typescript', 'p').length, 1); assert.equal(memory.recall('typescript', 'q').length, 0)
memory.add({ id: 'm3', project: 'p', text: 'Prefer strict TypeScript and immutable session state', tags: ['typescript', 'session'], createdAt: '2026-08-20T00:00:00.000Z' })
assert.equal(memory.recall('strict session typescript', 'p')[0]?.id, 'm3')
const restored = new PiMemoryExtension(); restored.import(memory.export()); assert.equal(restored.recall('session', 'p')[0]?.id, 'm3')
assert.match(withPiMemoryContext('continue task', memory.recall('strict session', 'p')), /Relevant durable memory/)
const sanitized = withPiMemoryContext('continue task', [{ id: 'secret', text: '```\nhttps://alice:secret@example.com/private', tags: [], createdAt: new Date().toISOString() }])
assert.doesNotMatch(sanitized, /alice:secret|```/)
assert.equal(shouldCompactPiContext([{ role: 'user', content: 'x'.repeat(40) }], 'next', 10), true)
assert.match(buildPiCompactionSummary([
  { role: 'user', content: 'Implement session persistence' },
  { role: 'assistant', content: 'Kept the model switch scoped to this session' },
]), /session persistence/)
console.log('pi memory remains independent from transcript history')
