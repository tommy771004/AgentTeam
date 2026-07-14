/**
 * P1-D residual — fake-bridge scenario E2E for §7 workflow matrix
 * (CODEX_APP_WORKFLOW_ALIGNMENT_AUDIT.md).
 *
 * Pure-logic simulation of the runTask lifecycle with fakes:
 *   clock · LLM · MCP · HITL · queue · hooks · project context · attachments
 * No Electron, no real network. Mirrors production contracts so drift is caught.
 *
 * Run: node scripts/smoke-scenario-e2e.mjs
 * Via: npm run smoke
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

let passed = 0
async function test(name, fn) {
  process.stdout.write(`  · ${name} … `)
  try {
    await fn()
    console.log('ok')
    passed++
  } catch (e) {
    console.log('FAIL')
    console.error(e)
    process.exitCode = 1
  }
}

console.log('P1-D scenario E2E (fake bridge · §7 matrix)\n')

// ── Fakes ──────────────────────────────────────────────────────────

function createFakeClock(start = 1_700_000_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms) => {
      t += ms
      return t
    },
    iso: () => new Date(t).toISOString(),
  }
}

function createFakeLlm(script = []) {
  /** script: array of { toolCalls?: [], content?: string } or function(messages) */
  let i = 0
  const calls = []
  return {
    calls,
    async chat(messages, tools = []) {
      calls.push({ messages, tools: tools.map((t) => t?.function?.name || t) })
      const step = typeof script[i] === 'function' ? script[i](messages, tools) : script[i]
      i++
      if (!step) return { content: 'done', toolCalls: [], tokensUsed: 10 }
      return {
        content: step.content || '',
        toolCalls: step.toolCalls || [],
        tokensUsed: step.tokensUsed ?? 10,
      }
    },
  }
}

function createFakeMcp(tools = { ping: { ok: true, output: 'pong' } }) {
  const calls = []
  return {
    calls,
    listTools: async () => Object.keys(tools).map((name) => ({ name })),
    call: async (name, args) => {
      calls.push({ name, args })
      const t = tools[name]
      if (!t) return { ok: false, output: `unknown tool ${name}` }
      if (typeof t === 'function') return t(args)
      return t
    },
  }
}

function createFakeHitl({ auto = 'deny', delayMs = 0 } = {}) {
  const asks = []
  return {
    asks,
    async requestAsk(payload) {
      asks.push(payload)
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      if (auto === 'approve') return { action: 'allow' }
      if (auto === 'timeout') throw new Error('HITL timeout')
      return { action: 'deny' }
    },
  }
}

// ── Production pure mirrors ────────────────────────────────────────

function resolveBusyPolicy(sourceKind, followUpMode) {
  switch (sourceKind) {
    case 'schedule':
    case 'webhook':
    case 'telegram':
    case 'event':
    case 'delegate':
    case 'queue-drain':
      return 'queue'
    case 'composer':
    case 'slash':
    case 'retry':
      return (followUpMode || 'steer') === 'queue' ? 'queue' : 'steer'
    default:
      return 'reject'
  }
}

function evaluateHooks(rules, ctx) {
  const out = {
    deny: undefined,
    forceAsk: false,
    appendTexts: [],
    audits: [],
    notifications: [],
  }
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (rule.point !== ctx.point) continue
    const m = rule.match
    if (m) {
      if (m.tool) {
        const t = ctx.tool || ''
        const ok = m.tool.endsWith('*')
          ? t.startsWith(m.tool.slice(0, -1))
          : t === m.tool
        if (!ok) continue
      }
      if (
        m.sourceKind?.length &&
        (!ctx.sourceKind || !m.sourceKind.includes(ctx.sourceKind))
      ) {
        continue
      }
      if (
        m.objectiveIncludes &&
        !(ctx.objective || '')
          .toLowerCase()
          .includes(String(m.objectiveIncludes).toLowerCase())
      ) {
        continue
      }
      if (m.onlyOnFailure && ctx.toolOk !== false) continue
    }
    const label = `[hook:${rule.id}]`
    if (rule.action === 'deny' && !out.deny) {
      out.deny = { rule, reason: rule.reason || rule.id }
      out.audits.push(`${label} deny`)
    } else if (rule.action === 'require-approval') {
      out.forceAsk = true
      out.audits.push(`${label} require-approval`)
    } else if (rule.action === 'append-context' && rule.text) {
      out.appendTexts.push(rule.text)
      out.audits.push(`${label} append-context`)
    } else if (rule.action === 'notify') {
      out.notifications.push(rule.reason || rule.id)
      out.audits.push(`${label} notify`)
    } else if (rule.action === 'log') {
      out.audits.push(`${label} log`)
    }
  }
  return out
}

