import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFile(resolve(root, file), 'utf8')
const agentStore = await read('src/store/agentStore.ts')
const settingsStore = await read('src/store/settingsStore.ts')
const dispatch = await read('src/agent/runDispatch.ts')
const checkpoint = await read('src/agent/compactionCheckpoint.ts')
const plugins = await read('src/agent/hermes/plugins.ts')
const learning = await read('src/store/learningStore.ts')
const app = await read('src/App.tsx')
const hostEntry = await read('electron/piHostEntry.ts')

assert.doesNotMatch(agentStore, /import\s+\{\s*agentEngine\s*\}\s+from\s+['"]\.\.\/agent\/engine['"]/, 'renderer store must not statically own legacy engine')
assert.match(agentStore, /loadLegacyEngine\(\)/)
assert.match(agentStore, /Legacy renderer engine is disabled when Pi Host is available/)
assert.match(settingsStore, /stripPiOwnedSettings/)
assert.match(settingsStore, /isElectronPiProduction\(\)/)
assert.match(settingsStore, /piSettingsPatchFromLlmSettings/)
assert.match(dispatch, /Pi Core Host bridge is unavailable/)
// Checkpoints moved from renderer storage to the main-process durable layer.
// The ownership claim is unchanged — the renderer still owns none of it — but
// the owner it defers to is now the Host store rather than a skipped write.
assert.doesNotMatch(checkpoint, /localStorage/, 'the renderer must not own checkpoint persistence')
assert.match(checkpoint, /it lives in the main process alongside the durable journal/)
assert.match(checkpoint, /subagents\?\.checkpoints/)
assert.match(plugins, /Pi Host extensions are the only executable resource\/tool owner/)
assert.match(learning, /Pi Host owns durable memories\/extensions/)
assert.match(app, /isElectronPiProduction\(\)/)
assert.match(hostEntry, /pi-settings-migration\.json/)
assert.match(hostEntry, /credentialPersisted/)

console.log('Pi production owner contract passed: renderer fallback is browser-only and Electron is Pi-owned')
