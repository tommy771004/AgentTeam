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
  throw new Error('Run npm run build before the real recovery smoke')
}

const { _electron: electron } = await import('playwright')
const root = path.join(os.tmpdir(), `subagents-ai-recovery-e2e-${process.pid}`)
fs.rmSync(root, { recursive: true, force: true })

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function launch(userDataDir) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    timeout: 30_000,
  })
}

async function seedInterruptedState(page, cycle, queuedSchedule = false) {
  await page.waitForSelector('textarea', { timeout: 120_000 })
  await page.evaluate(({ suffix, queuedSchedule }) => {
    const stored = JSON.parse(localStorage.getItem('subagents.threads.v5') || '{}')
    const threads = Array.isArray(stored) ? stored : stored.threads || []
    const activeId = stored.activeId || threads[0]?.id
    if (!activeId || !threads.length) throw new Error('thread store did not hydrate')
    localStorage.setItem(
      'subagents.threads.v5',
      JSON.stringify({
        threads: threads.map((thread) =>
          thread.id === activeId ? { ...thread, lastStatus: 'running' } : thread,
        ),
        activeId,
      }),
    )
    const at = new Date().toISOString()
    localStorage.setItem(
      'subagents.runJournal.v1',
      JSON.stringify({
        version: 1,
        updatedAt: at,
        entries: [
          {
            id: `real-run-${suffix}`,
            kind: 'run',
            status: 'running',
            runId: `real-run-${suffix}`,
            threadId: activeId,
            objective: 'real renderer/main recovery smoke',
            sourceKind: 'smoke',
            attempt: 1,
            startedAt: at,
            updatedAt: at,
          },
          {
            id: `real-queue-${suffix}`,
            kind: 'queue',
            status: queuedSchedule ? 'queued' : 'dispatching',
            queueId: `real-queue-${suffix}`,
            runId: `real-run-${suffix}`,
            objective: 'queued work must not duplicate after termination',
            attempt: 1,
            startedAt: at,
            updatedAt: at,
          },
          {
            id: `real-schedule-${suffix}`,
            kind: 'schedule',
            status: 'running',
            scheduleJobId: `real-schedule-${suffix}`,
            runId: `real-run-${suffix}`,
            attempt: 1,
            startedAt: at,
            updatedAt: at,
          },
        ],
      }),
    )
  }, { suffix: cycle, queuedSchedule })
  await page.evaluate(async ({ suffix, queuedSchedule }) => {
    const at = new Date().toISOString()
    const result = await window.subagents?.scheduler?.saveAll?.([
      {
        id: `real-schedule-${suffix}`,
        name: 'Recovery once job',
        objective: 'must settle interrupted after restart',
        loopType: 'Goal-based',
        enabled: false,
        kind: 'once',
        runAt: new Date(Date.now() + 86_400_000).toISOString(),
        lastRunAt: at,
        nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
        lastStatus: 'running',
        createdAt: at,
      },
    ])
    if (!result?.ok) throw new Error('scheduler persistence bridge did not accept the recovery fixture')
    const settings = JSON.parse(localStorage.getItem('subagents.settings.v1') || '{}')
    settings.subAgentsEnabled = false
    localStorage.setItem('subagents.settings.v1', JSON.stringify(settings))
    if (queuedSchedule) {
      const savedJobs = (await window.subagents?.scheduler?.list?.()) || []
      const triggerAt = savedJobs.find((job) => job.id === `real-schedule-${suffix}`)?.lastRunAt
      if (!triggerAt) throw new Error('scheduler fixture did not persist a claimed trigger')
      const at = new Date().toISOString()
      localStorage.setItem(
        'subagents.runQueue.v1',
        JSON.stringify({
          v: 1,
          items: [{
            id: `real-queue-${suffix}`,
            enqueuedAt: at,
            dedupeKey: `runId:real-run-${suffix}`,
            runId: `real-run-${suffix}`,
            sourceKind: 'schedule',
            objective: 'queued schedule recovery smoke',
            title: 'Queued schedule recovery',
            loopType: 'Time-based',
            scheduleJobId: `real-schedule-${suffix}`,
            scheduleTriggeredAt: triggerAt,
            scheduleKind: 'once',
          }],
          savedAt: at,
        }),
      )
    }
  }, { suffix: cycle, queuedSchedule })
}

