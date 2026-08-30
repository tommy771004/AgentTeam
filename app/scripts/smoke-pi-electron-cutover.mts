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

const threadStore = await readFile(resolve(root, 'src/store/threadStore.ts'), 'utf8')
assert.match(threadStore, /piHostCanonical/)
assert.match(threadStore, /Host-owned history is not written to renderer storage/)
assert.match(threadStore, /piHostCanonical\(\) && get\(\)\.threads\.length > 0\) return/)

const protocolsPage = await readFile(resolve(root, 'src/pages/ProtocolsPage.tsx'), 'utf8')
assert.match(protocolsPage, /getRunIdForThread\(activeId\).*presentationRunId/)
assert.match(store, /cancelPiHostTurn\(target\)\.catch/)

const app = await readFile(resolve(root, 'src/App.tsx'), 'utf8')
assert.match(app, /mapPiHostEventToActivity/)
assert.match(app, /activity\.appendText\(update\.delta, update\.runId\)/)
assert.match(app, /activity\.push\(/)

const processFeed = await readFile(resolve(root, 'src/components/RunProcessFeed.tsx'), 'utf8')
const runPanel = await readFile(resolve(root, 'src/components/InlineRunPanel.tsx'), 'utf8')
assert.match(processFeed, /aria-expanded=\{processOpen\}/)
assert.match(processFeed, /收合執行細節/)
// The responding copy is owned by the lifecycle seam and reaches the feed as
// its resolved statusLine — the feed no longer hardcodes the sentence.
const runLifecycleSource = await readFile(resolve(root, 'src/agent/runLifecycle.ts'), 'utf8')
assert.match(runLifecycleSource, /正在撰寫回覆/)
assert.match(processFeed, /statusLine/)
assert.match(runPanel, /推理摘要/)
assert.match(processFeed, /執行時間軸/)
assert.doesNotMatch(processFeed, /任務進度/)
assert.match(runPanel, /<RunStatusSurface projection=\{statusSurface\}/)
assert.match(runPanel, /projectRunStatusSurface\(\{/)
assert.match(processFeed, /e\.kind === 'status'/)

const preload = await readFile(resolve(root, 'electron/preload.ts'), 'utf8')
assert.match(preload, /sessions:create/)
assert.match(preload, /threadId/) 
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { build?: { extraResources?: Array<{ from?: string; to?: string }> } }
assert.ok(packageJson.build?.extraResources?.some((resource) => resource.from === '../vendor/pi' && resource.to === 'vendor/pi'))

console.log('Electron production builtin dispatch is Pi Host-first and packaged with vendored Pi')
