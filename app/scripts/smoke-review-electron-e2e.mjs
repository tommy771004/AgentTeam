import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureElectronExecutable } from './electron-executable.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(appRoot, '..')
const evidenceDir = path.join(repoRoot, '.scratch', 'run-review-workspace', 'evidence')
// Keep release smoke screenshots separate from the historical review evidence.
const screenshotDir = path.join(appRoot, 'test-results', 'review-electron')
const qualifyRealRunners = process.env.SUBAGENTS_REVIEW_REAL_RUNNERS === '1'
const realRunnerEvidence = []
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstudio-review-electron-'))
const projectRoot = path.join(fixtureRoot, 'project')
const userDataDir = path.join(fixtureRoot, 'profile')
fs.mkdirSync(projectRoot, { recursive: true })
fs.mkdirSync(evidenceDir, { recursive: true })
fs.mkdirSync(screenshotDir, { recursive: true })

const git = (...args) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
git('init')
git('config', 'user.email', 'review-e2e@example.com')
git('config', 'user.name', 'Review E2E')
fs.writeFileSync(path.join(projectRoot, 'source.ts'), 'export const value = 1\n')
fs.writeFileSync(path.join(projectRoot, 'large.ts'), Array.from({ length: 1200 }, (_, index) => `export const line${index} = ${index}\n`).join(''))
git('add', '.')
git('commit', '-m', 'baseline')

const { _electron: electron } = await import('playwright')
const electronExecutable = ensureElectronExecutable()
const env = {
  ...process.env,
  SUBAGENTS_PI_HOST_E2E_USER_DATA_DIR: userDataDir,
  SUBAGENTS_PI_HOST_STATE_PATH: path.join(userDataDir, 'pi-host-state.json'),
  SUBAGENTS_PI_AGENT_DIR: path.join(userDataDir, 'pi-agent'),
  SUBAGENTS_PI_NATIVE_AGENT_DIR: path.join(userDataDir, 'empty-native-agent'),
  SUBAGENTS_PI_SYNC_CLI_OAUTH: 'true',
  SUBAGENTS_REVIEW_ARTIFACT_DB_PATH: path.join(userDataDir, 'review-artifacts.sqlite'),
  SUBAGENTS_REVIEW_STATE_DB_PATH: path.join(userDataDir, 'review-state.sqlite'),
  SUBAGENTS_REVIEW_VERIFICATION_DB_PATH: path.join(userDataDir, 'review-verification.sqlite'),
}