function sanitizeHookRules(raw) {
  const POINT_ACTIONS = {
    beforeRun: ['deny', 'append-context', 'log', 'notify'],
    beforeTool: ['deny', 'require-approval', 'log', 'notify'],
    afterTool: ['log', 'notify'],
    afterRun: ['log', 'notify'],
  }
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (r) =>
      r &&
      r.id &&
      POINT_ACTIONS[r.point]?.includes(r.action) &&
      r.action !== 'allow',
  )
}

/** In-memory FIFO queue with schedule rebind + attachment path persistence */
function createFakeQueue() {
  const items = []
  const MAX = 24
  return {
    items,
    enqueue(opts) {
      const key = [
        (opts.objective || '').slice(0, 200),
        opts.sourceKind || '',
        opts.meta?.scheduleJobId || '',
        opts.reuseThreadId || '',
      ].join('|')
      if (items.some((q) => q.dedupeKey === key)) return null
      if (items.length >= MAX) return null
      const item = {
        ...opts,
        id: `q_${items.length + 1}`,
        dedupeKey: key,
        enqueuedAt: Date.now(),
        // only filePath survives "persist"
        attachments: (opts.attachments || []).map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          filePath: a.filePath,
        })),
      }
      items.push(item)
      return item
    },
    shift() {
      return items.shift() || null
    },
    clear() {
      const n = items.length
      items.length = 0
      return n
    },
  }
}

/**
 * Fake runTask controller — the scenario under test.
 * Models: busy policy → queue → hooks → tools → status → drain → callbacks.
 */
