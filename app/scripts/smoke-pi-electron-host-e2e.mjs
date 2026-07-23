import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExecutable = path.join(appRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')
if (!fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) throw new Error('Run npm run build before the Pi Electron Host E2E')
const { _electron: electron } = await import('playwright')
const userDataDir = path.join(os.tmpdir(), `subagents-ai-pi-host-e2e-${process.pid}`)
fs.rmSync(userDataDir, { recursive: true, force: true })
const app = await electron.launch({ executablePath: electronExecutable, args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`], timeout: 30_000 })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('textarea', { timeout: 120_000 })
  const health = await page.evaluate(async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await window.subagents?.piHost?.status?.().catch(() => ({ state: 'error' }))
      if (status?.state === 'ready') return window.subagents?.piHost?.health?.()
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Pi Core Host did not become ready in Electron')
  })
  assert.equal(health?.status, 'ready')
  assert.equal(health?.protocolVersion, 1)
  const sessions = await page.evaluate(() => window.subagents?.piHost?.sessions?.list?.())
  assert.ok(Array.isArray(sessions?.sessions))
  const extensions = await page.evaluate(() => window.subagents?.piHost?.extensions?.list?.())
  assert.ok(Array.isArray(extensions?.extensions))
  console.log('Electron launches the real Pi Core Host and exposes protocol, session, and extension bridges')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
