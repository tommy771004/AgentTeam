import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
function argument(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] || fallback : fallback
}

const platform = argument('--platform')
const artifactDir = path.resolve(argument('--artifact-dir', 'release'))
const evidenceDir = path.resolve(argument('--evidence-dir', 'release-evidence'))
if (!['windows', 'macos'].includes(platform)) throw new Error('--platform must be windows or macos')
fs.mkdirSync(evidenceDir, { recursive: true })

const PACKAGED_SMOKE_REPORT_PATH = 'reports/packaged-smoke-report.md'
const PACKAGED_SMOKE_OBJECTIVE = `Smoke first task: use the write tool to update ${PACKAGED_SMOKE_REPORT_PATH} with a short report and reply with a brief confirmation.`

function runGit(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`Git command failed (${args.join(' ')}): ${result.stderr || result.stdout}`)
  }
}

function createSmokeProject() {
  const root = path.join(os.tmpdir(), `subagents-ai-smoke-project-${process.pid}`)
  fs.rmSync(root, { recursive: true, force: true })
  try {
    const reportPath = PACKAGED_SMOKE_REPORT_PATH
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true })
    fs.writeFileSync(path.join(root, reportPath), '# Packaged install baseline\n', 'utf8')
    runGit(root, ['init', '--quiet'])
    runGit(root, ['config', 'user.email', 'packaged-smoke@example.invalid'])
    runGit(root, ['config', 'user.name', 'Packaged Smoke'])
    runGit(root, ['add', '--', reportPath])
    runGit(root, ['commit', '--quiet', '-m', 'baseline'])
    return { root, reportPath }
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}

function filesUnder(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name)
    return entry.isDirectory() ? filesUnder(root, absolute) : [absolute]
  })
}

function directoriesUnder(current) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name)
    if (!entry.isDirectory()) return []
    return [absolute, ...directoriesUnder(absolute)]
  })
}