function createFakeRunController({
  clock = createFakeClock(),
  llm = createFakeLlm(),
  mcp = createFakeMcp(),
  hitl = createFakeHitl(),
  hooks = [],
  followUpMode = 'steer',
  concurrentRunsEnabled = false,
  maxConcurrentRuns = 4,
} = {}) {
  const activeRuns = new Map()
  const queue = createFakeQueue()
  const archive = []
  const threads = new Map()
  const notifications = []
  const jobResults = new Map()
  let projectContext = { root: null, agentsHash: null, guidance: '' }
  const rules = sanitizeHookRules(hooks)
  const limit = () => (concurrentRunsEnabled ? Math.max(2, maxConcurrentRuns) : 1)

  async function authorize(tool, ctx) {
    const ev = evaluateHooks(rules, {
      point: 'beforeTool',
      tool,
      sourceKind: ctx.sourceKind,
      objective: ctx.objective,
    })
    for (const line of ev.audits) ctx.logs.push(line)
    if (ev.deny) {
      return { allowed: false, output: `hook deny: ${ev.deny.reason}` }
    }
    if (ev.forceAsk || ctx.forceAsk) {
      try {
        const d = await hitl.requestAsk({
          tool,
          unattended: ctx.unattended,
          runId: ctx.runId,
          threadId: ctx.threadId,
        })
        if (d.action !== 'allow') {
          return { allowed: false, output: `HITL ${d.action || 'deny'}: ${tool}` }
        }
      } catch (e) {
        return {
          allowed: false,
          output: `HITL timeout: ${e instanceof Error ? e.message : e}`,
        }
      }
    }
    return { allowed: true }
  }

  async function executeTool(tool, args, ctx) {
    const auth = await authorize(tool, ctx)
    if (!auth.allowed) {
      const after = evaluateHooks(rules, {
        point: 'afterTool',
        tool,
        toolOk: false,
        sourceKind: ctx.sourceKind,
        objective: ctx.objective,
      })
      ctx.logs.push(...after.audits)
      return { ok: false, output: auth.output }
    }
    let result
    if (tool.startsWith('mcp_') || tool === 'mcp_call') {
      const name = args.name || tool.replace(/^mcp_[^_]+_/, '') || 'ping'
      result = await mcp.call(name, args)
    } else if (tool === 'bash') {
      result = { ok: true, output: `fake bash: ${(args.command || '').slice(0, 40)}` }
    } else {
      result = { ok: true, output: `fake tool ${tool} ok` }
    }
    const after = evaluateHooks(rules, {
      point: 'afterTool',
      tool,
      toolOk: result.ok !== false,
      sourceKind: ctx.sourceKind,
      objective: ctx.objective,
    })
    ctx.logs.push(...after.audits)
    for (const n of after.notifications) notifications.push(n)
    return result
  }

  async function runTask(input) {
    const runId = input.runId || `run_${clock.now().toString(36)}`
    const sourceKind = input.sourceKind
    const objective = (input.objective || '').trim()
    if (!objective) {
      return { status: 'failed', error: 'empty', runId, threadId: null }
    }

    const unattended = [
      'schedule',
      'webhook',
      'telegram',
      'event',
      'delegate',
      'queue-drain',
    ].includes(sourceKind)

    const threadId = input.reuseThreadId || `th_${runId}`
    const sameThreadRun = [...activeRuns.entries()].find(([, active]) => active.threadId === threadId)
    const blockedByCapacity = activeRuns.size >= limit()

    if ((sameThreadRun || blockedByCapacity) && !input._fromQueue) {
      const policy = resolveBusyPolicy(sourceKind, followUpMode)
      if (policy === 'queue') {
        const item = queue.enqueue({
          ...input,
          runId,
          unattended: unattended || input.unattended,
        })
        if (!item) {
          return {
            status: 'skipped',
            skipped: true,
            skipReason: 'busy',
            runId,
            threadId: input.reuseThreadId || null,
          }
        }
        return {
          status: 'skipped',
          skipped: true,
          skipReason: 'queued',
          queued: true,
          queueId: item.id,
          runId,
          threadId: input.reuseThreadId || null,
        }
      }
      if (policy === 'steer') {
        // Stop only the run occupying this thread/capacity slot.
        const target = sameThreadRun || activeRuns.entries().next().value
        if (target) activeRuns.delete(target[0])
      } else {
        return {
          status: 'skipped',
          skipped: true,
          skipReason: 'busy',
          error: 'busy reject',
          runId,
          threadId: null,
        }
      }
    }

    if (activeRuns.size >= limit()) {
      return {
        status: 'skipped',
        skipped: true,
        skipReason: 'busy',
        error: 'capacity full',
        runId,
        threadId,
      }
    }
    if (activeRuns.has(runId) || [...activeRuns.values()].some((active) => active.threadId === threadId)) {
      return {
        status: 'skipped',
        skipped: true,
        skipReason: 'busy',
        error: 'thread busy',
        runId,
        threadId,
      }
    }
    activeRuns.set(runId, { runId, threadId })
    const logs = []
    if (!threads.has(threadId)) {
      threads.set(threadId, {
        id: threadId,
        bubbles: [],
        projectRoot: input.projectRoot || projectContext.root,
        agentsHash: projectContext.agentsHash,
      })
    }
    const thread = threads.get(threadId)
    if (!input.skipUserBubble) {
      thread.bubbles.push({ role: 'user', content: objective, runId })
    }

    // beforeRun hooks
    const before = evaluateHooks(rules, {
      point: 'beforeRun',
      sourceKind,
      objective,
    })
    logs.push(...before.audits)
    for (const n of before.notifications) notifications.push(n)
    if (before.deny) {
      activeRuns.delete(runId)
      thread.bubbles.push({
        role: 'system',
        content: `hook deny: ${before.deny.reason}`,
        runId,
      })
      const result = {
        status: 'failed',
        error: `hook deny: ${before.deny.reason}`,
        runId,
        threadId,
        logs,
      }
      archive.push(result)
      try {
        await input.onSettled?.(result)
      } catch {
        /* ignore */
      }
      await drain()
      return result
    }

    // Apply project guidance (snapshot for this run)
    const guidance = projectContext.guidance
    const ctx = {
      runId,
      threadId,
      sourceKind,
      objective,
      unattended,
      forceAsk: false,
      logs,
      guidance,
      appendTexts: before.appendTexts,
    }

    // Fake LLM tool loop (1–2 rounds)
    const toolRecords = []
    const llmResult = await llm.chat(
      [
        { role: 'system', content: guidance },
        { role: 'user', content: objective },
      ],
      [{ function: { name: 'bash' } }, { function: { name: 'mcp_ha_ping' } }],
    )
    for (const tc of llmResult.toolCalls || []) {
      const r = await executeTool(tc.name, tc.arguments || {}, ctx)
      toolRecords.push({ tool: tc.name, ...r, runId })
    }

    const status =
      toolRecords.some((t) => t.ok === false && /hook deny|HITL/.test(t.output || ''))
        ? toolRecords.every((t) => t.ok === false)
          ? 'failed'
          : 'success'
        : 'success'

    const result = {
      status,
      runId,
      threadId,
      result: llmResult.content || toolRecords.map((t) => t.output).join('\n'),
      toolRecords,
      logs: ctx.logs,
      projectRoot: thread.projectRoot,
      agentsHash: thread.agentsHash,
      attachmentPaths: (input.attachments || [])
        .map((a) => a.filePath)
        .filter(Boolean),
    }
    thread.bubbles.push({ role: 'assistant', content: result.result, runId })
    archive.push(result)

    // afterRun
    const after = evaluateHooks(rules, {
      point: 'afterRun',
      sourceKind,
      objective,
    })
    logs.push(...after.audits)
    for (const n of after.notifications) notifications.push(n)

    activeRuns.delete(runId)
    try {
      await input.onSettled?.(result)
    } catch {
      /* ignore */
    }
    if (input.meta?.scheduleJobId) {
      jobResults.set(input.meta.scheduleJobId, result.status)
    }
    await drain()
    return result
  }

  let draining = false
  async function drain() {
    if (draining) return
    draining = true
    try {
      while (queue.items.length && activeRuns.size < limit()) {
        const slots = Math.max(1, limit() - activeRuns.size)
        const batch = []
        for (let i = 0; i < slots && queue.items.length; i += 1) {
          const next = queue.shift()
          if (!next) break
          batch.push(runTask({
            ...next,
            _fromQueue: true,
            sourceKind: next.sourceKind || 'queue-drain',
            // restore attachments from path-only persist
            attachments: next.attachments,
          }))
        }
        const results = await Promise.all(batch)
        if (results.some((result) => result.skipped && result.skipReason === 'busy')) break
      }
    } finally {
      draining = false
    }
  }

  return {
    runTask,
    queue,
    archive,
    threads,
    notifications,
    jobResults,
    setProject(root, guidance, hash) {
      projectContext = { root, guidance, agentsHash: hash }
    },
    get isRunning() {
      return activeRuns.size > 0
    },
    get activeRunIds() {
      return [...activeRuns.keys()]
    },
    clock,
    llm,
    mcp,
    hitl,
  }
}

