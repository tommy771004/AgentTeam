/**
 * Run-completion reachability smoke (.scratch/run-completion-reachability).
 *
 * Covers the shipped modules for:
 *   01 — iteration-exhausted terminal vocabulary reaching every surface
 *   02 — shell completion notice: trigger / suppression / stacking
 *   03 — journal delivery state (delivered vs pending-delivery)
 *   04 — startup redelivery: exactly once, right thread, honest wording
 *
 * Run: node --experimental-strip-types scripts/smoke-run-completion-reachability.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
Object.defineProperty(globalThis, 'window', { value: { subagents: {} }, configurable: true })

const {
  claimPendingRunDeliveries,
  classifyRunDelivery,
  getJournalEntry,
  listJournalEntries,
  markRunDelivered,
  recordRunAdmitted,
  recordRunStarted,
  recordRunTerminal,
  reconcileStartup,
  resetRunJournalForTests,
} = await import('../src/agent/runJournal.ts')
const {
  decideRunCompletionNotice,
  runCompletionCopy,
  stackCompletionToasts,
  MAX_VISIBLE_COMPLETION_TOASTS,
} = await import('../src/lib/runCompletionNotice.ts')
const { narratePendingDelivery, redeliveryOutcomeLine } = await import('../src/agent/runRedelivery.ts')
const { iterationExhaustedLabel } = await import('../src/agent/runLifecycle.ts')

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8')

// ── 02 · completion notice: what fires, and what stays quiet ────────────────
{
  const event = {
    runId: 'run_a',
    threadId: 'thread_a',
    objective: '整理季度報告',
    status: 'success' as const,
    finishedAt: 1_000,
  }

  const away = decideRunCompletionNotice(event, {
    activeThreadId: 'thread_b',
    visibleRunId: null,
    osNotifyEnabled: true,
  })
  assert.equal(away.toast, true, 'a run finishing while the user is elsewhere must raise a toast')
  assert.equal(away.osNotify, true, 'OS notify follows the setting')
  assert.equal(away.title, '任務完成')
  assert.equal(away.threadId, 'thread_a', 'the notice must carry the thread it routes to')

  const inThread = decideRunCompletionNotice(event, {
    activeThreadId: 'thread_a',
    visibleRunId: null,
    osNotifyEnabled: true,
  })
  assert.equal(inThread.toast, false, 'sitting in the owning thread must not raise a duplicate toast')
  assert.equal(inThread.osNotify, true, 'suppressing the toast must not suppress the OS notification')

  const watchingFeed = decideRunCompletionNotice(event, {
    activeThreadId: 'thread_b',
    visibleRunId: 'run_a',
    osNotifyEnabled: true,
  })
  assert.equal(watchingFeed.toast, false, 'watching this run’s feed must not raise a toast')

  const otherPage = decideRunCompletionNotice(event, {
    activeThreadId: 'thread_a',
    visibleRunId: 'run_a',
    chatSurfaceVisible: false,
    osNotifyEnabled: true,
  })
  assert.equal(otherPage.toast, true, 'off the conversation surface nothing is on screen to suppress')

  const muted = decideRunCompletionNotice(event, { activeThreadId: 'thread_b', osNotifyEnabled: false })
  assert.equal(muted.osNotify, false, 'the setting must be able to silence the OS notification')
  assert.equal(muted.toast, true, 'silencing OS notifications must leave the in-app toast alone')

  const unbound = decideRunCompletionNotice({ ...event, threadId: undefined }, { activeThreadId: null })
  assert.equal(unbound.toast, true, 'a run with no owning thread still announces itself')
}

// ── 02 · failure and truncation are visually distinct from success ──────────
{
  assert.equal(runCompletionCopy({ runId: 'r', status: 'failed', finishedAt: 1 }).tone, 'danger')
  assert.equal(runCompletionCopy({ runId: 'r', status: 'halted', finishedAt: 1 }).title, '任務已中止')
  const truncated = runCompletionCopy({
    runId: 'r',
    status: 'success',
    finishedAt: 1,
    orchestration: { iterations: 4, maxIterations: 4, dodMet: false, executionKind: 'loop' },
  })
  assert.equal(truncated.title, iterationExhaustedLabel(4), 'the toast reuses the shared exhausted wording')
  assert.equal(truncated.tone, 'attention')
  assert.notEqual(truncated.icon, 'check_circle')
  const external = runCompletionCopy({
    runId: 'r',
    status: 'success',
    finishedAt: 1,
    orchestration: { iterations: 4, maxIterations: 4, dodMet: false, executionKind: 'external' },
  })
  assert.equal(external.title, '外部 CLI 已結束', 'an external CLI run never claims or fails a DoD')
}

// ── 02 · stacking: three cards, then one counted row ────────────────────────
{
  const notices = Array.from({ length: 5 }, (_, index) =>
    decideRunCompletionNotice(
      { runId: `run_${index}`, threadId: `thread_${index}`, status: 'success', finishedAt: index },
      { activeThreadId: null },
    ),
  )
  const stacked = stackCompletionToasts(notices)
  assert.equal(stacked.visible.length, MAX_VISIBLE_COMPLETION_TOASTS, 'at most three toasts stay visible')
  assert.equal(stacked.visible[0].runId, 'run_4', 'the newest completion is on top')
  assert.equal(stacked.overflow, 2)
  assert.match(stacked.overflowLabel, /2 個任務/, 'the overflow row must count what it hides')
  assert.equal(stackCompletionToasts(notices.slice(0, 2)).overflow, 0, 'a short stack has no overflow row')
  assert.equal(stackCompletionToasts([]).visible.length, 0)
}

// ── 03 · one rule decides whether an outcome reached the user ───────────────
{
  assert.equal(
    classifyRunDelivery({ hasOwningThread: true, resultWrittenToThread: true, rendererPresent: true }),
    'delivered',
  )
  for (const facts of [
    { hasOwningThread: false, resultWrittenToThread: true, rendererPresent: true },
    { hasOwningThread: true, resultWrittenToThread: false, rendererPresent: true },
    { hasOwningThread: true, resultWrittenToThread: true, rendererPresent: false },
  ]) {
    assert.equal(classifyRunDelivery(facts), 'pending-delivery', 'any missing fact means nobody was told')
  }
}

// ── 03 · the terminal marker records delivery in the same write ─────────────
{
  resetRunJournalForTests()
  recordRunAdmitted({ runId: 'run_seen', objective: '看得到的任務', sourceKind: 'composer' })
  recordRunStarted({ runId: 'run_seen', threadId: 'thread_seen' })
  recordRunTerminal({
    runId: 'run_seen',
    threadId: 'thread_seen',
    status: 'success',
    delivery: { hasOwningThread: true, resultWrittenToThread: true, rendererPresent: true },
    settlement: { executionKind: 'loop', iterations: 2, maxIterations: 5, dodMet: true },
  })
  const seen = getJournalEntry('run', 'run_seen')
  assert.equal(seen?.delivery, 'delivered')
  assert.equal(seen?.status, 'success')
  assert.equal(seen?.iterations, 2)
  assert.equal(seen?.maxIterations, 5)
  assert.equal(seen?.dodMet, true)

  recordRunAdmitted({ runId: 'run_missed', objective: '你不在時跑完的任務', sourceKind: 'schedule' })
  recordRunStarted({ runId: 'run_missed', threadId: 'thread_missed' })
  recordRunTerminal({
    runId: 'run_missed',
    threadId: 'thread_missed',
    status: 'success',
    delivery: { hasOwningThread: true, resultWrittenToThread: true, rendererPresent: false },
    settlement: { executionKind: 'loop', iterations: 5, maxIterations: 5, dodMet: false },
  })
  assert.equal(getJournalEntry('run', 'run_missed')?.delivery, 'pending-delivery')

  // External runs carry their kind but never a DoD verdict.
  recordRunTerminal({
    runId: 'run_cli',
    threadId: 'thread_cli',
    status: 'success',
    delivery: { hasOwningThread: true, resultWrittenToThread: true, rendererPresent: false },
    settlement: { executionKind: 'external', iterations: 3, maxIterations: 3, dodMet: false },
  })
  const cli = getJournalEntry('run', 'run_cli')
  assert.equal(cli?.executionKind, 'external')
  assert.equal(cli?.dodMet, undefined, 'an external CLI entry must not carry a DoD verdict')

  // Existing behaviour is untouched: nothing in flight, nothing to reconcile.
  assert.equal(reconcileStartup(), null, 'terminal entries must not be reported as interrupted')

  // A live notice settles the pending entry so it is not replayed as news.
  markRunDelivered('run_missed')
  assert.equal(getJournalEntry('run', 'run_missed')?.delivery, 'delivered')
  markRunDelivered('run_seen')
  assert.equal(getJournalEntry('run', 'run_seen')?.delivery, 'delivered', 'marking twice is harmless')
}

// ── 04 · redelivery happens exactly once, in the right thread ───────────────
{
  resetRunJournalForTests()
  const pending = (runId: string, threadId: string | undefined, objective: string, settlement?: {
    executionKind?: 'loop' | 'external'
    iterations?: number
    maxIterations?: number
    dodMet?: boolean
  }, status: string = 'success') => {
    recordRunAdmitted({ runId, objective, sourceKind: 'schedule' })
    recordRunStarted({ runId, threadId })
    recordRunTerminal({
      runId,
      threadId,
      status,
      delivery: { hasOwningThread: Boolean(threadId), resultWrittenToThread: true, rendererPresent: false },
      settlement,
    })
  }

  pending('run_plain', 'thread_live', '整理週報')
  pending('run_truncated', 'thread_live', '重構登入流程', {
    executionKind: 'loop',
    iterations: 5,
    maxIterations: 5,
    dodMet: false,
  })
  pending('run_external', 'thread_live', '跑一次 codex', { executionKind: 'external' })
  pending('run_orphan', 'thread_gone', '找不到家的任務')
  pending('run_failed', 'thread_live', '失敗的任務', undefined, 'failed')

  const liveThreads = new Set(['thread_live'])
  const claimed = claimPendingRunDeliveries()
  assert.equal(claimed.length, 5, 'every undelivered terminal run is claimed')
  const narrations = claimed.map((entry) => narratePendingDelivery(entry, liveThreads.has(entry.threadId || '')))

  const plain = narrations.find((item) => item.runId === 'run_plain')
  assert.equal(plain?.threadId, 'thread_live', 'the message lands in the owning thread')
  assert.match(plain?.message || '', /目標：整理週報/, 'the message carries the objective')
  assert.match(plain?.message || '', /結束時間：/, 'the message carries the finish time')
  assert.match(plain?.message || '', /結果：已完成/, 'the message carries the outcome summary')
  assert.match(plain?.message || '', /未重新驗證/, 'unprovable side effects are never claimed as verified')

  const truncated = narrations.find((item) => item.runId === 'run_truncated')
  assert.match(
    truncated?.message || '',
    new RegExp(iterationExhaustedLabel(5).replace(/[()（）·]/g, '.')),
    'a truncated run redelivers the honest exhausted wording',
  )

  const external = narrations.find((item) => item.runId === 'run_external')
  assert.match(external?.message || '', /不宣稱 DoD/, 'external CLI redelivery must not claim a DoD')
  assert.doesNotMatch(external?.message || '', /未達 DoD/, 'external CLI never fails a DoD either')

  const orphan = narrations.find((item) => item.runId === 'run_orphan')
  assert.equal(orphan?.message, undefined, 'a lost thread gets no in-thread message')
  assert.equal(orphan?.recovery?.action, 'result-unknown', 'a lost thread is reported as unknown')
  assert.doesNotMatch(orphan?.recovery?.detail || '', /完成/, 'an unknown result claims neither success nor failure')

  const failed = narrations.find((item) => item.runId === 'run_failed')
  assert.equal(failed?.message, undefined, 'a failed run is not narrated as a completion')
  assert.equal(failed?.recovery?.action, 'redelivered')
  assert.equal(redeliveryOutcomeLine({ ...claimed[0], status: 'failed' }), '執行失敗')

  // Exactly once: a second startup finds nothing left to narrate.
  assert.deepEqual(claimPendingRunDeliveries(), [], 'a claimed outcome is never redelivered twice')
  const consumed = listJournalEntries().filter((entry) => entry.delivery === 'consumed')
  assert.equal(consumed.length, 5, 'claimed entries stay marked consumed across restarts')
  assert.equal(reconcileStartup(), null, 'redelivery must not disturb interrupted/quarantined recovery')
}

// ── 01/02 · the consuming surfaces read the projection, they do not judge ───
{
  const feed = read('src/components/RunProcessFeed.tsx')
  assert.match(feed, /orchestrationFromAgent\(agent\)/, 'the process feed must feed the shared projection')
  assert.doesNotMatch(feed, /未達 DoD/, 'the process feed must not carry its own exhausted wording')

  const summary = read('src/components/RunSummaryCard.tsx')
  assert.match(summary, /dodMet: summary\.dodMet/, 'the run summary card must feed the shared projection')
  assert.doesNotMatch(summary, /未達 DoD/, 'the run summary card must not carry its own exhausted wording')

  const header = read('src/components/subdesign/SubDesignWorkspaceHeader.tsx')
  assert.match(header, /workspace\.runStatusLabel/, 'the SubDesign header must render the projected label')
  assert.doesNotMatch(header, /未達 DoD/, 'the SubDesign header must not carry its own exhausted wording')

  const coordinator = read('src/agent/taskRunCoordinator.ts')
  assert.match(coordinator, /recordRunTerminal\(\{[\s\S]*?delivery: \{/, 'the terminal marker records delivery state')
  assert.match(coordinator, /\.end\(runId, terminalLabel, \{/, 'the registry entry carries the settled outcome')

  const shell = read('src/components/Layout.tsx')
  assert.match(shell, /useRunCompletionNotices\(\)/, 'the shell drives completion notices on every route')
  const app = read('src/App.tsx')
  assert.doesNotMatch(app, /wasRunning/, 'the aggregate isRunning notifier must not come back as a second source')
  assert.match(app, /claimPendingRunDeliveries\(\)/, 'startup recovery owns redelivery')
}

console.log('run completion reachability: exhausted wording, shell notices, journal delivery and redelivery are coherent')