function writeEvidence(payload) {
  fs.writeFileSync(
    path.join(evidenceDir, 'install-launch-restart-uninstall.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  )
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPiApproval(page, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const approvalMode = await page.evaluate(async () => (await window.subagents?.piHost?.settings?.get?.())?.settings?.approvalMode)
    if (approvalMode === 'full') return
    await wait(250)
  }
  throw new Error('Pi Host approval mode did not settle to full')
}

async function waitForPiHostSession(page, objective, timeout = 120000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = await page.evaluate(async (text) => {
      const sessions = (await window.subagents?.piHost?.sessions?.list?.())?.sessions || []
      return sessions.some((session) =>
        Array.isArray(session?.messages) &&
        session.messages.some((message) => message?.role === 'user' && message?.content === text) &&
        session.messages.some((message) => message?.role === 'assistant'),
      )
    }, objective).catch(() => false)
    if (found) return
    await wait(500)
  }
  throw new Error('Pi Host session did not settle with the packaged task')
}

async function runPackagedFirstTask(executable, platform, userDataDir, smokeProject) {
  const { _electron: electron } = await import('playwright')
  const objective = PACKAGED_SMOKE_OBJECTIVE
  let app
  let restarted
  try {
    app = await electron.launch({
      executablePath: executable,
      args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
      timeout: 30000,
    })
    const page = await app.firstWindow()
    await page.waitForSelector('textarea', { timeout: 120000 })
    if (smokeProject?.root) {
      await page.evaluate(async (root) => {
        localStorage.setItem('subagents.project.root.v1', root)
        await window.subagents?.project?.setActiveRoot?.(root)
      }, smokeProject.root)
      await page.reload()
      await page.waitForSelector('textarea', { timeout: 120000 })
    }
    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await page.waitForFunction(() => window.location.hash === '#/settings', undefined, { timeout: 10000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('組態')),
      undefined,
      { timeout: 120000 },
    )
    await page.getByRole('button', { name: /組態/ }).click()
    await page
      .getByRole('button')
      .filter({ hasText: '完整存取權' })
      .filter({ hasText: '可無限制存取' })
      .click()
    await waitForPiApproval(page)
    const configuredSettings = await page.evaluate(async () => ({
      renderer: localStorage.getItem('subagents.settings.v1'),
      piHost: await window.subagents?.piHost?.settings?.get?.(),
    }))
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForSelector('textarea', { timeout: 120000 })
    const composer = page.locator('textarea').first()
    await composer.fill(objective)
    await composer.press('Enter')
    await waitForPiHostSession(page, objective)
    await page.waitForSelector('[data-testid="run-summary-card"]', { state: 'attached', timeout: 120000 })
    const firstRun = await page.evaluate(async () => ({
      settingsState: localStorage.getItem('subagents.settings.v1'),
      piHostSettings: await window.subagents?.piHost?.settings?.get?.(),
      piHostSessions: (await window.subagents?.piHost?.sessions?.list?.())?.sessions || [],
      body: document.body.innerText,
    }))
    const firstTaskSession = firstRun.piHostSessions.find((session) =>
      Array.isArray(session?.messages) &&
      session.messages.some((message) => message?.role === 'user' && message?.content === objective) &&
      session.messages.some((message) => message?.role === 'assistant'),
    )
    if (!firstTaskSession) throw new Error('First task did not settle a Pi Host session')
    await page.locator('[data-testid="run-summary-card"] > button').first().click()
    await page.waitForSelector('[data-testid="run-summary-diff"]', { state: 'attached', timeout: 120000 })
    await page.locator('[data-testid="run-summary-diff"] > button').click()
    const diffContent = page.locator('[data-testid="run-summary-diff-content"]')
    await diffContent.waitFor({ state: 'visible', timeout: 120000 })
    const diffText = await diffContent.innerText()
    const resultVisible = await page.locator('[data-testid="run-summary-card"]').count() > 0
    const diffVisible = /^(?:diff --git |--- |\+\+\+ |@@ )/m.test(diffText)
    if (!resultVisible || !diffVisible) throw new Error('First task result or Git Diff was not visible')
    await app.close()
    app = undefined

    restarted = await electron.launch({
      executablePath: executable,
      args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
      timeout: 30000,
    })
    let restartedPage = await restarted.firstWindow()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await restartedPage.waitForSelector('textarea', { timeout: 120000 })
        await waitForPiHostSession(restartedPage, objective)
        break
      } catch (error) {
        await restarted.close()
        restarted = undefined
        if (attempt === 1) throw error
        await wait(1000)
        restarted = await electron.launch({
          executablePath: executable,
          args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
          timeout: 30000,
        })
        restartedPage = await restarted.firstWindow()
      }
    }
    const afterRestart = await restartedPage.evaluate(async () => ({
      settingsState: localStorage.getItem('subagents.settings.v1'),
      piHostSettings: await window.subagents?.piHost?.settings?.get?.(),
      piHostSessions: (await window.subagents?.piHost?.sessions?.list?.())?.sessions || [],
      body: document.body.innerText,
    }))
    const restoredSession = afterRestart.piHostSessions.find((session) =>
      Array.isArray(session?.messages) &&
      session.messages.some((message) => message?.role === 'user' && message?.content === objective) &&
      session.messages.some((message) => message?.role === 'assistant'),
    )
    if (!restoredSession || !afterRestart.body.includes(objective)) throw new Error('Restart did not restore the Pi Host session projection')
    const configuredPiSettings = configuredSettings.piHost?.settings?.approvalMode
    const afterRestartPiSettings = afterRestart.piHostSettings?.settings?.approvalMode
    if (configuredPiSettings !== 'full' || afterRestartPiSettings !== 'full') {
      throw new Error('Restart did not restore the first-run settings')
    }
    await restarted.close()
    restarted = undefined
    return {
      objective,
      resultVisible,
      diffVisible,
      diffPreview: diffText.slice(0, 600),
      firstTaskSessionMessages: firstTaskSession.messages.length,
      settingsPersisted: Boolean(firstRun.settingsState && afterRestart.settingsState === firstRun.settingsState),
      restartedSessionMessages: restoredSession.messages.length,
      platform,
    }
  } finally {
    await restarted?.close().catch(() => {})
    await app?.close().catch(() => {})
  }
}

