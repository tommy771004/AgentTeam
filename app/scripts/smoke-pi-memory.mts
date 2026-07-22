import { strict as assert } from 'node:assert'
import { PiMemoryExtension } from '../electron/piMemoryExtension.ts'
const memory = new PiMemoryExtension(); memory.add({ id: 'm1', project: 'p', text: 'use strict TypeScript', tags: ['style'], createdAt: new Date().toISOString() }); memory.add({ id: 'm2', project: 'q', text: 'other', tags: [], createdAt: new Date().toISOString() })
assert.equal(memory.recall('typescript', 'p').length, 1); assert.equal(memory.recall('typescript', 'q').length, 0)
const restored = new PiMemoryExtension(); restored.import(memory.export()); assert.equal(restored.recall('strict', 'p').length, 1)
console.log('pi memory remains independent from transcript history')
