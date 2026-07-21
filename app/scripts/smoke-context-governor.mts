/**
 * Context Governor pure-module smoke — real import of createContextGovernor.
 * Run: node --experimental-strip-types scripts/smoke-context-governor.mts
 */
import assert from 'node:assert/strict'
import {
  createContextGovernor,
  type CompactResult,
  type ContextGovernorDeps,
  type GovernorMessage,
} from '../src/agent/tools/contextGovernor.ts'
import type { LlmSettings } from '../src/agent/types.ts'

let passed = 0
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((e) => {
      console.error(`  ✗ ${name}`)
      throw e
    })
}

function settings(partial: Partial<LlmSettings> = {}): LlmSettings {
  return {
    enabled: true,
    apiProvider: 'custom',
    baseUrl: '',
    apiKey: '',
    model: 'test',
    fallbackModels: [],
    discoveredModels: [],
    roleModels: { orchestrator: '', analyst: '', synthesizer: '', executor: '' },
    subAgentsEnabled: false,
    authLevel: 2,
    minConfidence: 0.8,
    maxIterationsDefault: 5,
    safetyEnabled: true,
    toolsEnabled: true,
    webSearchEnabled: true,
    llmRetryMaxAttempts: 3,
    llmCircuitBreakerEnabled: true,
    defaultContextWindowTokens: 8_000,
    functionCalling: true,
    llmParseEnabled: true,
    sessionRecallEnabled: true,
    haltOnPayloadOverflow: false,
    maxToolPayloadKb: 50,
    maxToolRounds: 4,
    webhookEnabled: false,
    webhookPort: 8787,
    webhookToken: '',
    webhookTarget: '',
    customTools: [],
    customToolSecrets: {},
    pluginOAuthClients: {},
    mcpEnabled: false,
    mcpServers: [],
    mcpAgentServers: {},
    telegramEnabled: false,
    telegramBotToken: '',
    telegramAllowedChatIds: '',
    telegramAutoRun: true,
    telegramReplyWithResult: true,
    cliProviders: [],
    bashRequireAsk: true,
    approvalMode: 'auto',
    capabilitiesEnabled: true,
    alwaysOnCapabilities: [],
    toolSearchEnabled: true,
    toolSearchThreshold: 24,
    codeModeEnabled: true,
    modelProfiles: {},
    hookRules: [],
    trustedHookProjects: [],
    delegatePersonas: {},
    theme: 'dark',
    reducedMotion: 'system',
    uiFontSize: 14,
    codeFontSize: 13,
    translucentSidebar: true,
    enterBehavior: 'enter',
    memoryEnabled: true,
    memoryWriteEnabled: true,
    ...partial,
  } as LlmSettings
}

function msgs(n: number, content = 'x'.repeat(100)): GovernorMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }))
}

type CallLog = { name: string; args?: unknown }

function makeDeps(overrides: Partial<ContextGovernorDeps> = {}) {
  const calls: CallLog[] = []
  const compactResult: CompactResult = {
    messages: [
      { role: 'system', content: '## Context compaction\nsummary' },
      { role: 'user', content: 'recent' },
    ],
    compacted: true,
    summary: 'summary',
  }
  const deps: ContextGovernorDeps = {
    compact: async (_s, messages) => {
      calls.push({ name: 'compact', args: { n: messages.length } })
      return { ...compactResult, messages: compactResult.messages.slice() }
    },
    saveCheckpoint: (id, payload) => {
      calls.push({ name: 'saveCheckpoint', args: { id, n: payload.messages.length, summary: payload.summary } })
    },
    memoryFlush: () => {
      calls.push({ name: 'memoryFlush' })
      return true
    },
    memoryRecall: () => {
      calls.push({ name: 'memoryRecall' })
      return [{ text: 'recalled fact' }]
    },
    evaluateHook: (point) => {
      calls.push({ name: 'evaluateHook', args: { point } })
      return { audits: [`hook:${point}`], notifications: point === 'afterCompaction' ? ['n1'] : [] }
    },
    bumpMetric: () => {
      calls.push({ name: 'bumpMetric' })
    },
    notify: (title, body) => {
      calls.push({ name: 'notify', args: { title, body } })
    },
    log: (level, message) => {
      calls.push({ name: 'log', args: { level, message } })
    },
    contentToPlainText: () => '',
    ...overrides,
  }
  return { deps, calls, compactResult }
}