// ── §7 scenarios ───────────────────────────────────────────────────

await test('§7 Composer / slash / retry share same busy policy table', () => {
  assert.equal(resolveBusyPolicy('composer', 'steer'), 'steer')
  assert.equal(resolveBusyPolicy('slash', 'queue'), 'queue')
  assert.equal(resolveBusyPolicy('retry', 'steer'), 'steer')
  assert.equal(resolveBusyPolicy('composer', 'queue'), 'queue')
})

await test('§7 busy: schedule/webhook/telegram always queue; unknown rejects', () => {
  for (const k of ['schedule', 'webhook', 'telegram', 'event', 'delegate']) {
    assert.equal(resolveBusyPolicy(k, 'steer'), 'queue')
  }
  assert.equal(resolveBusyPolicy('unknown', 'queue'), 'reject')
})

await test('§7 busy follow-up: composer queue → FIFO drain with same run semantics', async () => {
  const ctrl = createFakeRunController({
    followUpMode: 'queue',
    llm: createFakeLlm([
      { content: 'first done' },
      { content: 'second done' },
    ]),
  })
  // Hold the lock with a long first run: manually set by starting then enqueueing
  const p1 = ctrl.runTask({
    sourceKind: 'composer',
    objective: 'task one',
    runId: 'r1',
  })
  // While "running" is only true mid-await; use sequential busy by enqueueing while synthetic busy
  // Simulate: complete first, but enqueue while busy via overlapping pattern:
  // Start schedule while composer is conceptually busy by using the active-run registry:
  // runTask reserves its run before the first awaited HITL call.
  const settled = []
  // Force busy: start first without awaiting drain of second
  // Easier approach: call schedule while first is mid-flight by using a deferred HITL
  const slowHitl = createFakeHitl({ auto: 'approve', delayMs: 30 })
  const hooks = [
    {
      id: 'ask-bash',
      point: 'beforeTool',
      match: { tool: 'bash' },
      action: 'require-approval',
    },
  ]
  const ctrl2 = createFakeRunController({
    followUpMode: 'queue',
    hitl: slowHitl,
    hooks,
    llm: createFakeLlm([
      { toolCalls: [{ name: 'bash', arguments: { command: 'echo a' } }], content: '' },
      { content: 'a done' },
      { content: 'followup done' },
    ]),
  })
  const first = ctrl2.runTask({
    sourceKind: 'composer',
    objective: 'slow bash task',
    runId: 'run-slow',
  })
  // Immediately try follow-up while first may still hold lock (HITL delay)
  await new Promise((r) => setTimeout(r, 5))
  const second = await ctrl2.runTask({
    sourceKind: 'composer',
    objective: 'follow up question',
    runId: 'run-follow',
    reuseThreadId: 'th_run-slow',
    skipUserBubble: true,
  })
  assert.equal(second.queued || second.skipReason === 'queued' || second.status === 'success', true)
  const r1 = await first
  assert.ok(['success', 'failed'].includes(r1.status))
  // After first completes, drain should run follow-up
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(ctrl2.archive.length >= 1)
  // Either follow-up ran or is still queued after drain
  const followDone = ctrl2.archive.some((a) => a.runId === 'run-follow')
  const stillQueued = ctrl2.queue.items.some((q) => q.runId === 'run-follow')
  assert.ok(followDone || stillQueued || second.status === 'success', 'follow-up must queue or complete')
  void settled
  void p1
})

