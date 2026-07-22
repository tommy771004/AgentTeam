import { strict as assert } from 'node:assert'
import { PiResourceRegistry } from '../electron/piResourceRegistry.ts'
const registry = new PiResourceRegistry()
registry.discover([{ id: 'z', kind: 'skill', source: 'z/SKILL.md', enabled: true }, { id: 'a', kind: 'extension', source: 'a.ts', enabled: false }])
assert.deepEqual(registry.list().map((item) => item.id), ['a', 'z'])
registry.setEnabled('a', true); assert.equal(registry.list()[0].enabled, true)
registry.reload([{ id: 'a', kind: 'extension', source: 'a-v2.ts', enabled: true }]); assert.equal(registry.list().length, 1)
console.log('pi resources have deterministic discovery and reload')
