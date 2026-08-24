/**
 * Resilience semantics smoke (.scratch/resilience-semantics-gaps).
 *
 * Covers the shipped modules for:
 *   01 — abortable turn: safe park at a tool boundary, `interrupted(by user)`
 *   02 — per-turn timeout on the same path, driven by a fake clock
 *   03 — durable checkpoints with no LRU/quota degradation, kill-and-restart
 *   04 — resume from checkpoint: replay-safe, fail-closed, exactly once
 *   05 — compaction preflight: journal event, marker kind, original retrievable
 *   07 — run-level memory sink: four sections, write evidence, prior context
 *
 * Run: node --experimental-strip-types scripts/smoke-resilience-semantics.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })
Object.defineProperty(globalThis, 'window', { value: { subagents: {} }, configurable: true })

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8')

const { JsonCompactionCheckpointStore } = await import('../electron/compactionCheckpointStore.ts')
const { armTurnDeadline, clampTurnTimeout, MIN_TURN_TIMEOUT_MS, MAX_TURN_TIMEOUT_MS } =
  await import('../electron/piTurnDeadline.ts')
const { runPiOrchestration } = await import('../electron/piOrchestrationExtension.ts')
const { shouldParkTurn } = await import('../electron/piCoreRuntime.ts')
const { resolveTurnTimeout, DEFAULT_TURN_TIMEOUT_MS } = await import('../src/agent/turnTimeout.ts')
const { deriveRunLifecycle } = await import('../src/agent/runLifecycle.ts')
const { sealInterruptedDraft, INTERRUPTED_DRAFT_SEAL } = await import('../src/store/runActivityStore.ts')
const { decideResume, buildResumeObjective, isResumableTerminalRun, RESUME_REFUSAL_COPY } =
  await import('../src/agent/runResume.ts')
const {
  getJournalEntry,
  recordRunAdmitted,
  recordRunCompaction,
  recordRunMemorySink,
  recordRunStarted,
  recordRunTerminal,
  resetRunJournalForTests,
} = await import('../src/agent/runJournal.ts')
const { renderRunMemoryDigest, runMemoryRelativePath, isWorthPersisting, buildPriorContextBlock } =
  await import('../src/agent/runMemorySink.ts')
const { buildRunMemoryDigestFromRun, parseRunMemoryDigest } = await import('../src/agent/runMemoryDigest.ts')
const { isSafeLearningExportPath } = await import('../src/agent/hermes/learningExport.ts')

// ── 01 · a stop is not a failure, and it parks at a tool boundary ───────────
{
  const view = deriveRunLifecycle({ status: 'halted', terminal: true, interruptReason: 'user' })
  assert.equal(view.label, '已中止')
  assert.equal(view.interruptReason, 'user')

  const timedOut = deriveRunLifecycle({ status: 'halted', terminal: true, interruptReason: 'timeout' })
  assert.equal(timedOut.label, '已逾時中止')

  const failed = deriveRunLifecycle({ status: 'failed', terminal: true })
  assert.equal(failed.label, '執行失敗')

  // Three outcomes, three words, three tones, three icons — none reused.
  const labels = new Set([view.label, timedOut.label, failed.label])
  assert.equal(labels.size, 3, 'user stop, timeout and failure must not share wording')
  assert.equal(new Set([view.tone, timedOut.tone, failed.tone]).size, 3, 'and must not share a tone')
  assert.equal(new Set([view.icon, timedOut.icon, failed.icon]).size, 3, 'and must not share an icon')

  // Pressing stop answers on screen before the Host settles.
  const stopping = deriveRunLifecycle({ phase: 'executing', status: 'running', active: true, stopping: true })
  assert.equal(stopping.canStop, false, 'the stop affordance withdraws immediately')
  assert.notEqual(stopping.icon, 'progress_activity', 'the spinner must stop on the press, not on settlement')
  assert.equal(stopping.label, '正在安全停車…')

  // Partial output survives, sealed so it cannot read as a finished answer.
  const sealed = sealInterruptedDraft('第一段結論已經寫到一半', 'user')
  assert.ok(sealed.startsWith('第一段結論已經寫到一半'), 'streamed output is kept')
  assert.ok(sealed.endsWith(INTERRUPTED_DRAFT_SEAL.user), 'and is closed with an interruption marker')
  assert.equal(sealInterruptedDraft(sealed, 'user'), sealed, 'sealing twice must not double the marker')
  assert.equal(sealInterruptedDraft('', 'user'), '', 'an empty draft gets no marker')
}

// ── 01 · the park rule: a running tool is never severed ─────────────────────
{
  assert.equal(
    shouldParkTurn({ interrupt: 'user', toolsInFlight: 1, parked: false }),
    false,
    'a stop pressed while a tool is running must wait for that tool to finish',
  )
  assert.equal(
    shouldParkTurn({ interrupt: 'user', toolsInFlight: 0, parked: false }),
    true,
    'and takes effect the moment the boundary is reached',
  )
  assert.equal(
    shouldParkTurn({ interrupt: 'user', toolsInFlight: 0, parked: true }),
    false,
    'parking happens exactly once',
  )
  assert.equal(
    shouldParkTurn({ toolsInFlight: 0, parked: false }),
    false,
    'a run with no pending stop keeps going',
  )
  assert.equal(
    shouldParkTurn({ interrupt: 'timeout', toolsInFlight: 2, parked: false }),
    false,
    'a timeout waits for the boundary exactly like a user stop',
  )

  // Replay a realistic boundary sequence: stop arrives mid-tool, two nested
  // tools are outstanding, and only the last completion may park.
  let state = { interrupt: undefined as 'user' | 'timeout' | undefined, toolsInFlight: 0, parked: false }
  const parkPoints: number[] = []
  const events: Array<'start' | 'end' | 'stop'> = ['start', 'start', 'stop', 'end', 'end']
  events.forEach((event, index) => {
    if (event === 'start') state.toolsInFlight += 1
    if (event === 'stop') state.interrupt = 'user'
    if (event === 'end') {
      state.toolsInFlight = Math.max(0, state.toolsInFlight - 1)
      if (shouldParkTurn(state)) {
        state = { ...state, parked: true }
        parkPoints.push(index)
      }
    }
  })
  assert.deepEqual(parkPoints, [4], 'the park lands on the final tool boundary, not before')
}

// ── 01 · orchestration stops between iterations once interrupted ────────────
{
  const started: number[] = []
  let interrupt: 'user' | 'timeout' | undefined
  const settled = await runPiOrchestration({
    pattern: 'Goal-based',
    prompt: 'keep going',
    maxIterations: 5,
    interrupted: () => interrupt,
    turn: async (_prompt, iteration) => {
      started.push(iteration)
      // The stop arrives while iteration 2 is running; it must not start a 3rd.
      if (iteration === 2) interrupt = 'user'
      return { settlement: 'answered', result: `iteration ${iteration}`, done: false }
    },
  })
  assert.deepEqual(started, [1, 2], 'no iteration may start after an interrupt is pending')
  assert.equal(settled.settlement, 'interrupted', 'a parked goal settles interrupted, not failed')
  assert.equal(settled.interruptReason, 'user')
  assert.equal(settled.iterations, 2)

  // Without an interrupt an unmet DoD at the cap is still an honest failure.
  const exhausted = await runPiOrchestration({
    pattern: 'Goal-based',
    prompt: 'keep going',
    maxIterations: 2,
    turn: async () => ({ settlement: 'answered', result: 'partial', done: false }),
  })
  assert.equal(exhausted.settlement, 'failed', 'an unmet DoD at the cap is not an interrupt')
}

// ── 02 · deadlines: resolved at admission, driven by a fake clock ───────────
{
  assert.equal(
    resolveTurnTimeout({ runner: 'builtin', pattern: 'Turn-based' }),
    DEFAULT_TURN_TIMEOUT_MS['Turn-based'],
  )
  assert.equal(
    resolveTurnTimeout({ runner: 'builtin', pattern: 'Goal-based' }),
    DEFAULT_TURN_TIMEOUT_MS['Goal-based'],
    'a Goal-based run gets a longer budget than a chat turn',
  )
  assert.ok(
    (resolveTurnTimeout({ runner: 'builtin', pattern: 'Goal-based', unattended: true }) || 0)
      < DEFAULT_TURN_TIMEOUT_MS['Goal-based'],
    'nobody is watching an automation run, so it stays tighter',
  )
  assert.equal(
    resolveTurnTimeout({ runner: 'external', pattern: 'Goal-based' }),
    undefined,
    'an external CLI keeps one owner of its lifetime',
  )
  // Precedence: run override > thread > settings > pattern default.
  assert.equal(
    resolveTurnTimeout({
      runner: 'builtin',
      pattern: 'Turn-based',
      settingsTimeoutMs: 600_000,
      threadTimeoutMs: 300_000,
      runTimeoutMs: 120_000,
    }),
    120_000,
  )
  assert.equal(
    resolveTurnTimeout({ runner: 'builtin', pattern: 'Turn-based', settingsTimeoutMs: 600_000, threadTimeoutMs: 300_000 }),
    300_000,
    'a per-conversation override beats the global setting',
  )
  assert.equal(clampTurnTimeout(1), MIN_TURN_TIMEOUT_MS, 'an absurdly small budget is clamped, not honoured')
  assert.equal(clampTurnTimeout(Number.MAX_SAFE_INTEGER), MAX_TURN_TIMEOUT_MS)
  assert.equal(clampTurnTimeout(0), undefined)

  // Fake clock: no real waiting anywhere in this file.
  let currentTime = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextHandle = 1
  const clock = {
    now: () => currentTime,
    setTimer: (fn: () => void, ms: number) => {
      const handle = nextHandle++
      timers.set(handle, { at: currentTime + ms, fn })
      return handle
    },
    clearTimer: (handle: unknown) => { timers.delete(handle as number) },
  }
  const advance = (ms: number) => {
    currentTime += ms
    for (const [handle, timer] of [...timers]) {
      if (timer.at <= currentTime) {
        timers.delete(handle)
        timer.fn()
      }
    }
  }

  let expired = 0
  const deadline = armTurnDeadline(60_000, () => { expired += 1 }, clock)
  assert.equal(deadline.expired(), false)
  advance(59_999)
  assert.equal(expired, 0, 'the budget has not run out yet')
  advance(1)
  assert.equal(expired, 1, 'the deadline fires exactly at the budget')
  assert.equal(deadline.expired(), true)
  advance(120_000)
  assert.equal(expired, 1, 'and fires only once')

  // Progress pushes the deadline out: a working long task is not a stuck one.
  currentTime = 0
  let extendedExpiry = 0
  const working = armTurnDeadline(60_000, () => { extendedExpiry += 1 }, clock)
  advance(50_000)
  working.extend()
  advance(50_000)
  assert.equal(extendedExpiry, 0, 'a turn still emitting work must not be killed')
  advance(10_000)
  assert.equal(extendedExpiry, 1, 'but silence past the budget still parks it')

  currentTime = 0
  let cancelledExpiry = 0
  const settledEarly = armTurnDeadline(60_000, () => { cancelledExpiry += 1 }, clock)
  settledEarly.cancel()
  advance(120_000)
  assert.equal(cancelledExpiry, 0, 'a settled turn never fires its deadline')
}

// ── 03 · durable checkpoints survive a restart, with no degradation ─────────
const checkpointRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-checkpoints-'))
{
  const store = new JsonCompactionCheckpointStore(checkpointRoot)
  // Far larger than the old 300KB renderer cap that used to drop the messages.
  const bigTranscript = Array.from({ length: 400 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(2_000),
  }))
  const saved = store.save({
    runId: 'run-durable',
    threadId: 'thread-durable',
    objective: '整理季度報告',
    summary: '前段已經蒐集完資料',
    messages: bigTranscript,
    parkedAtToolBoundary: true,
    replaySafe: true,
    effects: ['write · report.md'],
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.checkpoint?.truncated, false, 'a durable checkpoint is never degraded to a summary')
  assert.equal(saved.checkpoint?.messages?.length, 400, 'the whole pre-compaction transcript is kept')

  // Well past the old LRU limit of five runs.
  for (let index = 0; index < 12; index += 1) {
    store.save({ runId: `run-bulk-${index}`, summary: `s${index}`, messages: [{ role: 'user', content: 'hi' }] })
  }
  assert.ok(store.load('run-bulk-0'), 'the oldest run must not be evicted by a global cap')
  assert.ok(store.load('run-durable'), 'and neither must the run we care about')

  // Kill-and-restart: a brand-new store instance reads the same bytes.
  const afterRestart = new JsonCompactionCheckpointStore(checkpointRoot)
  const reloaded = afterRestart.load('run-durable')
  assert.equal(reloaded?.summary, '前段已經蒐集完資料', 'checkpoints survive a Host restart')
  assert.equal(reloaded?.messages?.length, 400, 'including the full original transcript')
  assert.equal(reloaded?.replaySafe, true)

  // Successive checkpoints accumulate; the newest is what a resume continues from.
  afterRestart.save({ runId: 'run-durable', summary: '第二次壓縮', messages: [] })
  assert.equal(afterRestart.load('run-durable')?.summary, '第二次壓縮')
  assert.equal(afterRestart.list('run-durable').length, 2, 'earlier checkpoints stay retrievable for audit')
  assert.equal(afterRestart.list('run-durable')[0].summary, '前段已經蒐集完資料')

  // Replay safety is never inferred from a bare assertion.
  const unsafe = afterRestart.save({ runId: 'run-unsafe', summary: 's', messages: [], replaySafe: true })
  assert.equal(unsafe.checkpoint?.replaySafe, false, 'replaySafe requires a clean tool-boundary park')
}

// ── 04 · resume is replay-safe, fail-closed, and happens exactly once ───────
{
  const store = new JsonCompactionCheckpointStore(checkpointRoot)

  assert.equal(isResumableTerminalRun({ status: 'halted', interruptReason: 'user' }), true)
  assert.equal(isResumableTerminalRun({ status: 'halted', interruptReason: 'timeout' }), true)
  assert.equal(isResumableTerminalRun({ status: 'failed' }), false, 'a failure is not a parked run')
  assert.equal(isResumableTerminalRun({ status: 'success' }), false)

  assert.equal(decideResume(null).allowed, false)
  assert.equal((decideResume(null) as { refusal: string }).refusal, 'no-checkpoint')

  const notParked = store.save({ runId: 'run-midtool', summary: 's', messages: [], replaySafe: true }).checkpoint
  const refusedMidTool = decideResume(notParked)
  assert.equal(refusedMidTool.allowed, false, 'a checkpoint not taken at a tool boundary cannot prove replay safety')
  assert.equal((refusedMidTool as { refusal: string }).refusal, 'not-replay-safe')
  assert.equal((refusedMidTool as { detail: string }).detail, RESUME_REFUSAL_COPY['not-replay-safe'])
  assert.match((refusedMidTool as { detail: string }).detail, /副作用/, 'the refusal says why, in the user’s language')

  store.save({
    runId: 'run-resume',
    threadId: 'thread-resume',
    objective: '重構登入流程',
    summary: '已改完 session 模組',
    messages: [{ role: 'user', content: 'go' }],
    parkedAtToolBoundary: true,
    replaySafe: true,
    effects: ['write · auth/session.ts', 'bash · npm test'],
  })
  const allowed = decideResume(store.load('run-resume'))
  assert.equal(allowed.allowed, true, 'a clean park is resumable')

  const objective = buildResumeObjective(store.load('run-resume')!)
  assert.match(objective, /重構登入流程/, 'the resume carries the original objective')
  assert.match(objective, /已改完 session 模組/, 'and the progress it continues from')
  assert.match(objective, /auth\/session\.ts/, 'and names the effects that must not be repeated')
  assert.match(objective, /不要重跑已完成的步驟/)

  // Exactly once, even under a double press.
  const first = store.claimResume('run-resume')
  assert.equal(first.ok, true)
  const second = store.claimResume('run-resume')
  assert.equal(second.ok, false, 'the same checkpoint can never be resumed twice')
  assert.equal(second.reason, 'already-claimed')
  assert.equal(decideResume(store.load('run-resume')).allowed, false, 'and the offer disappears after claiming')

  // The claim survives a restart, so a relaunch cannot replay it either.
  assert.equal(new JsonCompactionCheckpointStore(checkpointRoot).claimResume('run-resume').ok, false)

  // Fail-closed: an unprovable checkpoint is refused at the claim too.
  assert.equal(store.claimResume('run-midtool').ok, false)
  assert.equal(store.claimResume('run-never-existed').reason, 'no-checkpoint')
}

// ── 05 · compaction leaves a journal event and an on-screen marker ──────────
{
  resetRunJournalForTests()
  recordRunAdmitted({ runId: 'run-compact', objective: '長任務', sourceKind: 'composer' })
  recordRunStarted({ runId: 'run-compact', threadId: 'thread-compact' })

  recordRunCompaction('run-compact', {
    replacedMessages: 24,
    remainingMessages: 7,
    summaryChars: 1_200,
    estimatedTokens: 98_000,
    contextWindow: 128_000,
  })
  recordRunCompaction('run-compact', {
    replacedMessages: 11,
    remainingMessages: 7,
    summaryChars: 800,
    estimatedTokens: 101_000,
    contextWindow: 128_000,
  })
  const entry = getJournalEntry('run', 'run-compact')
  assert.equal(entry?.compactions?.length, 2, 'every compaction is recorded, not just the last')
  assert.equal(entry?.compactions?.[0].replacedMessages, 24, 'the range it covered is recorded')
  assert.equal(entry?.compactions?.[0].remainingMessages, 7)
  assert.ok(entry?.compactions?.[0].at, 'and when it happened')
  assert.equal(entry?.compactions?.[1].estimatedTokens, 101_000, 'along with what triggered the preflight')

  // The pre-compaction original stays retrievable from the durable checkpoint.
  const store = new JsonCompactionCheckpointStore(checkpointRoot)
  store.save({
    runId: 'run-compact',
    summary: '[Compacted 24 earlier messages]',
    messages: Array.from({ length: 24 }, (_, index) => ({ role: 'user', content: `原文 ${index}` })),
  })
  const original = store.load('run-compact')
  assert.equal(original?.messages?.length, 24, 'the text the agent actually saw is auditable afterwards')
  const firstOriginal = (original?.messages || [])[0] as { content?: string } | undefined
  assert.equal(firstOriginal?.content, '原文 0')
}

// ── 07 · the memory sink: four sections, evidence, prior context ────────────
{
  const digest = buildRunMemoryDigestFromRun({
    runId: 'run-memory',
    threadId: 'thread-memory',
    objective: '把結帳流程的錯誤訊息改成看得懂的中文',
    status: 'success',
    agent: {
      finishedAt: '2026-08-23T10:00:00.000Z',
      loopConfig: { definitionOfDone: '所有錯誤訊息都有中文對照' },
      steps: [
        { step: 1, action: 'read', description: '讀過結帳流程的錯誤字串', status: 'COMPLETED' },
        { step: 2, action: 'edit', description: '換掉三個技術用語', status: 'COMPLETED' },
        { step: 3, action: 'test', description: '跑一次結帳測試', status: 'FAILED', result: '缺少測試帳號' },
      ],
      haltReason: undefined,
    } as never,
  })
  assert.equal(digest.objective, '把結帳流程的錯誤訊息改成看得懂的中文')
  assert.ok(digest.decisions.length >= 2, 'completed steps become decisions')
  assert.ok(digest.failures.some((line) => line.includes('缺少測試帳號')), 'failures carry their recorded reason')
  assert.ok(digest.procedure.length >= 2, 'two or more completed steps make a reusable procedure')
  assert.equal(isWorthPersisting(digest), true)

  const rendered = renderRunMemoryDigest(digest)
  for (const heading of ['這次要做什麼', '做了哪些決定', '哪裡卡住或失敗', '下次可以照著做的步驟']) {
    assert.ok(rendered.includes(`## ${heading}`), `the digest must always carry the「${heading}」section`)
  }
  assert.doesNotMatch(rendered, /DoD|settlement|orchestration/, 'the digest is plain language, not internal jargon')

  const relativePath = runMemoryRelativePath(digest)
  assert.ok(relativePath.startsWith('.subagents/memory/runs/'), 'digests land in the project memory directory')
  assert.equal(isSafeLearningExportPath(relativePath), true, 'and go through the confined project bridge')
  assert.ok(
    runMemoryRelativePath({ runId: '../../etc/passwd', at: '2026-08-23' }).startsWith('.subagents/memory/runs/'),
    'a hostile run id cannot escape the memory directory',
  )

  // An empty run is not worth a file.
  assert.equal(
    isWorthPersisting({ ...digest, decisions: [], failures: [], procedure: [] }),
    false,
  )

  // Round-trip: what was written is what the next run is reminded of.
  const parsed = parseRunMemoryDigest(rendered, { runId: 'run-memory', threadId: 'thread-memory', at: digest.at })
  assert.ok(parsed, 'a written digest parses back')
  assert.equal(parsed?.objective, digest.objective)
  assert.deepEqual(parsed?.decisions, digest.decisions)
  assert.deepEqual(parsed?.failures, digest.failures)

  const prior = buildPriorContextBlock([parsed!])
  assert.match(prior, /這個對話先前的沉澱/, 'a new run on the thread is reminded of what happened')
  assert.match(prior, /以這次的要求為準/, 'and the reminder never outranks the current request')
  assert.equal(buildPriorContextBlock([]), '', 'a fresh thread carries no prior block')

  // Evidence: a sink exists only when a write actually happened.
  resetRunJournalForTests()
  recordRunAdmitted({ runId: 'run-memory', objective: '沉澱測試', sourceKind: 'composer' })
  recordRunStarted({ runId: 'run-memory', threadId: 'thread-memory' })
  recordRunTerminal({ runId: 'run-memory', threadId: 'thread-memory', status: 'success' })
  assert.equal(
    getJournalEntry('run', 'run-memory')?.memorySink,
    undefined,
    'a finished run claims nothing about memory until a file lands',
  )
  recordRunMemorySink('run-memory', { path: '.subagents/memory/runs/2026-08-23-run-memory.md', bytes: 812 })
  const sunk = getJournalEntry('run', 'run-memory')
  assert.equal(sunk?.memorySink?.bytes, 812, 'the write evidence is what makes the claim true')
  assert.match(sunk?.memorySink?.path || '', /^\.subagents\/memory\//)
  recordRunMemorySink('run-never-admitted', { path: '.subagents/memory/x.md', bytes: 10 })
  assert.equal(getJournalEntry('run', 'run-never-admitted'), undefined, 'evidence cannot invent a run')
}

// ── Drift guards: one owner for abort/timeout, no renderer checkpoint ───────
{
  const runtime = read('electron/piCoreRuntime.ts')
  assert.match(runtime, /interruptPiTurn/, 'the Host owns the safe-park path')
  assert.match(runtime, /tool_execution_end/, 'parking is driven by real tool boundaries')
  assert.match(runtime, /toolsInFlight === 0/, 'and only fires when no tool is mid-execution')
  // Scope to the interrupt path only: the hard-cancel helper lives elsewhere
  // in this file and is still legitimate for teardown.
  const interruptBody = runtime.slice(
    runtime.indexOf('export function interruptPiTurn'),
    runtime.indexOf('export function piTurnInterruptState'),
  )
  assert.ok(interruptBody.length > 0, 'sanity: the interrupt function must be found')
  assert.doesNotMatch(
    interruptBody,
    /cancelPiTool|controller\.abort/,
    'an interrupt must never sever an in-flight tool the way a hard cancel does',
  )
  const parkBody = runtime.slice(
    runtime.indexOf('function parkInterruptedTurn'),
    runtime.indexOf('function interruptedTurnResult'),
  )
  assert.doesNotMatch(parkBody, /cancelPiTool|controller\.abort/, 'parking aborts the session, never a running tool')

  const protocol = read('electron/piHostProtocol.ts')
  assert.match(protocol, /'turn\/interrupt'/, 'interrupt is a protocol method, not a renderer-side guess')
  assert.match(protocol, /armTurnDeadline\(timeoutMs/, 'the timeout is armed Host-side')
  assert.match(protocol, /interruptPiTurn\(runId, 'timeout'\)/, 'and expiry walks the same safe-park path')

  const store = read('src/store/agentStore.ts')
  assert.match(store, /turn\?\.interrupt/, 'the stop button asks for a safe park')
  assert.match(store, /markStopping/, 'and the press is acknowledged before the Host settles')

  const checkpoint = read('src/agent/compactionCheckpoint.ts')
  assert.doesNotMatch(checkpoint, /localStorage/, 'no renderer-storage fallback survives')

  const coordinator = read('src/agent/taskRunCoordinator.ts')
  assert.match(coordinator, /resolveTurnTimeout\(/, 'admission decides the patience budget')
  assert.match(coordinator, /persistRunMemoryDigest/, 'finalization sediments what the run learned')
  assert.match(coordinator, /loadThreadPriorContext/, 'and admission injects what earlier runs left')
}

fs.rmSync(checkpointRoot, { recursive: true, force: true })
console.log('resilience semantics: safe-park abort, turn deadlines, durable checkpoints, resume, compaction records and the memory sink are coherent')