async function verifyWindows() {
  const installer = filesUnder(artifactDir).find((file) => /setup.*\.exe$/i.test(path.basename(file)))
  if (!installer) throw new Error('Windows installer was not found')
  const installDir = path.join(os.tmpdir(), `subagents-ai-install-${process.pid}`)
  const userDataDir = path.join(os.tmpdir(), `subagents-ai-user-data-${process.pid}`)
  let smokeProject
  let executable
  let firstTask
  let uninstall
  try {
    fs.rmSync(installDir, { recursive: true, force: true })
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.mkdirSync(installDir, { recursive: true })
    const install = spawnSync(installer, ['/S', `/D=${installDir}`], { encoding: 'utf8' })
    if (install.status !== 0) throw new Error(`Windows installer failed: ${install.status}`)
    const installedExecutables = filesUnder(installDir).filter((file) =>
      /\.exe$/i.test(file) && !/unins|uninstall|elevate|update/i.test(path.basename(file)),
    )
    executable = installedExecutables.find((file) => path.basename(file) === 'SubAgents AI.exe') || installedExecutables[0]
    if (!executable) throw new Error('Installed application executable was not found')

    smokeProject = createSmokeProject()
    firstTask = await runPackagedFirstTask(executable, platform, userDataDir, smokeProject)
    const launches = [{ attempt: 1 }, { attempt: 2 }]
    const uninstaller = filesUnder(installDir).find((file) => /unins.*\.exe$/i.test(path.basename(file)))
    if (!uninstaller) throw new Error('Installed uninstaller was not found')
    uninstall = spawnSync(uninstaller, ['/S'], { encoding: 'utf8' })
    if (uninstall.status !== 0) throw new Error(`Windows uninstall failed: ${uninstall.status}`)
    let removed = false
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await wait(1000)
      if (!fs.existsSync(installDir) || filesUnder(installDir).length === 0) {
        removed = true
        break
      }
    }
    if (!removed) throw new Error('Windows uninstall left installed files behind')
    writeEvidence({ platform, installer, executable, launches, firstTask, uninstall: { status: uninstall.status, removed: true } })
  } finally {
    fs.rmSync(smokeProject?.root || '', { recursive: true, force: true })
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(installDir, { recursive: true, force: true })
  }
}

async function verifyMacos() {
  const dmg = filesUnder(artifactDir).find((file) => file.toLowerCase().endsWith('.dmg'))
  if (!dmg) throw new Error('macOS DMG was not found')
  const mountPoint = path.join(os.tmpdir(), `subagents-ai-dmg-${process.pid}`)
  const userDataDir = path.join(os.tmpdir(), `subagents-ai-user-data-${process.pid}`)
  const installDir = path.join(os.tmpdir(), `subagents-ai-mac-install-${process.pid}`)
  let mounted = false
  let mountPointExists = false
  let installedApp
  let smokeProject
  let firstTask
  try {
    fs.rmSync(mountPoint, { recursive: true, force: true })
    fs.mkdirSync(mountPoint, { recursive: true })
    mountPointExists = true
    const mount = spawnSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mountPoint], { encoding: 'utf8' })
    if (mount.status !== 0) throw new Error(`DMG mount failed: ${mount.stderr || mount.stdout}`)
    mounted = true
    const app = directoriesUnder(mountPoint).find((directory) => directory.endsWith('.app'))
    if (!app) throw new Error('Mounted macOS application was not found')
    installedApp = path.join(installDir, path.basename(app))
    fs.rmSync(installDir, { recursive: true, force: true })
    fs.mkdirSync(installDir, { recursive: true })
    fs.cpSync(app, installedApp, { recursive: true, dereference: false })
    const executable = path.join(installedApp, 'Contents', 'MacOS', path.basename(installedApp, '.app'))
    if (!fs.existsSync(executable)) throw new Error('Mounted macOS executable was not found')
    fs.rmSync(userDataDir, { recursive: true, force: true })
    smokeProject = createSmokeProject()
    firstTask = await runPackagedFirstTask(executable, platform, userDataDir, smokeProject)
    const launches = [{ attempt: 1 }, { attempt: 2 }]
    const detach = spawnSync('hdiutil', ['detach', mountPoint], { encoding: 'utf8' })
    if (detach.status !== 0) throw new Error(`DMG detach failed: ${detach.stderr || detach.stdout}`)
    mounted = false
    fs.rmSync(installDir, { recursive: true, force: true })
    if (fs.existsSync(installedApp)) throw new Error('macOS uninstall left the installed app behind')
    writeEvidence({ platform, dmg, mountedApp: app, installedApp, launches, firstTask, uninstall: { status: detach.status, kind: 'app-copy-and-dmg-detach', removed: true } })
  } finally {
    fs.rmSync(smokeProject?.root || '', { recursive: true, force: true })
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.rmSync(installDir, { recursive: true, force: true })
    if (mounted) spawnSync('hdiutil', ['detach', mountPoint, '-force'], { encoding: 'utf8' })
    if (mountPointExists) fs.rmSync(mountPoint, { recursive: true, force: true })
  }
}

if (platform === 'windows') await verifyWindows()
else await verifyMacos()
console.log(`Packaged ${platform} install, launch, restart, and uninstall verified`)
