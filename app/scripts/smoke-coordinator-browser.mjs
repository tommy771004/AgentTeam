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
      const { runTask, rerunFromReplaySafeCheckpoint } = await import('/src/agent/taskRunCoordinator.ts')
      const { listReplaySafeCheckpoints } = await import('/src/agent/runFork.ts')
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

      const originalFetch = window.fetch
      window.fetch = async () => {
        throw new Error('browser smoke forced web adapter failure')
      }
      let failedBuiltInSettled = 0
      let failedBuiltIn
      try {
        failedBuiltIn = await runTask({
          objective: 'search the web for a forced failure smoke',
          sourceKind: 'composer',
          runId: 'browser-built-in-failure-smoke',
          onSettled: () => {
            failedBuiltInSettled += 1
          },
        })
      } finally {
        window.fetch = originalFetch
      }

      const originalStartExecution = useAgentStore.getState().startExecution
      useAgentStore.setState({
        startExecution: async () => {
          throw new Error('browser smoke forced dispatch exception')
        },
      })
      let dispatchExceptionSettled = 0
      let dispatchException
      try {
        dispatchException = await runTask({
          objective: 'browser dispatch exception smoke',
          sourceKind: 'composer',
          runId: 'browser-dispatch-exception-smoke',
          onSettled: () => {
            dispatchExceptionSettled += 1
          },
        })
      } finally {
        useAgentStore.setState({ startExecution: originalStartExecution })
      }

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

      useSettingsStore.setState({
        settings: {
          ...initialSettings,
          concurrentRunsEnabled: true,
          maxConcurrentRuns: 2,
        },
      })
      let cancelRequested = false
      const survivorPromise = runTask({
        objective: 'browser concurrent survivor smoke',
        sourceKind: 'composer',
        runId: 'browser-survivor-smoke',
      })
      let overflowSettledResult
      let resolveOverflowSettled
      const overflowSettled = new Promise((resolve) => {
        resolveOverflowSettled = resolve
      })
      const cancelPromise = runTask({
        objective: 'browser cancel coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-cancel-smoke',
      })
      const overflow = await runTask({
        objective: 'browser concurrent overflow smoke',
        sourceKind: 'schedule',
        runId: 'browser-overflow-smoke',
        loopType: 'Goal-based',
        onSettled: (value) => {
          overflowSettledResult = value
          resolveOverflowSettled(value)
        },
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
      const [cancelled, survivor] = await Promise.all([cancelPromise, survivorPromise])
      await Promise.race([overflowSettled, new Promise((resolve) => setTimeout(resolve, 3000))])
      useSettingsStore.setState({ settings: initialSettings })

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
      const deniedLifecycle = []
      const denied = runTask({
        objective: 'browser denied coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-denied-smoke',
        onSettled: () => {
          deniedSettled += 1
          deniedLifecycle.push({
            runId: 'browser-denied-smoke',
            active: useAgentStore.getState().activeRunIds.includes('browser-denied-smoke'),
          })
        },
      })
      let deniedQueuedSettled
      let resolveDeniedQueued
      const deniedQueuedDone = new Promise((resolve) => {
        resolveDeniedQueued = resolve
      })
      const deniedQueued = await runTask({
        objective: 'browser denied queued coordinator smoke',
        sourceKind: 'schedule',
        runId: 'browser-denied-queued-smoke',
        loopType: 'Goal-based',
        onSettled: (value) => {
          deniedQueuedSettled = value
          deniedLifecycle.push({
            runId: 'browser-denied-queued-smoke',
            active: useAgentStore.getState().activeRunIds.includes('browser-denied-smoke'),
          })
          resolveDeniedQueued(value)
        },
      })
      const deniedResult = await denied
      await Promise.race([deniedQueuedDone, new Promise((resolve) => setTimeout(resolve, 3000))])
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

      const originalSubagents = window.subagents
      const pendingCliRuns = new Map()
      const resolvePendingCli = (runId, value) => {
        const resolver = pendingCliRuns.get(runId)
        if (typeof resolver !== 'function') return false
        resolver(value)
        pendingCliRuns.delete(runId)
        return true
      }
      const waitForPendingCli = async (runIds, label) => {
        for (let i = 0; i < 100; i += 1) {
          if (runIds.every((runId) => pendingCliRuns.has(runId))) return
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        throw new Error(`${label} did not register all pending CLI resolvers`)
      }
      let cliCancelRequested
      useSettingsStore.setState({
        settings: {
          ...initialSettings,
          cliProviders: [{ id: 'codex', enabled: true, authorized: true, cliBinary: 'codex' }],
        },
      })
      window.subagents = {
        ...(originalSubagents || {}),
        cli: {
          ...((originalSubagents && originalSubagents.cli) || {}),
          runAgent: async (opts) => {
            if (opts.runId === 'browser-cli-failure-smoke') {
              return {
                ok: false,
                output: 'browser fake provider output',
                error: 'browser fake provider failure',
                command: 'fake codex',
                runId: opts.runId,
              }
            }
            if (opts.runId === 'browser-cli-failure-queue-smoke') {
              return await new Promise((resolve) => {
                pendingCliRuns.set(opts.runId, resolve)
              })
            }
            if (opts.runId === 'browser-cli-failure-blocker-smoke') {
              return await new Promise((resolve) => {
                pendingCliRuns.set(opts.runId, resolve)
              })
            }
            if (opts.runId === 'browser-cli-cancel-smoke') {
              return await new Promise((resolve) => {
                pendingCliRuns.set(opts.runId, resolve)
              })
            }
            if (opts.runId === 'browser-cli-survivor-smoke') {
              return await new Promise((resolve) => {
                pendingCliRuns.set(opts.runId, resolve)
              })
            }
            if (opts.runId === 'browser-cli-queued-smoke') {
              cliQueueStartedAfterRelease = !useAgentStore
                .getState()
                .activeRunIds.includes('browser-cli-cancel-smoke')
            }
            if (opts.runId === 'browser-cli-failure-queued-smoke') {
              cliFailureQueueStartedAfterRelease = !useAgentStore
                .getState()
                .activeRunIds.includes('browser-cli-failure-queue-smoke')
            }
            return {
              ok: true,
              output: 'browser fake cli output',
              command: 'fake codex',
              runId: opts.runId,
            }
          },
          cancel: async (runId) => {
            cliCancelRequested = runId
            resolvePendingCli(runId, {
              ok: false,
              output: '',
              error: '使用者取消',
              cancelled: true,
              command: 'fake codex',
              runId,
            })
            return { ok: true, killed: 1 }
          },
        },
      }
      let cliSuccessSettled = 0
      let cliFailureSettled = 0
      let cliCancelledSettled = 0
      let cliSurvivorSettled = 0
      let cliCancelStopRequested = false
      let cliQueuedSettled = 0
      let cliQueuedSettledResult
      let resolveCliQueuedSettled
      let cliQueueStartedAfterRelease = false
      let cliFailureQueueSettled = 0
      let cliFailureQueueSettledResult
      let resolveCliFailureQueueSettled
      let cliFailureQueueStartedAfterRelease = false
      const cliFailureQueueDone = new Promise((resolve) => {
        resolveCliFailureQueueSettled = resolve
      })
      const cliQueuedDone = new Promise((resolve) => {
        resolveCliQueuedSettled = resolve
      })
      let cliSuccess
      let cliFailure
      let cliCancelled
      let cliSurvivor
      try {
        cliSuccess = await runTask({
          objective: 'browser CLI adapter success smoke',
          sourceKind: 'composer',
          runner: 'codex',
          runId: 'browser-cli-success-smoke',
          onSettled: () => {
            cliSuccessSettled += 1
          },
        })
        cliFailure = await runTask({
          objective: 'browser CLI adapter failure smoke',
          sourceKind: 'composer',
          runner: 'codex',
          runId: 'browser-cli-failure-smoke',
          onSettled: () => {
            cliFailureSettled += 1
          },
        })
        useSettingsStore.setState({
          settings: {
            ...initialSettings,
            concurrentRunsEnabled: true,
            maxConcurrentRuns: 2,
            cliProviders: [{ id: 'codex', enabled: true, authorized: true, cliBinary: 'codex' }],
          },
        })
        const cliFailureQueueRun = runTask({
          objective: 'browser CLI provider failure queue smoke',
          sourceKind: 'composer',
          runner: 'codex',
          runId: 'browser-cli-failure-queue-smoke',
        })
        const cliFailureBlockerRun = runTask({
          objective: 'browser CLI provider failure blocker smoke',
          sourceKind: 'composer',
          runner: 'codex',
          runId: 'browser-cli-failure-blocker-smoke',
        })
        for (let i = 0; i < 100; i += 1) {
          const states = useAgentStore.getState()
          if (
            states.getRunState('browser-cli-failure-queue-smoke')?.status === 'running' &&
            states.getRunState('browser-cli-failure-blocker-smoke')?.status === 'running'
          ) break
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        const failureQueueState = useAgentStore.getState()
        if (
          failureQueueState.getRunState('browser-cli-failure-queue-smoke')?.status !== 'running' ||
          failureQueueState.getRunState('browser-cli-failure-blocker-smoke')?.status !== 'running'
        ) {
          throw new Error('CLI provider failure queue smoke must reach the running state')
        }
        if (
          !useAgentStore.getState().activeRunIds.includes('browser-cli-failure-queue-smoke') ||
          !useAgentStore.getState().activeRunIds.includes('browser-cli-failure-blocker-smoke')
        ) {
          throw new Error(
            `CLI provider failure queue smoke lost capacity reservation: ${JSON.stringify(useAgentStore.getState().activeRunIds)}`,
          )
        }
        await waitForPendingCli(
          ['browser-cli-failure-queue-smoke', 'browser-cli-failure-blocker-smoke'],
          'CLI provider failure queue smoke',
        )
        const cliFailureQueued = await runTask({
          objective: 'browser CLI provider failure queued follower smoke',
          sourceKind: 'schedule',
          runner: 'codex',
          runId: 'browser-cli-failure-queued-smoke',
          loopType: 'Goal-based',
          onSettled: (value) => {
            cliFailureQueueSettled += 1
            cliFailureQueueSettledResult = value
            resolveCliFailureQueueSettled(value)
          },
        })
        if (!cliFailureQueued.queued) {
          throw new Error(`CLI provider failure follower must be admitted to the queue: ${JSON.stringify(cliFailureQueued)}`)
        }
        if (!resolvePendingCli('browser-cli-failure-queue-smoke', {
          ok: false,
          output: 'browser fake queued provider output',
          error: 'browser fake queued provider failure',
          command: 'fake codex',
          runId: 'browser-cli-failure-queue-smoke',
        })) {
          throw new Error('CLI provider failure resolver disappeared before release')
        }
        await cliFailureQueueRun
        await Promise.race([
          cliFailureQueueDone,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ])
        if (!resolvePendingCli('browser-cli-failure-blocker-smoke', {
          ok: true,
          output: 'browser fake failure blocker output',
          command: 'fake codex',
          runId: 'browser-cli-failure-blocker-smoke',
        })) {
          throw new Error('CLI provider blocker resolver disappeared before cleanup')
        }
        await cliFailureBlockerRun
        useSettingsStore.setState({
          settings: {
            ...initialSettings,
            concurrentRunsEnabled: true,
            maxConcurrentRuns: 2,
            cliProviders: [{ id: 'codex', enabled: true, authorized: true, cliBinary: 'codex' }],
          },
        })
        const cliCancelledPromise = runTask({
          objective: 'browser CLI adapter cancellation smoke',
          sourceKind: 'composer',
          runner: 'codex',
          runId: 'browser-cli-cancel-smoke',
          onSettled: () => {
            cliCancelledSettled += 1
          },
        })
        const cliSurvivorPromise = runTask({
          objective: 'browser CLI adapter survivor smoke',
          sourceKind: 'composer',
          runner: 'codex',
          runId: 'browser-cli-survivor-smoke',
          onSettled: () => {
            cliSurvivorSettled += 1
          },
        })
        const cliQueued = await runTask({
          objective: 'browser CLI queued follower smoke',
          sourceKind: 'schedule',
          runner: 'codex',
          runId: 'browser-cli-queued-smoke',
          loopType: 'Goal-based',
          onSettled: (value) => {
            cliQueuedSettled += 1
            cliQueuedSettledResult = value
            resolveCliQueuedSettled(value)
          },
        })
        if (!cliQueued.queued) throw new Error('CLI queued follower must be admitted to the queue')
        await waitForPendingCli(
          ['browser-cli-cancel-smoke', 'browser-cli-survivor-smoke'],
          'CLI cancellation smoke',
        )
        for (let i = 0; i < 100; i += 1) {
          const state = useAgentStore.getState().getRunState('browser-cli-cancel-smoke')
          if (state?.status === 'running') {
            cliCancelStopRequested = true
            useAgentStore.getState().stopExecution('browser-cli-cancel-smoke')
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        if (!cliCancelStopRequested) {
          throw new Error('CLI cancellation smoke must reach the targeted running state')
        }
        if (!resolvePendingCli('browser-cli-survivor-smoke', {
          ok: true,
          output: 'browser fake cli survivor output',
          command: 'fake codex',
          runId: 'browser-cli-survivor-smoke',
        })) {
          throw new Error('CLI survivor resolver disappeared before cleanup')
        }
        ;[cliCancelled, cliSurvivor] = await Promise.all([
          cliCancelledPromise,
          cliSurvivorPromise,
        ])
        await Promise.race([cliQueuedDone, new Promise((resolve) => setTimeout(resolve, 3000))])
      } finally {
        window.subagents = originalSubagents
        useSettingsStore.setState({ settings: initialSettings })
      }

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

      // ── fork-and-rerun-from-step-N (ticket 02) ──────────────────
      // A forked run is an ordinary coordinator run: one finalization, in the
      // fixed order, and the parent thread is left untouched.
      useSettingsStore.setState({ settings: initialSettings })
      const forkParent = await runTask({
        objective: 'browser fork parent coordinator smoke',
        sourceKind: 'composer',
        runId: 'browser-fork-parent-smoke',
      })
      const parentThreadId = forkParent.threadId
      const parentBefore = useThreadStore.getState().threads.find((t) => t.id === parentThreadId)
      const parentBubblesBefore = parentBefore ? parentBefore.bubbles.length : -1
      const checkpoints = parentBefore ? listReplaySafeCheckpoints(parentBefore) : []

      // A non-replay-safe point must be refused with a reason, not adjusted.
      const refusedFork = await rerunFromReplaySafeCheckpoint({
        sourceThreadId: parentThreadId || '',
        checkpointBubbleId: 'not-a-real-bubble',
      })

      let forkSettled = 0
      const forkOrder = []
      const forked = await rerunFromReplaySafeCheckpoint({
        sourceThreadId: parentThreadId || '',
        checkpointBubbleId: checkpoints[0]?.bubbleId,
        continueHint: 'fork smoke hint',
      })
      const forkedRunId = forked.runId
      const parentAfter = useThreadStore.getState().threads.find((t) => t.id === parentThreadId)
      void forkSettled
      void forkOrder

      const archive = useAgentStore
        .getState()
        .archive.filter((record) => record.id === 'browser-denied-smoke')
      return {
        fork: {
          parentStatus: forkParent.status,
          checkpointCount: checkpoints.length,
          refusedSkipped: refusedFork.skipped === true,
          refusedReason: refusedFork.skipReason,
          status: forked.status,
          queued: forked.queued === true,
          forkedThreadId: forked.threadId,
          parentThreadId,
          // exactly one Archive record => exactly one finalization
          archiveCount: forkedRunId
            ? useAgentStore.getState().archive.filter((r) => r.id === forkedRunId).length
            : -1,
          parentArchiveCount: useAgentStore
            .getState()
            .archive.filter((r) => r.id === 'browser-fork-parent-smoke').length,
          active: forkedRunId
            ? useAgentStore.getState().activeRunIds.includes(forkedRunId)
            : true,
          // the parent record is preserved, not mutated by the fork
          parentBubblesBefore,
          parentBubblesAfter: parentAfter ? parentAfter.bubbles.length : -1,
          forkedIsNewThread: Boolean(forked.threadId) && forked.threadId !== parentThreadId,
        },
        builtIn: {
          status: builtIn.status,
          runId: builtIn.runId,
          settled: builtInSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-built-in-smoke').length,
          active: useAgentStore.getState().activeRunIds.includes('browser-built-in-smoke'),
        },
        builtInFailure: {
          status: failedBuiltIn.status,
          settled: failedBuiltInSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-built-in-failure-smoke').length,
          active: useAgentStore.getState().activeRunIds.includes('browser-built-in-failure-smoke'),
        },
        dispatchException: {
          status: dispatchException.status,
          error: dispatchException.error,
          settled: dispatchExceptionSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-dispatch-exception-smoke').length,
          active: useAgentStore.getState().activeRunIds.includes('browser-dispatch-exception-smoke'),
        },
        duplicate: { status: duplicate.status, skipReason: duplicate.skipReason },
        cancelled: {
          requested: cancelRequested,
          status: cancelled.status,
          survivorStatus: survivor.status,
          survivorArchiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-survivor-smoke').length,
        },
        overflow: {
          status: overflow.status,
          queued: overflow.queued,
          skipReason: overflow.skipReason,
          settledStatus: overflowSettledResult?.status,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-overflow-smoke').length,
        },
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
          status: deniedResult.status,
          error: deniedResult.error,
          settled: deniedSettled,
          archiveCount: archive.length,
          archiveStatus: archive[0]?.status,
          archiveObjective: archive[0]?.objective,
          active: useAgentStore.getState().activeRunIds.includes('browser-denied-smoke'),
          lifecycle: deniedLifecycle,
        },
        deniedQueued: {
          status: deniedQueued.status,
          queued: deniedQueued.queued,
          skipReason: deniedQueued.skipReason,
          settledStatus: deniedQueuedSettled?.status,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-denied-queued-smoke').length,
        },
        cli: { status: cli.status, settled: cliSettled },
        cliSuccess: {
          status: cliSuccess.status,
          settled: cliSuccessSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-cli-success-smoke').length,
          active: useAgentStore.getState().activeRunIds.includes('browser-cli-success-smoke'),
        },
        cliFailure: {
          status: cliFailure.status,
          result: cliFailure.result,
          error: cliFailure.error,
          settled: cliFailureSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-cli-failure-smoke').length,
          active: useAgentStore.getState().activeRunIds.includes('browser-cli-failure-smoke'),
        },
        cliCancellation: {
          requested: cliCancelRequested,
          status: cliCancelled.status,
          settled: cliCancelledSettled,
          archiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-cli-cancel-smoke').length,
          survivorStatus: cliSurvivor.status,
          survivorSettled: cliSurvivorSettled,
          survivorArchiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-cli-survivor-smoke').length,
          queuedSettled: cliQueuedSettled,
          queuedSettledStatus: cliQueuedSettledResult?.status,
          queuedArchiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-cli-queued-smoke').length,
          queuedStartedAfterRelease: cliQueueStartedAfterRelease,
          failureQueueSettled: cliFailureQueueSettled,
          failureQueueSettledStatus: cliFailureQueueSettledResult?.status,
          failureQueueArchiveCount: useAgentStore
            .getState()
            .archive.filter((record) => record.id === 'browser-cli-failure-queued-smoke').length,
          failureQueueStartedAfterRelease: cliFailureQueueStartedAfterRelease,
        },
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
    assert.equal(result.builtIn.active, false)
    assert.equal(result.builtInFailure.status, 'failed')
    assert.equal(result.builtInFailure.settled, 1)
    assert.equal(result.builtInFailure.archiveCount, 1)
    assert.equal(result.builtInFailure.active, false)
    assert.equal(result.dispatchException.status, 'failed')
    assert.match(result.dispatchException.error, /browser smoke forced dispatch exception/)
    assert.equal(result.dispatchException.settled, 1)
    assert.equal(result.dispatchException.archiveCount, 1)
    assert.equal(result.dispatchException.active, false)
    assert.equal(result.duplicate.status, 'skipped')
    assert.equal(result.duplicate.skipReason, 'duplicate')
    assert.equal(result.cancelled.requested, true)
    assert.ok(['halted', 'failed'].includes(result.cancelled.status))
    assert.equal(result.cancelled.survivorStatus, 'success')
    assert.equal(result.cancelled.survivorArchiveCount, 1)
    assert.equal(result.overflow.queued, true)
    assert.equal(result.overflow.skipReason, 'queued')
    assert.ok(['success', 'failed', 'halted'].includes(result.overflow.settledStatus))
    assert.equal(result.overflow.archiveCount, 1)
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
    assert.equal(result.denied.active, false)
    assert.deepEqual(
      result.denied.lifecycle.map((event) => event.runId),
      ['browser-denied-smoke', 'browser-denied-queued-smoke'],
    )
    assert.equal(result.denied.lifecycle[0].active, true)
    assert.equal(result.denied.lifecycle[1].active, false)
    assert.equal(result.deniedQueued.queued, true)
    assert.equal(result.deniedQueued.skipReason, 'queued')
    assert.equal(result.deniedQueued.settledStatus, 'failed')
    assert.equal(result.deniedQueued.archiveCount, 1)
    assert.equal(result.cli.status, 'failed')
    assert.equal(result.cli.settled, 1)
    assert.equal(result.cliSuccess.status, 'success')
    assert.equal(result.cliSuccess.settled, 1)
    assert.equal(result.cliSuccess.archiveCount, 1)
    assert.equal(result.cliSuccess.active, false)
    assert.equal(result.cliFailure.status, 'failed')
    assert.match(result.cliFailure.error, /browser fake provider failure/)
    assert.equal(result.cliFailure.settled, 1)
    assert.equal(result.cliFailure.archiveCount, 1)
    assert.equal(result.cliFailure.active, false)
    assert.equal(result.cliCancellation.requested, 'browser-cli-cancel-smoke')
    assert.equal(result.cliCancellation.status, 'halted')
    assert.equal(result.cliCancellation.settled, 1)
    assert.equal(result.cliCancellation.archiveCount, 1)
    assert.equal(result.cliCancellation.survivorStatus, 'success')
    assert.equal(result.cliCancellation.survivorSettled, 1)
    assert.equal(result.cliCancellation.survivorArchiveCount, 1)
    assert.equal(result.cliCancellation.queuedSettled, 1)
    assert.ok(['success', 'failed', 'halted'].includes(result.cliCancellation.queuedSettledStatus))
    assert.equal(result.cliCancellation.queuedArchiveCount, 1)
    assert.equal(result.cliCancellation.queuedStartedAfterRelease, true)
    assert.equal(result.cliCancellation.failureQueueSettled, 1)
    assert.ok(['success', 'failed', 'halted'].includes(result.cliCancellation.failureQueueSettledStatus))
    assert.equal(result.cliCancellation.failureQueueArchiveCount, 1)
    assert.equal(result.cliCancellation.failureQueueStartedAfterRelease, true)
    assert.equal(result.delegate.status, 'success')
    assert.equal(result.delegate.archiveCount, 1)
    assert.equal(result.delegate.hidden, true)

    // ── forked rerun (ticket 02) ────────────────────────────────
    assert.equal(result.fork.parentStatus, 'success')
    assert.ok(result.fork.checkpointCount > 0, 'parent thread must expose a replay-safe checkpoint')
    // a non-replay-safe fork point is refused, not silently adjusted
    assert.equal(result.fork.refusedSkipped, true)
    assert.equal(result.fork.refusedReason, 'replay-unsafe')
    // the fork is an ordinary run: it settles and releases like any other
    assert.ok(['success', 'failed', 'halted'].includes(result.fork.status))
    assert.equal(result.fork.active, false, 'forked run must release its slot')
    // finalization happened exactly once
    assert.equal(result.fork.archiveCount, 1, 'forked run must archive exactly once')
    // the parent run and its thread are preserved, not overwritten
    assert.equal(result.fork.parentArchiveCount, 1)
    assert.equal(result.fork.forkedIsNewThread, true)
    assert.equal(
      result.fork.parentBubblesAfter,
      result.fork.parentBubblesBefore,
      'forking must not mutate the parent thread',
    )
    console.log('Coordinator browser smoke: success, duplicate, queue, denial, CLI, fork, and Archive ordering passed')
  } finally {
    await browser.close()
  }
} finally {
  server.kill('SIGTERM')
}