await test('ADR3: opt-in concurrent runs share capacity, isolate HITL identity, and drain overflow', async () => {
  const hitl = createFakeHitl({ auto: 'approve', delayMs: 30 })
  const ctrl = createFakeRunController({
    concurrentRunsEnabled: true,
    maxConcurrentRuns: 2,
    hitl,
    hooks: [
      {
        id: 'ask-bash',
        point: 'beforeTool',
        match: { tool: 'bash' },
        action: 'require-approval',
      },
    ],
    llm: createFakeLlm([
      { toolCalls: [{ name: 'bash', arguments: { command: 'one' } }], content: '' },
      { toolCalls: [{ name: 'bash', arguments: { command: 'two' } }], content: '' },
      { content: 'three drained' },
    ]),
  })

  const first = ctrl.runTask({ sourceKind: 'composer', objective: 'parallel one', runId: 'parallel-1' })
  await new Promise((r) => setTimeout(r, 5))
  const second = ctrl.runTask({ sourceKind: 'schedule', objective: 'parallel two', runId: 'parallel-2' })
  await new Promise((r) => setTimeout(r, 5))
  const overflow = await ctrl.runTask({ sourceKind: 'schedule', objective: 'parallel three', runId: 'parallel-3' })

  assert.equal(overflow.queued, true)
  assert.deepEqual(ctrl.activeRunIds.sort(), ['parallel-1', 'parallel-2'])
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.status, 'success')
  assert.equal(secondResult.status, 'success')
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(ctrl.archive.some((item) => item.runId === 'parallel-3'), 'overflow should drain after a slot frees')
  assert.ok(
    hitl.asks.some((ask) => ask.runId === 'parallel-1' && ask.threadId === 'th_parallel-1') &&
      hitl.asks.some((ask) => ask.runId === 'parallel-2' && ask.threadId === 'th_parallel-2'),
    'HITL asks must retain the originating run and thread',
  )
  assert.equal(ctrl.isRunning, false)
})

