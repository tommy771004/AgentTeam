import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExecutable = path.join(
  appRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron',
)
if (!fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) throw new Error('Run npm run build before the Design System Electron E2E')
const { _electron: electron } = await import('playwright')
const userDataDir = path.join(os.tmpdir(), `subagents-ai-design-system-e2e-${process.pid}`)
const projectRoot = path.join(userDataDir, 'fixture-project')
fs.rmSync(userDataDir, { recursive: true, force: true })
fs.mkdirSync(projectRoot, { recursive: true })

const app = await electron.launch({
  executablePath: electronExecutable,
  args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  timeout: 30_000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('textarea', { timeout: 120_000 })
  await page.evaluate(async (root) => {
    localStorage.setItem('subagents.project.root.v1', root)
    const result = await window.subagents?.project?.setActiveRoot?.(root)
    if (!result?.ok) throw new Error(`project root setup failed: ${result?.error || 'unknown'}`)
  }, projectRoot)
  await page.reload()
  await page.waitForSelector('textarea', { timeout: 120_000 })

  const bridgeResult = await page.evaluate(async (root) => {
    const directory = '.subagents/subdesign/design-systems/aurora'
    const createdDirectory = await window.subagents?.tools?.workspaceMkdir?.(directory, root)
    if (!createdDirectory?.ok) throw new Error(`DESIGN.md directory creation failed: ${createdDirectory?.error || 'unknown'}`)
    const created = await window.subagents?.tools?.workspaceWrite?.(`${directory}/DESIGN.md`, '# Aurora\n\n## Overview\n\nFirst draft.', root)
    if (!created?.ok) throw new Error(`DESIGN.md creation failed: ${created?.error || 'unknown'}`)
    const edited = await window.subagents?.tools?.workspaceWrite?.(`${directory}/DESIGN.md`, '# Aurora Edited\n\n## Overview\n\nEdited in Electron.', root)
    if (!edited?.ok) throw new Error(`DESIGN.md edit failed: ${edited?.error || 'unknown'}`)
    const read = await window.subagents?.tools?.workspaceRead?.(`${directory}/DESIGN.md`, root)
    return { created, edited, read }
  }, projectRoot)
  assert.equal(bridgeResult.created.ok, true)
  assert.equal(bridgeResult.edited.ok, true)
  assert.match(bridgeResult.read.content, /Aurora Edited/)
  assert.equal(fs.readFileSync(path.join(projectRoot, '.subagents/subdesign/design-systems/aurora/DESIGN.md'), 'utf8').includes('Edited in Electron.'), true)

  await page.evaluate(() => { window.location.hash = '#/design-systems?returnTo=%2Fsubdesign' })
  await page.waitForFunction(() => document.body.innerText.includes('Choose a Design System'), undefined, { timeout: 30_000 })
  await page.waitForFunction(() => document.body.innerText.includes('Aurora Edited'), undefined, { timeout: 30_000 })
  await page.getByRole('radio').filter({ hasText: 'Aurora Edited' }).click()
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    const apply = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Use in new design'))
    if (!apply) throw new Error('Design System apply button not found')
    apply.click()
  })
  await page.waitForFunction(() => window.location.hash.includes('#/subdesign?designSystemId=aurora'), undefined, { timeout: 30_000 })
  console.log('Electron Design System flow creates, edits, reads, and applies a real DESIGN.md')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
