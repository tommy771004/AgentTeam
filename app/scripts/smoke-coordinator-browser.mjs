/**
 * Browser-level smoke for the real taskRunCoordinator seam.
 *
 * This deliberately runs through Vite so extensionless renderer imports and
 * browser stores behave like the product. The pure scenario smoke remains a
 * fast contract suite; this covers the real coordinator/runner graph.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 4176
const url = `http://127.0.0.1:${port}/`

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForVite() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await delay(100)
  }
  throw new Error(`Vite did not start at ${url}`)
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: appRoot, stdio: 'ignore' },
)

try {
  await waitForVite()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    const result = await page.evaluate(async () => {
      const { runTask } = await import('/src/agent/taskRunCoordinator.ts')
      const { useAgentStore } = await import('/src/store/agentStore.ts')
      const { useSettingsStore } = await import('/src/store/settingsStore.ts')
      const { useThreadStore } = await import('/src/store/threadStore.ts')
      const initialSettings = useSettingsStore.getState().settings

      let builtInSettled = 0
      const builtIn = await runTask({
        objective: 'browser built-in coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-built-in-smoke',
        attachments: [
          {
            id: 'browser-note',
            kind: 'text',
            name: 'browser-note.txt',
            mimeType: 'text/plain',
            textContent: 'coordinator attachment smoke',
          },
        ],
        onSettled: () => {
          builtInSettled += 1
        },
      })

      const first = runTask({
        objective: 'browser duplicate coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-duplicate-smoke',
      })
      const duplicate = await runTask({
        objective: 'browser duplicate coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-duplicate-smoke',
      })
      await first

      let cancelRequested = false
      const cancelPromise = runTask({
        objective: 'browser cancel coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-cancel-smoke',
      })
      for (let i = 0; i < 100; i += 1) {
        const state = useAgentStore.getState().getRunState('browser-cancel-smoke')
        if (state?.status === 'running') {
          cancelRequested = true
          useAgentStore.getState().stopExecution('browser-cancel-smoke')
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const cancelled = await cancelPromise

      let queuedSettledResult
      let resolveQueuedSettled
      const queuedSettled = new Promise((resolve) => {
        resolveQueuedSettled = resolve
      })
      const queuedFirst = runTask({
        objective: 'browser queue first',
        sourceKind: 'composer',
        runId: 'browser-queue-first',
      })
      const queued = await runTask({
        objective: 'browser queue second',
        sourceKind: 'schedule',
        runId: 'browser-queue-second',
        loopType: 'Goal-based',
        onSettled: (value) => {
          queuedSettledResult = value
          resolveQueuedSettled(value)
        },
      })
      await queuedFirst
      await Promise.race([queuedSettled, new Promise((resolve) => setTimeout(resolve, 3000))])

      useSettingsStore.setState({
        settings: {
          ...initialSettings,
          hookRules: [
            {
              id: 'browser-deny',
              point: 'beforeRun',
              action: 'deny',
              reason: 'browser smoke denial',
              source: 'user',
            },
          ],
        },
      })
      let deniedSettled = 0
      const denied = await runTask({
        objective: 'browser denied coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-denied-smoke',
        onSettled: () => {
          deniedSettled += 1
        },
      })
      useSettingsStore.setState({ settings: initialSettings })

      let cliSettled = 0
      const cli = await runTask({
        objective: 'browser CLI coordinator smoke',
        sourceKind: 'composer',
        runner: 'codex',
        runId: 'browser-cli-smoke',
        onSettled: () => {
          cliSettled += 1
        },
      })

      useSettingsStore.setState({
        settings: { ...initialSettings, subAgentsEnabled: true },
      })
      const delegate = await runTask({
        objective: 'browser delegate coordinator smoke',
        sourceKind: 'delegate',
        workerThread: true,
        runId: 'browser-delegate-smoke',
      })
      const delegateThread = delegate.threadId
        ? useThreadStore.getState().threads.find((thread) => thread.id === delegate.threadId)
        : undefined

      const archive = useAgentStore
        .getState()
        .archive.filter((record) => record.id === 'browser-denied-smoke')
      return {
        builtIn: {
          status: builtIn.status,
          runId: builtIn.runId,
          settled: builtInSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-built-in-smoke').length,
        },
        duplicate: { status: duplicate.status, skipReason: duplicate.skipReason },
        cancelled: { requested: cancelRequested, status: cancelled.status },
        queue: {
          status: queued.status,
          queued: queued.queued,
          skipReason: queued.skipReason,
          settledStatus: queuedSettledResult?.status,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-queue-second').length,
        },
        denied: {
          status: denied.status,
          error: denied.error,
          settled: deniedSettled,
          archiveCount: archive.length,
          archiveStatus: archive[0]?.status,
          archiveObjective: archive[0]?.objective,
        },
        cli: { status: cli.status, settled: cliSettled },
        delegate: {
          status: delegate.status,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-delegate-smoke').length,
          hidden: delegateThread?.hidden === true,
        },
      }
    })

    assert.equal(result.builtIn.status, 'success')
    assert.equal(result.builtIn.settled, 1)
    assert.equal(result.builtIn.archiveCount, 1)
    assert.equal(result.duplicate.status, 'skipped')
    assert.equal(result.duplicate.skipReason, 'duplicate')
    assert.equal(result.cancelled.requested, true)
    assert.ok(['halted', 'failed'].includes(result.cancelled.status))
    assert.equal(result.queue.queued, true)
    assert.equal(result.queue.skipReason, 'queued')
    assert.ok(['success', 'failed', 'halted'].includes(result.queue.settledStatus))
    assert.equal(result.queue.archiveCount, 1)
    assert.equal(result.denied.status, 'failed')
    assert.match(result.denied.error, /hook 政策拒絕/)
    assert.equal(result.denied.settled, 1)
    assert.equal(result.denied.archiveCount, 1)
    assert.equal(result.denied.archiveStatus, 'failed')
    assert.equal(result.denied.archiveObjective, 'browser denied coordinator smoke')
    assert.equal(result.cli.status, 'failed')
    assert.equal(result.cli.settled, 1)
    assert.equal(result.delegate.status, 'success')
    assert.equal(result.delegate.archiveCount, 1)
    assert.equal(result.delegate.hidden, true)
    console.log('Coordinator browser smoke: success, duplicate, queue, denial, CLI, and Archive ordering passed')
  } finally {
    await browser.close()
  }
} finally {
  server.kill('SIGTERM')
}
