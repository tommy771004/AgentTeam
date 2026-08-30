import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureElectronExecutable } from './electron-executable.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExecutable = ensureElectronExecutable()
const distEntry = path.join(appRoot, 'dist', 'index.html')
const mainEntry = path.join(appRoot, 'dist-electron', 'main.js')
if (!fs.existsSync(distEntry) || !fs.existsSync(mainEntry)) {
  throw new Error('Run npm run build before the instruction Electron E2E')
}

const { _electron: electron } = await import('playwright')
const fixtureRoot = path.join(os.tmpdir(), `subagents-ai-instruction-ui-e2e-${process.pid}`)
const userDataDir = path.join(fixtureRoot, 'user-data')
const projectRoot = path.join(fixtureRoot, 'project')
const launcherDir = path.join(fixtureRoot, 'launcher')
const openerModePath = path.join(fixtureRoot, 'opener-mode')
const openerMarkerPath = path.join(fixtureRoot, 'opener-marker')
fs.rmSync(fixtureRoot, { recursive: true, force: true })
fs.mkdirSync(projectRoot, { recursive: true })
fs.mkdirSync(launcherDir, { recursive: true })
fs.writeFileSync(openerModePath, 'success\n')
fs.writeFileSync(path.join(launcherDir, 'package.json'), JSON.stringify({
  name: 'subagents-ai-instruction-e2e-launcher',
  private: true,
  type: 'module',
  main: 'launcher.mjs',
}))

// The disposable launcher only replaces Electron's shell opener for this E2E.
// The renderer still invokes preload IPC and main still invokes the production
// openInstructionSource helper; success/failure is recorded without touching a
// user's real editor or filesystem. The hook is unreachable from the product.
fs.writeFileSync(path.join(launcherDir, 'launcher.mjs'), [
  "import { app, shell } from 'electron'",
  "import fs from 'node:fs'",
  `const modePath = ${JSON.stringify(openerModePath)}`,
  `const markerPath = ${JSON.stringify(openerMarkerPath)}`,
  'shell.openPath = async (target) => {',
  "  const mode = fs.readFileSync(modePath, 'utf8').trim()",
  "  fs.appendFileSync(markerPath, `${target}\\n`)",
  "  return mode === 'success' ? '' : 'E2E injected opener failure'",
  '}',
  `app.setPath('userData', ${JSON.stringify(userDataDir)})`,
  `await import(${JSON.stringify(pathToFileURL(mainEntry).href)})`,
  '',
].join('\n'))

const launchRecords = []
const launchElectron = async (stage) => {
  const record = { stage, stderr: '', exitCode: null, signal: null }
  const launched = await electron.launch({
    executablePath: electronExecutable,
    args: [launcherDir, '--no-sandbox', '--disable-gpu'],
    timeout: 30_000,
  })
  const process = launched.process()
  process?.stderr?.on('data', (chunk) => {
    record.stderr = `${record.stderr}${String(chunk)}`.slice(-8_000)
    console.error(`electron stderr: ${chunk}`)
  })
  process?.once('exit', (code, signal) => {
    record.exitCode = code
    record.signal = signal
  })
  launchRecords.push(record)
  return launched
}

let app = await launchElectron('initial')
let currentPage

