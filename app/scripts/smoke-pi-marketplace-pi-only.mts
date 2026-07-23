import { strict as assert } from 'node:assert'
import { pluginRegistry } from '../src/agent/hermes/plugins.ts'
import { skillsStore } from '../src/agent/hermes/skills.ts'

const skillName = 'pi-marketplace-only'
const pluginId = 'pi-marketplace-fixture'
pluginRegistry.add({
  id: pluginId,
  name: 'Pi Marketplace fixture',
  version: '1.0.0',
  enabled: true,
  piOnly: true,
  skills: [{ path: 'pi-only/SKILL.md', raw: `---\nname: ${skillName}\ndescription: Pi-only fixture\nversion: 1.0.0\nauthor: test\ncreatedBy: test\n---\n\n# Pi only\n` }],
  promptAppend: 'must not be loaded by Hermes',
})
const applied = pluginRegistry.apply()
assert.equal(applied.promptFragments.some((fragment) => fragment.includes('Pi Marketplace fixture')), false)
assert.equal(skillsStore.list().some((skill) => skill.name === skillName), false)
pluginRegistry.remove(pluginId)
pluginRegistry.apply()
console.log('Pi Marketplace packages remain discoverable as metadata without a second Hermes loader')
