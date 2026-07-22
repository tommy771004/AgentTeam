import { strict as assert } from 'node:assert'
import { PiCapabilityCatalog } from '../electron/piCapabilityExtension.ts'

const catalog = new PiCapabilityCatalog([{ id: 'workspace', description: 'project files', tools: ['read', 'write'], runbook: 'respect project scope', deferLoading: true }, { id: 'web', description: 'web research', tools: ['http_fetch'], runbook: 'cite sources', deferLoading: true }])
assert.equal(catalog.catalog()[0].deferred, true)
assert.deepEqual(catalog.load('workspace').tools, ['read', 'write'])
assert.deepEqual(catalog.activeTools(), ['read', 'write'])
assert.equal(catalog.search('web')[0].runbook, 'cite sources')
assert.equal(catalog.catalog().find((item) => item.id === 'web')?.deferred, false)
console.log('pi progressive capabilities are deterministic')