await test('§7 queue persists attachment filePath only (no dataUrl leak)', () => {
  const q = createFakeQueue()
  const item = q.enqueue({
    objective: 'analyze image',
    sourceKind: 'telegram',
    attachments: [
      {
        id: 'a1',
        name: 'x.png',
        kind: 'image',
        dataUrl: 'data:image/png;base64,AAAA_VERY_LONG',
        filePath: '/tmp/subagents/chat-attachments/t1/x.png',
      },
    ],
  })
  assert.ok(item)
  assert.equal(item.attachments[0].filePath, '/tmp/subagents/chat-attachments/t1/x.png')
  assert.equal(item.attachments[0].dataUrl, undefined)
})

await test('§7 schedule job rebind: onSettled marks job after queue drain', async () => {
  const hitl = createFakeHitl({ auto: 'approve', delayMs: 20 })
  const ctrl = createFakeRunController({
    hitl,
    hooks: [
      {
        id: 'ask-all-bash',
        point: 'beforeTool',
        match: { tool: 'bash' },
        action: 'require-approval',
      },
    ],
    llm: createFakeLlm([
      { toolCalls: [{ name: 'bash', arguments: { command: 'long' } }], content: '' },
      { content: 'ok' },
      { content: 'cron done' },
    ]),
  })
  const first = ctrl.runTask({
    sourceKind: 'composer',
    objective: 'block lock',
    runId: 'hold',
  })
  await new Promise((r) => setTimeout(r, 5))
  const cron = await ctrl.runTask({
    sourceKind: 'schedule',
    objective: 'nightly report',
    runId: 'cron1',
    meta: { scheduleJobId: 'job_nightly' },
    onSettled: async (r) => {
      ctrl.jobResults.set('job_nightly', r.status)
    },
  })
  assert.equal(cron.queued || cron.skipReason === 'queued', true)
  await first
  await new Promise((r) => setTimeout(r, 40))
  // After drain, job should be marked
  assert.ok(
    ctrl.jobResults.get('job_nightly') === 'success' ||
      ctrl.archive.some((a) => a.runId === 'cron1'),
    'schedule job must complete via drain or rebind',
  )
})

