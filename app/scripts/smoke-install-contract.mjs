import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
const builtIndex = fs.readFileSync(path.join(appRoot, 'dist', 'index.html'), 'utf8')
const mainSource = fs.readFileSync(path.join(appRoot, 'electron', 'main.ts'), 'utf8')
const threadStore = fs.readFileSync(path.join(appRoot, 'src', 'store', 'threadStore.ts'), 'utf8')
const settingsStore = fs.readFileSync(path.join(appRoot, 'src', 'store', 'settingsStore.ts'), 'utf8')
const protocolsPage = fs.readFileSync(path.join(appRoot, 'src', 'pages', 'ProtocolsPage.tsx'), 'utf8')
const runSummaryCard = fs.readFileSync(path.join(appRoot, 'src', 'components', 'RunSummaryCard.tsx'), 'utf8')
const installLifecycle = fs.readFileSync(path.join(appRoot, 'scripts', 'verify-packaged-install.mjs'), 'utf8')
const doctorCard = fs.readFileSync(path.join(appRoot, 'src', 'components', 'CliDoctorCard.tsx'), 'utf8')

assert.equal(packageJson.main, 'dist-electron/main.js')
assert.ok(fs.existsSync(path.join(appRoot, 'dist', 'index.html')), 'built renderer is missing')
assert.ok(fs.existsSync(path.join(appRoot, 'dist-electron', 'main.js')), 'built Electron main is missing')
assert.ok(fs.existsSync(path.join(appRoot, 'dist-electron', 'preload.cjs')), 'built preload is missing')
assert.doesNotMatch(builtIndex, /\bcrossorigin(?:=|\s|>)/, 'packaged file:// module scripts must not use crossorigin')

const builtMain = fs.readFileSync(path.join(appRoot, 'dist-electron', 'main.js'), 'utf8')
assert.match(mainSource, /if \(process\.env\.VITE_DEV_SERVER_URL\)/)
assert.match(mainSource, /mainWindow\.loadFile\(path\.join\(process\.env\.DIST!, 'index\.html'\)\)/)
assert.match(builtMain, /loadFile\(/)
assert.doesNotMatch(builtMain, /localhost:5173/)

assert.match(protocolsPage, /import\('\.\.\/agent\/taskRunCoordinator'\)/)
assert.match(protocolsPage, /await runTask\(/)
assert.match(runSummaryCard, /summary\.files/)
assert.match(runSummaryCard, /summary\.diff/)
assert.match(runSummaryCard, /沒有偵測到工作樹變更/)
assert.match(runSummaryCard, /run-summary-diff-content/)
assert.match(runSummaryCard, /run-summary-diff-empty/)
assert.match(installLifecycle, /runPackagedFirstTask/)
assert.match(installLifecycle, /uninstall|detach/)
assert.match(installLifecycle, /lastStatus === 'success'/)
assert.match(installLifecycle, /diff --git/)
assert.match(installLifecycle, /diffPreview/)
assert.match(doctorCard, /開始首次任務/)
assert.match(threadStore, /localStorage\.setItem\(KEY/)
assert.match(threadStore, /localStorage\.getItem\(k\)/)
assert.match(settingsStore, /localStorage\.setItem\(STORAGE_KEY/)
assert.match(settingsStore, /localStorage\.getItem\(STORAGE_KEY/)

console.log('Install/launch/restart contract: 1 scenario passed')