const suiteDeadline = Date.now() + 60_000
const stepTrace = []
const step = (name) => {
  stepTrace.push(`${new Date().toISOString()} ${name}`)
  if (Date.now() >= suiteDeadline) throw new Error(`Instruction Electron E2E suite deadline exceeded at ${name}`)
}
const waitFor = async (page, locator) => {
  step('wait for UI control')
  return locator.waitFor({ state: 'visible', timeout: Math.max(1_000, Math.min(10_000, suiteDeadline - Date.now())) })
}
const metadataOnly = (root) => {
  const files = []
  const visit = (directory) => {
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      let stat
      try { stat = fs.statSync(target) } catch { continue }
      files.push({ path: target, size: stat.size, mtimeMs: stat.mtimeMs })
      if (entry.isDirectory() && files.length < 200) visit(target)
      if (files.length >= 200) return
    }
  }
  visit(root)
  return files
}
const publicDiagnostics = async (page) => {
  let visibleStatus = '<page unavailable>'
  let bodyTail = '<page unavailable>'
  let bridge = { unavailable: true }
  try {
    visibleStatus = (await page.locator('[role="status"]').allTextContents()).join(' | ').slice(-4_000) || '<none>'
    bodyTail = (await page.locator('body').innerText()).slice(-4_000)
    bridge = await page.evaluate(async () => {
      const instructions = window.subagents?.piHost?.instructions
      const host = window.subagents?.piHost
      const read = instructions?.get
        ? await instructions.get().then((value) => ({ ok: true, revision: value?.instructions?.revision, hash: value?.instructions?.hash }), (error) => ({ ok: false, error: String(error) }))
        : { unavailable: true }
      const health = host?.health
        ? await host.health().then((value) => ({ ok: true, status: value?.status }), (error) => ({ ok: false, error: String(error) }))
        : { unavailable: true }
      return { read, health }
    })
  } catch (error) {
    visibleStatus = `diagnostic error: ${error instanceof Error ? error.message : String(error)}`
  }
  return {
    visibleStatus,
    bodyTail,
    bridge,
    launches: launchRecords.map(({ stage, stderr, exitCode, signal }) => ({ stage, stderr, exitCode, signal })),
    userDataMetadata: metadataOnly(userDataDir),
  }
}
const waitForInstructionCommit = async (page, expectedRevision, expectedBody) => {
  const deadline = Math.min(suiteDeadline, Date.now() + 30_000)
  let lastTypedBridgeError = '<none>'
  while (Date.now() < deadline) {
    const observed = await page.evaluate(async () => {
      try {
        const snapshot = await window.subagents?.piHost?.instructions?.get?.()
        return {
          ok: true,
          revision: snapshot?.instructions?.revision,
          body: snapshot?.instructions?.globalCustomInstructions,
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
    if (!observed.ok) {
      lastTypedBridgeError = observed.error
    } else if (observed.revision > expectedRevision && observed.body === expectedBody) {
      return observed
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const diagnostics = await publicDiagnostics(page)
  throw new Error(`keyboard instruction commit timeout; lastTypedBridgeError=${lastTypedBridgeError}; diagnostics=${JSON.stringify(diagnostics)}`)
}
const waitForMarker = async (expected, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(openerMarkerPath) && fs.readFileSync(openerMarkerPath, 'utf8').trim() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`opener marker timeout: ${expected}`)
}
// macOS may expose /var through the /private/var symlink; the Host contract
// deliberately reports the realpath, so assertions use the same canonical
// identity as the production resolver.
const canonicalTarget = path.join(projectRoot, 'AGENTS.md')

try {
  const page = await app.firstWindow()
  currentPage = page
  page.setDefaultTimeout(10_000)
  step('renderer ready')
  page.on('crash', () => console.error('instruction Electron E2E renderer crashed'))
  page.on('close', () => console.error('instruction Electron E2E page closed'))
  page.on('console', (message) => console.error(`renderer console [${message.type()}]: ${message.text()}`))
  await page.waitForSelector('textarea', { timeout: 120_000 })

  // Seed the global authority through the public Host bridge before the
  // renderer projection loads. This keeps the read assertion on the shipped
  // preload -> main -> Pi Host path rather than a localStorage shortcut.
  const seeded = await page.evaluate(async () => {
    const instructions = window.subagents?.piHost?.instructions
    if (!instructions) throw new Error('Pi Host instruction bridge unavailable')
    const current = await instructions.get()
    if (current.instructions.revision === 0) {
      return instructions.save({ expectedRevision: 0, globalCustomInstructions: 'E2E_GLOBAL_PRESEEDED' })
    }
    return current
  })
  assert.equal(seeded.instructions.globalCustomInstructions, 'E2E_GLOBAL_PRESEEDED')

  // Seed the project through the same persisted renderer boundary used by the
  // product, then reload so projectStore hydrates it before its Host refresh.
  await page.evaluate((root) => {
    localStorage.setItem('subagents.project.root.v1', root)
  }, projectRoot)
  await page.reload()
  await page.waitForSelector('textarea', { timeout: 120_000 })
  await page.evaluate(() => { window.location.hash = '#/settings' })
  await page.getByRole('button', { name: '個人化' }).click()
  step('personalization projection visible')

  const globalEditor = page.getByRole('textbox', { name: '全域自訂指令' })
  await waitFor(page, globalEditor)
  await page.waitForFunction((expected) => {
    const editor = document.querySelector('textarea[aria-label="全域自訂指令"]')
    return editor?.value === expected
  }, 'E2E_GLOBAL_PRESEEDED', { timeout: 30_000 })
  assert.equal(await globalEditor.inputValue(), 'E2E_GLOBAL_PRESEEDED', 'UI must read the Host-committed global instruction')
  const seededFromHost = await page.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.equal(seededFromHost?.instructions?.globalCustomInstructions, 'E2E_GLOBAL_PRESEEDED')
  const seededRevision = seededFromHost.instructions.revision
  const seededHash = seededFromHost.instructions.hash

  // Hold the real SQLite authority in an exclusive transaction. The UI save
  // still crosses preload -> main -> Pi Host; the Host returns a typed busy
  // failure, so no success state or revision can be published.
  await globalEditor.fill('E2E_GLOBAL_MUST_NOT_COMMIT')
  const lockedDb = new DatabaseSync(path.join(userDataDir, 'instructions.sqlite'))
  lockedDb.exec('BEGIN EXCLUSIVE')
  try {
    await page.getByRole('button', { name: '儲存 revision' }).click()
    await page.getByText(/busy|忙碌|Instruction Repository/i).waitFor({ state: 'visible', timeout: 15_000 })
  } finally {
    lockedDb.exec('ROLLBACK')
    lockedDb.close()
  }
  const afterFailure = await page.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.equal(afterFailure?.instructions?.globalCustomInstructions, 'E2E_GLOBAL_PRESEEDED', 'failed Host transaction must preserve committed body')
  assert.equal(afterFailure?.instructions?.revision, seededRevision, 'failed Host transaction must not publish a revision')
  assert.equal(afterFailure?.instructions?.hash, seededHash, 'failed Host transaction must preserve committed hash')
  assert.ok(!(await page.locator('body').innerText()).includes('已由 Host transaction commit。'), 'failed save must not show success status')

  // Pointer save succeeds only after the failure authority is released. The
  // public Host read verifies exact body, monotonic revision and new hash.
  await globalEditor.fill('E2E_GLOBAL_COMMITTED')
  await page.getByRole('button', { name: '儲存 revision' }).click()
  await page.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  const committed = await page.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.equal(committed?.instructions?.globalCustomInstructions, 'E2E_GLOBAL_COMMITTED')
  assert.ok(committed.instructions.revision > seededRevision, 'successful Host save must advance revision')
  assert.notEqual(committed.instructions.hash, seededHash, 'successful Host save must publish a new hash')

  // Keyboard path for the same global Host transaction. Wait on the public
  // Host revision rather than the already-visible status text, so the test
  // proves the success state follows the commit instead of the click.
  await globalEditor.fill('E2E_GLOBAL_KEYBOARD_COMMITTED')
  const globalSave = page.getByRole('button', { name: '儲存 revision' })
  await globalSave.focus()
  await page.keyboard.press('Enter')
  step('keyboard global atomic save')
  await waitForInstructionCommit(page, committed.instructions.revision, 'E2E_GLOBAL_KEYBOARD_COMMITTED')
  const keyboardCommitted = await page.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.equal(keyboardCommitted?.instructions?.globalCustomInstructions, 'E2E_GLOBAL_KEYBOARD_COMMITTED')
  assert.ok(keyboardCommitted.instructions.revision > committed.instructions.revision, 'keyboard Host save must advance revision')
  assert.notEqual(keyboardCommitted.instructions.hash, committed.instructions.hash, 'keyboard Host save must publish a new hash')
  await page.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

  // Missing source creation is an explicit keyboard action. The resulting
  // save still crosses renderer -> preload -> main -> Host before the rest of
  // the source/open/edit assertions run.
  const createButton = page.getByRole('button', { name: '建立 AGENTS.md' })
  await waitFor(page, createButton)
  await createButton.focus()
  await page.keyboard.press('Enter')
  await page.locator('#project-instruction-editor').fill('# Electron source fixture\nE2E_SOURCE_OPEN_OK\n')
  const createSave = page.getByRole('button', { name: 'Atomic save' })
  await createSave.focus()
  await page.keyboard.press('Enter')
  await page.getByText('Project instruction 已 atomic commit。既有 run 維持 frozen snapshot，下一個 run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(fs.readFileSync(canonicalTarget, 'utf8'), '# Electron source fixture\nE2E_SOURCE_OPEN_OK\n')
  const canonical = fs.realpathSync(canonicalTarget)

  const openButton = page.getByRole('button', { name: '在編輯器開啟' }).first()
  await waitFor(page, openButton)
  assert.ok((await page.locator('body').innerText()).includes(canonical), 'source row must display the Host canonical path')

  // Pointer path: renderer button -> preload IPC -> main production helper ->
  // injected shell opener. The visible success status is the UI outcome.
  fs.rmSync(openerMarkerPath, { force: true })
  fs.writeFileSync(openerModePath, 'success\n')
  await openButton.click()
  step('pointer open')
  try {
    await page.getByText(`已開啟 canonical instruction source：${canonical}`, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  } catch (error) {
    console.error(`Pointer open did not show success. Visible text:\n${await page.locator('body').innerText()}\nOpener marker: ${fs.existsSync(openerMarkerPath) ? fs.readFileSync(openerMarkerPath, 'utf8') : '<missing>'}`)
    throw error
  }
  assert.equal(fs.readFileSync(openerMarkerPath, 'utf8').trim(), canonical, 'pointer action must hand the canonical source to shell')

  // Keyboard path: focus the preceding rescan control, then use real Tab
  // traversal and Enter on the same accessible source action.
  const rescan = page.getByRole('button', { name: '重新掃描' })
  await rescan.click()
  await rescan.focus()
  await page.keyboard.press('Tab') // 編輯
  await page.keyboard.press('Tab') // 在編輯器開啟
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent), '在編輯器開啟', 'Tab must focus the source action')
  fs.rmSync(openerMarkerPath, { force: true })
  await page.keyboard.press('Enter')
  step('keyboard open')
  await waitForMarker(canonical)
  await page.getByText(`已開啟 canonical instruction source：${canonical}`, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(fs.readFileSync(openerMarkerPath, 'utf8').trim(), canonical, 'keyboard action must use the same canonical source contract')

  // Project edit path: a real renderer control crosses preload -> main -> Host
  // writer and the Git-visible file is the commit evidence.
  const editButton = page.getByRole('button', { name: '編輯' }).first()
  await waitFor(page, editButton)
  await editButton.click()
  step('pointer edit')
  const editor = page.locator('#project-instruction-editor')
  try {
    await waitFor(page, editor)
  } catch (error) {
    let projectRead = '<unavailable>'
    try {
      projectRead = JSON.stringify(await page.evaluate(async (root) => {
        const instructions = window.subagents?.piHost?.instructions
        return instructions?.projectRead ? await instructions.projectRead({ projectRoot: root, workPath: root, target: 'AGENTS.md' }) : { unavailable: true }
      }, projectRoot))
    } catch (readError) { projectRead = `error: ${readError instanceof Error ? readError.message : String(readError)}` }
    console.error(`Pointer edit editor wait failed. Body:\n${await page.locator('body').innerText()}\nStatus:\n${await page.locator('[role="status"]').allTextContents()}\nproject-read:\n${projectRead}`)
    throw error
  }
  await editor.fill('# Electron source fixture\nE2E_EDITED_POINTER\n')
  await page.getByRole('button', { name: 'Atomic save' }).click()
  step('pointer atomic save')
  await page.getByText('Project instruction 已 atomic commit。既有 run 維持 frozen snapshot，下一個 run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), '# Electron source fixture\nE2E_EDITED_POINTER\n')

  // External editor wins while a renderer draft is open. The Host CAS error
  // remains visible and the newer file body survives unchanged.
  await page.getByRole('button', { name: '編輯' }).first().click()
  await page.locator('#project-instruction-editor').fill('STALE_RENDERER_DRAFT\n')
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), 'EXTERNAL_EDITOR_WINS\n')
  await page.getByRole('button', { name: 'Atomic save' }).click()
  step('stale save conflict')
  await page.getByText('Instruction file conflict', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), 'EXTERNAL_EDITOR_WINS\n')

  // Keyboard recovery uses the explicit UI action, which refreshes the Host
  // projection and replaces the stale draft with the observed external body.
  await page.getByRole('button', { name: '重新載入外部版本' }).click()
  step('reload external version')
  await page.getByText('已重新載入 external AGENTS.md revision/hash；可檢查內容後再儲存。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('#project-instruction-editor').inputValue(), 'EXTERNAL_EDITOR_WINS\n')
  await page.locator('#project-instruction-editor').fill('E2E_EDITED_KEYBOARD\n')
  const atomicSave = page.getByRole('button', { name: 'Atomic save' })
  await atomicSave.focus()
  await page.keyboard.press('Enter')
  step('keyboard atomic save')
  await page.getByText('Project instruction 已 atomic commit。既有 run 維持 frozen snapshot，下一個 run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), 'E2E_EDITED_KEYBOARD\n')

  // Visible typed failure: the injected opener is the only test seam; all
  // validation and IPC routing remain production behavior.
  fs.writeFileSync(openerModePath, 'failure\n')
  fs.rmSync(openerMarkerPath, { force: true })
  await openButton.click()
  await page.getByText('E2E injected opener failure', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(fs.readFileSync(openerMarkerPath, 'utf8').trim(), canonical, 'failure must still reach the production helper before shell rejection')

  // Restart the shipped app and read the committed global value through the
  // public Host bridge. This proves the successful transaction survived a
  // renderer reload and a fresh Pi Host process.
  await app.close()
  app = await launchElectron('restart')
  const restartedPage = await app.firstWindow()
  currentPage = restartedPage
  await restartedPage.waitForSelector('textarea', { timeout: 120_000 })
  const restarted = await restartedPage.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.equal(restarted?.instructions?.globalCustomInstructions, 'E2E_GLOBAL_KEYBOARD_COMMITTED', 'committed global instruction must survive Host restart')
  assert.equal(restarted?.instructions?.revision, keyboardCommitted.instructions.revision, 'Host restart must preserve committed revision')
  assert.equal(restarted?.instructions?.hash, keyboardCommitted.instructions.hash, 'Host restart must preserve committed hash')

  console.log('Instruction Electron E2E passed: real pointer/keyboard IPC open and visible typed failure')
} catch (error) {
  console.error(`Instruction Electron E2E trace:\n${stepTrace.join('\n')}`)
  console.error(`Instruction Electron E2E diagnostics:\n${JSON.stringify(await publicDiagnostics(currentPage), null, 2)}`)
  throw error
} finally {
  await app.close().catch(() => {})
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