async function launch() {
  const app = await electron.launch({ executablePath: electronExecutable, args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`], env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('textarea', { timeout: 120_000 })
  return { app, page }
}

async function reviewCall(page, name, ...args) {
  return page.evaluate(async ({ name, args }) => {
    const review = window.subagents?.piHost?.review
    const call = review?.[name]
    if (typeof call !== 'function') throw new Error(`missing review bridge: ${name}`)
    return call(...args)
  }, { name, args })
}

async function reloadShippedPage(page) {
  const reloadUrl = page.url()
  const target = reloadUrl.startsWith('file:') ? fileURLToPath(reloadUrl) : undefined
  let lastError
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (target && !fs.existsSync(target)) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    try {
      await page.reload()
      return
    } catch (error) {
      lastError = error
      if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Electron reload target did not stabilize: ${reloadUrl}; ${String(lastError || 'file missing')}`)
}

let running
try {
  running = await launch()
  const { page } = running
  const admittedA = await reviewCall(page, 'admit', { runId: 'run_builtin_a', threadId: 'thread_review_e2e', projectRoot, runnerKind: 'builtin' })
  const snapshotA = admittedA.reviewAdmission.snapshotId
  if (qualifyRealRunners) {
    try {
      const result = await page.evaluate(async ({ projectRoot }) => {
        const session = await window.subagents.piHost.sessions.create('Review builtin qualification', 'thread_review_e2e')
        const current = await window.subagents.piHost.settings.get()
        const codex = current.config?.subscriptionCatalog?.find((provider) => provider.id === 'openai-codex' && provider.availability === 'available')
        const model = codex?.models.find((candidate) => candidate.id === 'gpt-5.6-luna')?.id || codex?.models[0]?.id
        if (!model) throw new Error('openai-codex subscription catalog has no available model')
        const selected = await window.subagents.piHost.settings.update({ provider: 'openai-codex', model })
        const stopApprovalListener = window.subagents.piHost.onEvent((event) => {
          const payload = event.payload
          if (event.event === 'host/approval-requested' && payload?.runId === 'run_builtin_a') {
            void window.subagents.piHost.approvals.resolve({ runId: payload.runId, callId: payload.callId, decision: 'allow' })
          }
        })
        let turn
        try {
          turn = await window.subagents.piHost.turn.submit({
            sessionId: session.sessionId,
            runId: 'run_builtin_a',
            cwd: projectRoot,
            prompt: 'Use the write tool now. Create builtin-review-proof.txt in the current workspace with exactly this single line: builtin review qualification passed. Do not merely describe the action; verify the file exists before finishing.',
            profile: { ...selected.settings, approvalMode: 'full', unattended: false, activeTools: ['write'] },
            contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: true, approvalTimeoutMs: 30000 },
            pattern: 'Turn-based',
            maxIterations: 1,
            timeoutMs: 120000,
          })
        } finally {
          stopApprovalListener()
        }
        return { turn, provider: selected.settings.provider, model: selected.settings.model }
      }, { projectRoot })
      const proof = fs.existsSync(path.join(projectRoot, 'builtin-review-proof.txt'))
      const passed = result.turn.settlement === 'answered' && proof
      const diagnostic = passed ? '' : String(result.turn.items?.[0]?.content || '').replaceAll('\n', ' ').slice(0, 320)
      realRunnerEvidence.push({ runner: 'builtin', status: passed ? 'passed' : 'failed', detail: `provider=${result.provider}; model=${result.model}; settlement=${result.turn.settlement}; proof=${proof}; iterations=${result.turn.orchestration?.iterations ?? 'unknown'}${diagnostic ? `; error=${diagnostic}` : ''}` })
    } catch (error) {
      realRunnerEvidence.push({ runner: 'builtin', status: 'blocked', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  fs.writeFileSync(path.join(projectRoot, 'source.ts'), 'export const value = 2\n')
  fs.writeFileSync(path.join(projectRoot, 'large.ts'), Array.from({ length: 1200 }, (_, index) => `export const line${index} = ${index + 1}\n`).join(''))
  await reviewCall(page, 'finalize', { snapshotId: snapshotA, settlementKind: 'completed' })
  const artifactA = (await reviewCall(page, 'read', snapshotA)).reviewArtifact
  assert.equal(artifactA.status, 'ready')
  assert.ok(artifactA.manifest.length >= 2)
  const hashA = artifactA.manifestHash

  const draft = await reviewCall(page, 'saveDraft', { snapshotId: snapshotA, path: 'source.ts', side: 'new', line: 1, body: 'Please keep the exported value stable.' })
  await reviewCall(page, 'transitionComment', draft.reviewComment.id, 'submitted')
  const feedback = await reviewCall(page, 'prepareFeedback', snapshotA)
  assert.equal(feedback.reviewFeedbackBundle.snapshotId, snapshotA)

  const admittedB = await reviewCall(page, 'admit', { runId: 'run_external_b', threadId: 'thread_review_e2e', projectRoot, runnerKind: 'external' })
  const snapshotB = admittedB.reviewAdmission.snapshotId
  if (qualifyRealRunners) {
    try {
      const result = await page.evaluate(({ projectRoot }) => window.subagents.cli.runAgent({ kind: 'codex', prompt: 'Create external-cli-review-proof.txt in the current workspace with exactly: external review qualification passed. Do not modify any other file.', cwd: projectRoot, agentMode: 'build', approvalMode: 'full', unattended: true, timeoutMs: 120000, runId: 'run_external_b', conversationId: 'thread_review_e2e', effectiveMode: 'off' }), { projectRoot })
      const passed = result.ok === true && fs.existsSync(path.join(projectRoot, 'external-cli-review-proof.txt'))
      const diagnostic = String(result.error || '').replaceAll('\n', ' ').slice(0, 240)
      realRunnerEvidence.push({ runner: 'codex-cli', status: passed ? 'passed' : 'failed', detail: `code=${result.code}; terminal=${result.terminalClassification?.classification || 'unknown'}; proof=${passed}${diagnostic ? `; error=${diagnostic}` : ''}` })
    } catch (error) {
      realRunnerEvidence.push({ runner: 'codex-cli', status: 'blocked', detail: error instanceof Error ? error.message : String(error) })
    }
  } else {
    fs.appendFileSync(path.join(projectRoot, 'source.ts'), 'export const external = true\n')
  }
  await reviewCall(page, 'finalize', { snapshotId: snapshotB, settlementKind: 'completed' })
  const artifactB = (await reviewCall(page, 'read', snapshotB)).reviewArtifact
  assert.ok(['shared', 'partial'].includes(artifactB.attributionFidelity), 'shared checkout external attribution cannot be upgraded to exact')
  assert.equal((await reviewCall(page, 'read', snapshotA)).reviewArtifact.manifestHash, hashA, 'historical A remains immutable after B')

  await page.evaluate(({ snapshotA, snapshotB }) => {
    const tabs = [
      { id: `review:{\"kind\":\"run-snapshot\",\"snapshotId\":\"${snapshotA}\"}`, title: '審查 A', target: { kind: 'review', target: { kind: 'run-snapshot', snapshotId: snapshotA } } },
      { id: `review:{\"kind\":\"run-snapshot\",\"snapshotId\":\"${snapshotB}\"}`, title: '審查 B', target: { kind: 'review', target: { kind: 'run-snapshot', snapshotId: snapshotB } } },
    ]
    localStorage.setItem('agentstudio.workspace-panel-session.v1', JSON.stringify({ version: 1, tabs, activeTabId: tabs[0].id, dock: 'right', reviewWidth: 720, maximized: false }))
  }, { snapshotA, snapshotB })
  await reloadShippedPage(page)
  await page.waitForSelector('[aria-label="工作區面板"]', { timeout: 30_000 })
  await page.getByRole('tab', { name: /審查 A/ }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('審查 B'))
  assert.match(await page.evaluate(() => document.activeElement?.textContent || ''), /審查 B/)
  await page.getByRole('tab', { name: /審查 A/ }).click()
  await page.waitForSelector('text=source.ts')
  await page.screenshot({ path: path.join(screenshotDir, 'review-desktop.png'), fullPage: true })
  await running.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setMinimumSize(320, 600)
    window.setSize(390, 800)
  })
  await page.waitForFunction(() => window.innerWidth <= 390)
  const narrowPanel = page.locator('[aria-label="工作區面板"]')
  await narrowPanel.waitFor({ state: 'visible', timeout: 10_000 })
  const panelBox = await narrowPanel.boundingBox()
  assert.ok(panelBox && panelBox.x === 0 && panelBox.x + panelBox.width <= 390, 'narrow Review panel covers the visible viewport instead of hiding behind sidebars')
  assert.equal(await page.evaluate(() => {
    const panel = document.querySelector('[aria-label="工作區面板"]')
    return Boolean(panel?.contains(document.elementFromPoint(20, 100)))
  }), true, 'narrow Review panel is painted above the navigation sidebar')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'narrow Review has no document-level horizontal overflow')
  await page.screenshot({ path: path.join(screenshotDir, 'review-narrow.png'), fullPage: true })

  await running.app.close()
  running = await launch()
  assert.equal((await reviewCall(running.page, 'read', snapshotA)).reviewArtifact.manifestHash, hashA, 'snapshot survives full Electron/Host restart')
  assert.equal((await reviewCall(running.page, 'listComments', snapshotA)).reviewComments.length, 1, 'submitted comments survive full restart')
  await running.page.waitForSelector('[aria-label="工作區面板"]', { timeout: 30_000 })
  if (qualifyRealRunners) {
    const report = ['# Run Review real-runner qualification', '', `Qualified: ${new Date().toISOString()}`, `Machine: ${process.platform}/${process.arch}`, '', '| Runner | Status | Safe diagnostic |', '|---|---|---|', ...realRunnerEvidence.map((item) => `| ${item.runner} | ${item.status} | ${item.detail.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`), '', 'Prompt/output bodies and credentials are not retained. The Electron test separately proves snapshot reload/restart, A→B immutability, comments, keyboard tabs, large diff paging, and responsive layout.', ''].join('\n')
    fs.writeFileSync(path.join(evidenceDir, 'real-runner-qualification.md'), report)
    assert.ok(realRunnerEvidence.length === 2 && realRunnerEvidence.every((item) => item.status === 'passed'), 'real builtin and Codex CLI qualification must both pass')
  }
  console.log('Review Electron E2E passed: builtin/external admission, immutable A→B, reload/restart, comments, and responsive tabs')
} finally {
  await running?.app.close().catch(() => {})
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
