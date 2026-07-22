import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dispatch = await readFile(resolve(root, 'src/agent/runDispatch.ts'), 'utf8')
const piBranch = dispatch.indexOf('Electron cutover: once the real Pi Host bridge is present')
const legacyStart = dispatch.indexOf('await agent.startExecution(text, overrides)')
assert.ok(piBranch >= 0, 'builtin dispatch must have an Electron Pi Host branch')
assert.ok(legacyStart > piBranch, 'legacy engine fallback must not precede the Pi Host branch')
assert.match(dispatch.slice(piBranch, legacyStart), /piHostAvailable/)
assert.match(dispatch, /electronRuntime/)
assert.match(dispatch, /Pi Core Host bridge is unavailable/)

const store = await readFile(resolve(root, 'src/store/agentStore.ts'), 'utf8')
assert.match(store, /submitPiHostRun\(/)
assert.match(store, /piHost\?\.turn\?\.cancel/) 

const settingsStore = await readFile(resolve(root, 'src/store/settingsStore.ts'), 'utf8')
assert.match(settingsStore, /piHost\?\.settings\?\.get/)
assert.match(settingsStore, /piHost\?\.settings\?\.update/)

const preload = await readFile(resolve(root, 'electron/preload.ts'), 'utf8')
assert.match(preload, /sessions:create/)
assert.match(preload, /threadId/) 
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { build?: { extraResources?: Array<{ from?: string; to?: string }> } }
assert.ok(packageJson.build?.extraResources?.some((resource) => resource.from === '../vendor/pi' && resource.to === 'vendor/pi'))

console.log('Electron production builtin dispatch is Pi Host-first and packaged with vendored Pi')