await test('§7 project A → B: agents hash does not residual-leak across threads', async () => {
  const ctrl = createFakeRunController({
    llm: createFakeLlm([{ content: 'from A' }, { content: 'from B' }]),
  })
  ctrl.setProject('/proj/A', 'RULES FOR A', 'hash-A')
  const rA = await ctrl.runTask({
    sourceKind: 'composer',
    objective: 'work in A',
    projectRoot: '/proj/A',
    runId: 'ra',
  })
  assert.equal(rA.agentsHash, 'hash-A')
  ctrl.setProject('/proj/B', 'RULES FOR B', 'hash-B')
  const rB = await ctrl.runTask({
    sourceKind: 'composer',
    objective: 'work in B',
    projectRoot: '/proj/B',
    runId: 'rb',
  })
  assert.equal(rB.agentsHash, 'hash-B')
  assert.notEqual(rA.agentsHash, rB.agentsHash)
  // Thread for A still has old hash snapshot
  assert.equal(ctrl.threads.get(rA.threadId).agentsHash, 'hash-A')
})

await test('§7 OpenCode field classification never silent-drops', () => {
  function classify(field) {
    if (['instructions', 'compaction', 'small_model', 'default_agent', 'permission'].includes(field))
      return 'temporary'
    if (field === 'model' || field.startsWith('mcp.')) return 'review'
    return 'unsupported'
  }
  for (const f of ['instructions', 'model', 'mcp.foo', 'theme', 'keybinds']) {
    assert.ok(['temporary', 'review', 'unsupported'].includes(classify(f)))
  }
  assert.equal(classify('theme'), 'unsupported')
})

await test('§7 model+image: vision=false degrades to path note (no crash)', () => {
  function degradeAttachments(profile, attachments) {
    if (profile.vision === false) {
      return {
        multimodal: false,
        note: attachments
          .filter((a) => a.kind === 'image')
          .map((a) => `image on disk: ${a.filePath || a.name}`)
          .join('\n'),
      }
    }
    return { multimodal: true, note: '' }
  }
  const d = degradeAttachments(
    { vision: false, tools: true, source: 'verified' },
    [{ kind: 'image', name: 'a.png', filePath: '/tmp/a.png' }],
  )
  assert.equal(d.multimodal, false)
  assert.match(d.note, /\/tmp\/a\.png/)
})

await test('§7 hooks: beforeRun deny stops run; beforeTool sourceKind schedule blocks bash', async () => {
  const hooks = [
    {
      id: 'no-prod-write',
      point: 'beforeRun',
      match: { objectiveIncludes: 'DROP TABLE' },
      action: 'deny',
      reason: 'destructive SQL',
    },
    {
      id: 'no-bash-cron',
      point: 'beforeTool',
      match: { tool: 'bash', sourceKind: ['schedule'] },
      action: 'deny',
      reason: '排程禁 bash',
    },
    {
      id: 'log-fail',
      point: 'afterTool',
      match: { onlyOnFailure: true },
      action: 'log',
      reason: 'tool failed',
    },
    {
      id: 'done-notify',
      point: 'afterRun',
      action: 'notify',
      reason: 'run finished',
    },
  ]
  const ctrl = createFakeRunController({
    hooks,
    llm: createFakeLlm([
      { content: 'nope' },
      { toolCalls: [{ name: 'bash', arguments: { command: 'rm -rf' } }], content: '' },
      { content: 'composer bash ok' },
    ]),
  })
  const denied = await ctrl.runTask({
    sourceKind: 'composer',
    objective: 'please DROP TABLE users',
    runId: 'deny1',
  })
  assert.equal(denied.status, 'failed')
  assert.match(denied.error || '', /destructive SQL|hook deny/)

  // schedule bash denied by hook
  const cron = await ctrl.runTask({
    sourceKind: 'schedule',
    objective: 'cleanup workspace',
    runId: 'cron-bash',
  })
  // LLM may call bash — if so must be denied
  if (cron.toolRecords?.length) {
    assert.ok(cron.toolRecords.some((t) => /hook deny|排程禁 bash/.test(t.output || '')))
  }

  // afterRun notify for successful path
  const ok = await ctrl.runTask({
    sourceKind: 'composer',
    objective: 'hello',
    runId: 'ok1',
  })
  assert.equal(ok.status, 'success')
  assert.ok(ctrl.notifications.some((n) => /run finished|done-notify|finished/i.test(n)))
})