async function terminate(app, rendererFirst) {
  if (rendererFirst) {
    const page = await app.firstWindow()
    await page.close({ runBeforeUnload: true }).catch(() => {})
  }
  const process = app.process()
  if (process && !process.killed) process.kill()
  await wait(1_000)
}

async function runCycle(mode, queuedSchedule = false) {
  const userDataDir = path.join(root, mode)
  fs.rmSync(userDataDir, { recursive: true, force: true })
  const first = await launch(userDataDir)
  try {
    await seedInterruptedState(await first.firstWindow(), mode, queuedSchedule)
    await terminate(first, mode === 'renderer')
  } finally {
    await first.close().catch(() => {})
  }

  const restarted = await launch(userDataDir)
  try {
    const page = await restarted.firstWindow()
    await page.waitForSelector('textarea', { timeout: 120_000 })
    await page.waitForFunction(
      () => document.body.innerText.includes('啟動復原報告'),
      undefined,
      { timeout: 30_000 },
    )
    const evidence = await page.evaluate(async (suffix) => {
      const journal = JSON.parse(localStorage.getItem('subagents.runJournal.v1') || '{}')
      const threadState = JSON.parse(localStorage.getItem('subagents.threads.v5') || '{}')
      const jobs = (await window.subagents?.scheduler?.list?.()) || []
      const entries = (journal.entries || []).filter((entry) => entry.id.endsWith(`-${suffix}`))
      return {
        threadInterrupted: (threadState.threads || []).some((thread) => thread.lastStatus === 'interrupted'),
        journalStatuses: entries.map((entry) => entry.status),
        scheduleStatus: jobs.find((job) => job.id === `real-schedule-${suffix}`)?.lastStatus,
        queueStillEmpty: (() => {
          try {
            const queue = JSON.parse(localStorage.getItem('subagents.runQueue.v1') || '{"items":[]}')
            return Array.isArray(queue.items) && queue.items.length === 0
          } catch {
            return false
          }
        })(),
        body: document.body.innerText.slice(-1200),
      }
    }, mode)
    if (!queuedSchedule) {
      assert.equal(evidence.threadInterrupted, true, `${mode}: running thread was not reconciled`)
      assert.deepEqual(evidence.journalStatuses, ['interrupted', 'interrupted', 'interrupted'])
      assert.equal(evidence.scheduleStatus, 'interrupted', `${mode}: once job was not reconciled`)
    } else {
      assert.equal(evidence.journalStatuses.includes('queued'), true, `${mode}: queued marker was not preserved`)
      assert.equal(evidence.scheduleStatus, 'running', `${mode}: queued schedule was not safely rebound`)
      assert.equal(evidence.queueStillEmpty, false, `${mode}: queued work was silently dropped`)
      assert.match(evidence.body, /resume-once · schedule/)
    }
    if (!queuedSchedule) {
      assert.equal(evidence.queueStillEmpty, true, `${mode}: uncertain queue work was replayed`)
    }
    return evidence
  } finally {
    await restarted.close().catch(() => {})
  }
}

try {
  const requested = process.env.RECOVERY_CYCLE
  const renderer = requested && requested !== 'renderer' ? null : await runCycle('renderer')
  const main = requested && requested !== 'main' ? null : await runCycle('main')
  const queuedSchedule = requested && requested !== 'queued-schedule'
    ? null
    : await runCycle('queued-schedule', true)
  console.log('Recovery E2E: renderer/main termination, queue drain interruption, queued schedule resume, and once-job settlement passed')
  console.log(JSON.stringify({ renderer, main, queuedSchedule }))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
