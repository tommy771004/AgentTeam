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
if (!fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) {
  throw new Error('Run npm run build before the settings lifecycle E2E')
}

const { _electron: electron } = await import('playwright')
const userDataDir = path.join(os.tmpdir(), `subagents-ai-settings-lifecycle-${process.pid}`)
fs.rmSync(userDataDir, { recursive: true, force: true })

const app = await electron.launch({
  executablePath: electronExecutable,
  args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  timeout: 30_000,
})

const waitForApp = async (page) => {
  await page.waitForSelector('textarea', { timeout: 120_000 })
}

const goTo = async (page, hash) => {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash
  }, hash)
  await page.waitForTimeout(250)
}

try {
  const page = await app.firstWindow()
  await waitForApp(page)

  // Seed both stores with the same value so this test isolates the later
  // settings-page remount instead of startup migration or stale fixtures.
  await page.evaluate(async () => {
    localStorage.setItem('subagents.settings.v1', JSON.stringify({ theme: 'dark' }))
    await window.subagents?.settings?.set?.({ theme: 'dark' })
  })
  await page.reload()
  await waitForApp(page)

  await goTo(page, '#/settings')
  await page.locator('button').filter({ hasText: '外觀' }).first().click()
  const themeSelect = page.locator('select').first()
  await themeSelect.selectOption('light')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  assert.equal(
    (await page.evaluate(() => window.subagents?.settings?.get?.()))?.theme,
    'light',
    'renderer-owned theme must be written to the Electron settings bridge',
  )

  // Match the user flow: visit another feature, then return to settings.
  await goTo(page, '#/')
  await waitForApp(page)
  await goTo(page, '#/settings')
  await page.locator('button').filter({ hasText: '外觀' }).first().click()

  assert.equal(await themeSelect.inputValue(), 'light', 'theme selection must survive settings remount')
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'light',
    'document theme must remain light after settings remount',
  )
  console.log('Settings lifecycle E2E passed: light theme survives feature navigation and settings remount')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