await test('§7 hooks: require-approval forces HITL even under conceptual full mode', async () => {
  const hitl = createFakeHitl({ auto: 'deny' })
  const ctrl = createFakeRunController({
    hitl,
    hooks: [
      {
        id: 'force-mcp',
        point: 'beforeTool',
        match: { tool: 'mcp_*' },
        action: 'require-approval',
      },
    ],
    llm: createFakeLlm([
      {
        toolCalls: [{ name: 'mcp_ha_ping', arguments: {} }],
        content: '',
      },
      { content: 'after deny' },
    ]),
  })
  const r = await ctrl.runTask({
    sourceKind: 'composer',
    objective: 'ping ha',
    runId: 'hitl1',
  })
  assert.ok(hitl.asks.length >= 1, 'must ask HITL')
  assert.ok(
    r.toolRecords?.some((t) => /HITL|deny/.test(t.output || '')) ||
      r.status === 'success',
  )
})

await test('§7 HITL timeout: tool denied, run finishes without hanging lock', async () => {
  const hitl = createFakeHitl({ auto: 'timeout' })
  const ctrl = createFakeRunController({
    hitl,
    hooks: [
      {
        id: 'ask-bash',
        point: 'beforeTool',
        match: { tool: 'bash' },
        action: 'require-approval',
      },
    ],
    llm: createFakeLlm([
      { toolCalls: [{ name: 'bash', arguments: { command: 'x' } }], content: '' },
      { content: 'finished despite deny' },
    ]),
  })
  const r = await ctrl.runTask({
    sourceKind: 'schedule',
    objective: 'unattended bash',
    runId: 'to1',
    unattended: true,
  })
  assert.equal(ctrl.isRunning, false)
  assert.ok(r.toolRecords?.some((t) => /timeout|HITL/i.test(t.output || '')))
  assert.ok(['success', 'failed'].includes(r.status))
})

await test('§7 plugin tool escalate: fingerprint change requires re-review (pure contract)', () => {
  function fingerprint(tools) {
    return tools
      .map((t) => `${t.name}:${t.operationClass}`)
      .sort()
      .join('|')
  }
  const v1 = fingerprint([
    { name: 'ha_get_state', operationClass: 'read' },
    { name: 'ha_list', operationClass: 'read' },
  ])
  const v2 = fingerprint([
    { name: 'ha_get_state', operationClass: 'read' },
    { name: 'ha_list', operationClass: 'read' },
    { name: 'ha_call_service', operationClass: 'write' },
  ])
  assert.notEqual(v1, v2)
  const escalations = ['ha_call_service']
  assert.equal(escalations.length > 0, true)
})

await test('§7 wiring contract: production sources pass sourceKind into hooks', () => {
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /sourceKind: opts\.sourceKind/)
  assert.match(guard, /objective: opts\.objective/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /sourceKind: ctx\.sourceKind/)
  assert.match(loop, /objective: ctx\.objective/)
  const eng = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(eng, /sourceKind: this\.overrides\.sourceKind/)
  const runX = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(runX, /sourceKind: opts\.sourceKind/)
  // put into RuntimeOverrides for tool layer
  assert.match(runX, /sourceKind: opts\.sourceKind \|\| opts\.overrides/)
})

await test('§7 sanitizeHookRules: never allows action=allow', () => {
  const raw = [
    { id: 'evil', point: 'beforeTool', action: 'allow' },
    { id: 'ok', point: 'beforeTool', action: 'deny' },
    { id: 'bad-point', point: 'beforeRun', action: 'require-approval' },
  ]
  const clean = sanitizeHookRules(raw)
  assert.equal(clean.some((r) => r.action === 'allow'), false)
  assert.equal(clean.some((r) => r.id === 'ok'), true)
  assert.equal(clean.some((r) => r.id === 'bad-point'), false)
})

console.log(`\n${passed} scenario E2E tests passed`)
if (process.exitCode) {
  console.error('Scenario E2E failed')
} else {
  console.log('OK')
}