console.log('smoke-context-governor')

await test('fixed-round trigger: round 1 and even rounds call compact', async () => {
  const { deps, calls } = makeDeps()
  const g = createContextGovernor(deps)
  const base = msgs(4)
  await g.beforeRound({
    messages: base,
    round: 1,
    toolsEstimateText: '[]',
    settings: settings(),
  })
  assert.ok(calls.some((c) => c.name === 'compact'), 'round 1 should compact')
  calls.length = 0
  await g.beforeRound({
    messages: base,
    round: 2,
    toolsEstimateText: '[]',
    settings: settings(),
  })
  assert.ok(calls.some((c) => c.name === 'compact'), 'round 2 even should compact')
  calls.length = 0
  // Round 3 without overflow may still compact under fixed formula (round%2===0 is false for 3)
  // only if overflow — with small messages and large window, no compact
  await g.beforeRound({
    messages: base,
    round: 3,
    toolsEstimateText: '[]',
    settings: settings({ defaultContextWindowTokens: 1_000_000 }),
  })
  assert.equal(calls.filter((c) => c.name === 'compact').length, 0, 'odd round without overflow skips')
})

await test('vision attachments skip compact and do not call compact dep', async () => {
  const { deps, calls } = makeDeps()
  const g = createContextGovernor(deps)
  // Multiple image parts → estimated tokens >> preflight threshold
  const visionMsgs: GovernorMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'see' },
        { type: 'image_url', image_url: { url: 'data:x' } },
        { type: 'image_url', image_url: { url: 'data:y' } },
      ],
    },
  ]
  await g.beforeRound({
    messages: visionMsgs,
    round: 1,
    toolsEstimateText: '[]',
    settings: settings({ defaultContextWindowTokens: 2_000 }),
  })
  assert.equal(calls.filter((c) => c.name === 'compact').length, 0)
  assert.ok(
    calls.some(
      (c) =>
        c.name === 'log' &&
        /影像無法壓縮/.test(String((c.args as { message?: string })?.message)),
    ),
  )
})

await test('compaction fires effects in order; checkpoint gets pre-compact messages', async () => {
  const pre: GovernorMessage[] = msgs(6, 'original-pre')
  const { deps, calls } = makeDeps({
    compact: async (_s, messages) => {
      calls.push({ name: 'compact', args: { first: messages[0]?.content } })
      return {
        compacted: true,
        summary: 'sum',
        messages: [
          { role: 'system', content: '## Context compaction\nsum' },
          { role: 'user', content: 'post' },
        ],
      }
    },
  })
  const g = createContextGovernor(deps)
  const out = await g.beforeRound({
    messages: pre,
    round: 1,
    toolsEstimateText: '[]',
    settings: settings(),
    runId: 'run1',
    objective: 'obj',
  })
  const names = calls.map((c) => c.name)
  // order: compact → beforeHook → checkpoint → flush → (replace) → recall → log → metric → afterHook → notify
  const compactIdx = names.indexOf('compact')
  const beforeIdx = names.findIndex((n, i) => n === 'evaluateHook' && i > compactIdx)
  const ckIdx = names.indexOf('saveCheckpoint')
  const flushIdx = names.indexOf('memoryFlush')
  const recallIdx = names.indexOf('memoryRecall')
  const metricIdx = names.indexOf('bumpMetric')
  const afterIdx = names.lastIndexOf('evaluateHook')
  const notifyIdx = names.indexOf('notify')
  assert.ok(compactIdx < beforeIdx && beforeIdx < ckIdx && ckIdx < flushIdx)
  assert.ok(flushIdx < recallIdx && recallIdx < metricIdx && metricIdx < afterIdx && afterIdx < notifyIdx)

  const ck = calls.find((c) => c.name === 'saveCheckpoint')
  assert.equal((ck?.args as { n: number }).n, pre.length, 'checkpoint gets pre-compact count')
  assert.match(String((ck?.args as { summary: string }).summary), /sum/)
  assert.ok(out.some((m) => m.content === 'post'))
  assert.ok(
    out.some(
      (m) => typeof m.content === 'string' && m.content.includes('壓縮後記憶召回'),
    ),
    'memory recall appended',
  )
})

