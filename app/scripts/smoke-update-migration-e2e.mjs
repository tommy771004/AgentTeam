import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureElectronExecutable } from './electron-executable.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExecutable = ensureElectronExecutable()
if (!fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) throw new Error('Run npm run build before the update migration E2E')
const { _electron: electron } = await import('playwright')
const userDataDir = path.join(os.tmpdir(), `subagents-ai-update-e2e-${process.pid}`)
fs.rmSync(userDataDir, { recursive: true, force: true })
const projectRootBefore = path.join(userDataDir, 'fixture-project')
const projectRootMigrated = path.join(userDataDir, 'fixture-project-migrated')
fs.mkdirSync(projectRootBefore, { recursive: true })
fs.mkdirSync(projectRootMigrated, { recursive: true })

const launch = () => electron.launch({ executablePath: electronExecutable, args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`], timeout: 30_000 })
const waitForReady = async (page) => page.waitForSelector('textarea', { timeout: 120_000 })
const waitForUpdateStatus = async (page, expected) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await page.evaluate(() => window.subagents?.updates?.state?.())
    if (state?.status === expected) return state
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`update state did not reach ${expected}`)
}
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
const canonicalPath = (target) => fs.realpathSync.native(target)

const app = await launch()
try {
  const page = await app.firstWindow()
  await waitForReady(page)
  const baseline = await page.evaluate(async (projectRoot) => {
    const now = new Date().toISOString()
    localStorage.setItem('subagents.settings.v1', JSON.stringify({ theme: 'dark', apiKey: 'keep-in-renderer-before-migration' }))
    await window.subagents?.settings?.set?.({ theme: 'dark', apiKey: 'keep-in-renderer-before-migration' })
    const persistedSettings = await window.subagents?.settings?.get?.()
    if (persistedSettings?.apiKey !== 'keep-in-renderer-before-migration') throw new Error(`settings bridge did not persist fixture key: ${JSON.stringify(persistedSettings)}`)
    await window.subagents?.secrets?.store?.({ id: 'fixture', token: 'fixture-token-for-isolated-e2e' })
    localStorage.setItem('subagents.project.root.v1', projectRoot)
    localStorage.setItem('subagents.threads.v5', localStorage.getItem('subagents.threads.v5') || JSON.stringify({ threads: [], activeId: null }))
    await window.subagents?.project?.setActiveRoot?.(projectRoot)
    const userDataPath = await window.subagents?.userDataPath?.()
    await window.subagents?.scheduler?.saveAll?.([{ id: 'update-e2e-job', name: 'Update E2E', objective: 'preserve', kind: 'daily', enabled: true, dailyAt: '08:00', lastStatus: 'success', createdAt: now }])
    return { userDataPath, threads: localStorage.getItem('subagents.threads.v5') }
  }, projectRootBefore)
  assert.ok(baseline.userDataPath)
  assert.equal(canonicalPath(baseline.userDataPath), canonicalPath(userDataDir), 'Electron E2E must use isolated userData')
  const updatesDir = path.join(baseline.userDataPath, 'updates')
  const backupPath = path.join(updatesDir, 'migration-backup-e2e.json')
  const stagedPath = path.join(updatesDir, 'fixture-installer.bin')
  const snapshot = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    rendererStorage: {
      'subagents.threads.v5': baseline.threads,
      'subagents.settings.v1': JSON.stringify({ theme: 'light' }),
      'subagents.project.root.v1': projectRootMigrated,
      'subagents.runQueue.v1': JSON.stringify({ v: 1, items: [{ id: 'queued-after-update', enqueuedAt: new Date().toISOString(), dedupeKey: 'runId:queued-after-update', objective: 'preserve queued run', title: 'Queued after update', sourceKind: 'schedule', loopType: 'Goal-based' }] }),
      'subagents.artifactIndex.v1': JSON.stringify({ refs: ['update-e2e'] }),
    },
    vaultMetadata: [{ id: 'fixture', encrypted: true }],
    projects: [{ root: projectRootMigrated }],
    queue: { v: 1, items: [{ id: 'queued-after-update', enqueuedAt: new Date().toISOString(), dedupeKey: 'runId:queued-after-update', objective: 'preserve queued run', title: 'Queued after update', sourceKind: 'schedule', loopType: 'Goal-based' }] },
    schedules: [{ id: 'update-e2e-job', name: 'Update E2E', objective: 'preserve', kind: 'daily', enabled: true, dailyAt: '08:00', lastStatus: 'success', createdAt: new Date().toISOString() }],
    artifactIndex: { refs: ['update-e2e'] },
  }
  writeJson(backupPath, snapshot)
  writeJson(path.join(updatesDir, 'state.json'), { schemaVersion: 1, status: 'install-pending', currentVersion: '1.0.0', progress: 100, transactionId: 'e2e-migration', backupPath, updatedAt: new Date().toISOString() })
  await page.reload()
  await waitForReady(page)
  await waitForUpdateStatus(page, 'idle')
  await page.waitForFunction(() => document.body.innerText.includes('設定'), undefined, { timeout: 30_000 })
  const migrated = await page.evaluate(async () => ({
    settings: JSON.parse(localStorage.getItem('subagents.settings.v1') || '{}'),
    settingsBridge: await window.subagents?.settings?.get?.(),
    queue: JSON.parse(localStorage.getItem('subagents.runQueue.v1') || '{}'),
    queueBackup: JSON.parse(localStorage.getItem('subagents.runQueue.v1.backup') || '{}'),
    project: localStorage.getItem('subagents.project.root.v1'),
    artifactIndex: JSON.parse(localStorage.getItem('subagents.artifactIndex.v1') || 'null'),
    vault: await window.subagents?.secrets?.list?.(),
    activeProject: await window.subagents?.project?.getActiveRoot?.(),
    state: await window.subagents?.updates?.state?.(),
    jobs: await window.subagents?.scheduler?.list?.(),
  }))
  assert.equal(migrated.settings.theme, 'light')
  assert.equal(migrated.settings.apiKey, undefined, 'migration must not restore API keys into renderer storage')
  assert.equal(migrated.settingsBridge?.apiKey, 'keep-in-renderer-before-migration', 'main-process settings must preserve the existing API key')
  assert.ok([migrated.queue, migrated.queueBackup].some((queue) => queue.items?.some((item) => item.id === 'queued-after-update')), 'queue item must survive migration or be durably acknowledged')
  assert.equal(migrated.project, projectRootMigrated)
  assert.deepEqual(migrated.artifactIndex, { refs: ['update-e2e'] })
  assert.ok(migrated.vault?.some((item) => item.id === 'fixture'), 'vault metadata must survive migration')
  assert.equal(canonicalPath(migrated.activeProject?.projectRoot || ''), canonicalPath(projectRootMigrated))
  assert.equal(migrated.state.status, 'idle')
  assert.equal(migrated.jobs.find((job) => job.id === 'update-e2e-job')?.enabled, true)

  // Exercise the main-process rollback IPC with a real userData backup and staged file.
  fs.writeFileSync(stagedPath, 'fixture installer', 'utf8')
  const rollbackBackup = path.join(updatesDir, 'migration-backup-rollback.json')
  writeJson(rollbackBackup, snapshot)
  writeJson(path.join(updatesDir, 'state.json'), { schemaVersion: 1, status: 'install-pending', currentVersion: '1.0.0', progress: 100, transactionId: 'e2e-rollback', backupPath: rollbackBackup, downloadedPath: stagedPath, updatedAt: new Date().toISOString() })
  const rollback = await page.evaluate(() => window.subagents?.updates?.rollback?.())
  assert.equal(rollback.ok, true)
  assert.equal(rollback.launchable, true)
  assert.deepEqual(rollback.snapshot?.rendererStorage?.['subagents.runQueue.v1'], snapshot.rendererStorage['subagents.runQueue.v1'])
  assert.equal(fs.existsSync(stagedPath), false)

  // A failed installer leaves the old binary running. On the next startup the
  // old version must detect the target mismatch and roll the transaction back
  // instead of silently committing the pending snapshot.
  const failedInstallPath = path.join(updatesDir, 'fixture-failed-installer.bin')
  fs.writeFileSync(failedInstallPath, 'failed installer', 'utf8')
  const failedBackup = path.join(updatesDir, 'migration-backup-failed.json')
  writeJson(failedBackup, snapshot)
  writeJson(path.join(updatesDir, 'state.json'), {
    schemaVersion: 1,
    status: 'install-pending',
    currentVersion: '1.0.0',
    progress: 100,
    transactionId: 'e2e-failed-install',
    backupPath: failedBackup,
    downloadedPath: failedInstallPath,
    manifest: { version: '99.0.0' },
    updatedAt: new Date().toISOString(),
  })
  await page.evaluate(() => {
    localStorage.setItem('subagents.settings.v1', JSON.stringify({ theme: 'broken-after-failed-install' }))
    localStorage.setItem('subagents.project.root.v1', 'broken-after-failed-install')
    localStorage.setItem('subagents.runQueue.v1', JSON.stringify({ v: 1, items: [] }))
    return window.subagents?.settings?.set?.({ theme: 'broken-after-failed-install' })
  })
  await page.reload()
  await waitForReady(page)
  await waitForUpdateStatus(page, 'rolled-back')
  const recoveredAfterFailure = await page.evaluate(async () => ({
    state: await window.subagents?.updates?.state?.(),
    settings: JSON.parse(localStorage.getItem('subagents.settings.v1') || '{}'),
    settingsBridge: await window.subagents?.settings?.get?.(),
    project: localStorage.getItem('subagents.project.root.v1'),
    queue: JSON.parse(localStorage.getItem('subagents.runQueue.v1') || '{}'),
  }))
  assert.equal(recoveredAfterFailure.state.status, 'rolled-back')
  assert.equal(recoveredAfterFailure.settings.theme, 'light')
  assert.equal(recoveredAfterFailure.settingsBridge?.theme, 'light')
  assert.equal(recoveredAfterFailure.project, projectRootMigrated)
  assert.ok(recoveredAfterFailure.queue.items?.some((item) => item.id === 'queued-after-update') || migrated.queueBackup.items?.some((item) => item.id === 'queued-after-update'))
  assert.equal(fs.existsSync(failedInstallPath), false)
  console.log(`Update migration E2E passed (${process.platform}/${process.arch})`)
} finally {
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