await test('prune-only replaces messages without full compaction effects', async () => {
  const { deps, calls } = makeDeps({
    compact: async () => ({
      compacted: false,
      messages: [{ role: 'user', content: 'pruned' }],
      pruneStats: { changed: true, softTrimmed: 2, hardCleared: 0, savedChars: 50 },
    }),
  })
  const g = createContextGovernor(deps)
  const out = await g.beforeRound({
    messages: msgs(3),
    round: 1,
    toolsEstimateText: '[]',
    settings: settings(),
  })
  assert.equal(out[0]?.content, 'pruned')
  assert.equal(calls.filter((c) => c.name === 'saveCheckpoint').length, 0)
  assert.equal(calls.filter((c) => c.name === 'memoryFlush').length, 0)
  assert.equal(calls.filter((c) => c.name === 'memoryRecall').length, 0)
  assert.ok(calls.some((c) => c.name === 'log' && /pruning:soft-trim/.test(String((c.args as { message?: string })?.message))))
})

await test('independent fault isolation: one effect throw does not block others', async () => {
  const { deps, calls } = makeDeps({
    saveCheckpoint: () => {
      calls.push({ name: 'saveCheckpoint' })
      throw new Error('ck fail')
    },
    memoryFlush: () => {
      calls.push({ name: 'memoryFlush' })
      throw new Error('flush fail')
    },
  })
  const g = createContextGovernor(deps)
  await g.beforeRound({
    messages: msgs(3),
    round: 1,
    toolsEstimateText: '[]',
    settings: settings(),
  })
  assert.ok(calls.some((c) => c.name === 'memoryRecall'), 'recall still runs after flush throw')
  assert.ok(calls.some((c) => c.name === 'bumpMetric'), 'metric still runs')
  assert.ok(calls.some((c) => c.name === 'notify'), 'notify still runs')
})

await test('two governor instances do not share usage-bucket state', async () => {
  const logsA: string[] = []
  const logsB: string[] = []
  // Force 50%+ usage with tiny window and non-empty messages
  const s = settings({ defaultContextWindowTokens: 200 })
  const big = msgs(5, 'word '.repeat(80))
  const gA = createContextGovernor({
    ...makeDeps().deps,
    log: (_l, m) => logsA.push(m),
    compact: async (_s, m) => ({ compacted: false, messages: m }),
  })
  const gB = createContextGovernor({
    ...makeDeps().deps,
    log: (_l, m) => logsB.push(m),
    compact: async (_s, m) => ({ compacted: false, messages: m }),
  })
  await gA.beforeRound({ messages: big, round: 3, toolsEstimateText: '[]', settings: s })
  await gB.beforeRound({ messages: big, round: 3, toolsEstimateText: '[]', settings: s })
  // Both should independently emit usage log if crossing threshold
  const usageA = logsA.filter((m) => /context 使用率/.test(m)).length
  const usageB = logsB.filter((m) => /context 使用率/.test(m)).length
  assert.equal(usageA, usageB, 'independent instances same first-crossing behavior')
})

await test('unchanged path returns the same message array reference', async () => {
  const { deps } = makeDeps({
    compact: async (_s, m) => ({ compacted: false, messages: m }),
  })
  const g = createContextGovernor(deps)
  const pre = msgs(3)
  // Odd round + large window → no compact trigger
  const out = await g.beforeRound({
    messages: pre,
    round: 3,
    toolsEstimateText: '[]',
    settings: settings({ defaultContextWindowTokens: 1_000_000 }),
  })
  assert.equal(out, pre, 'identity: skip path must return inputMessages reference')
})

await test('toolLoop wires ContextEngine (default wraps createContextGovernor)', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/contextEngine.ts'), 'utf8')
  assert.match(loop, /createDefaultContextEngine/)
  assert.match(loop, /contextEngine\.prepareRound/)
  assert.match(engine, /createContextGovernor/)
})

console.log(`\n${passed} tests passed`)
