/**
 * Pure-logic smoke tests for capability runtime + compaction alignment.
 * Run: node scripts/smoke-caps.mjs  (via tsx import of TS source)
 * Or:  npx tsx scripts/smoke-caps.mjs
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

let passed = 0
let skipped = 0

async function test(name, fn) {
  try {
    const result = await fn()
    if (result?.skipped) {
      console.log(`  · ${name} (skipped: ${result.reason})`)
      skipped++
      return
    }
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(e)
    process.exitCode = 1
  }
}

console.log('Capability / compaction smoke\n')

// Dynamic import of TS via tsx-compatible relative path won't work under plain node.
// Mirror critical pure logic here so smoke never depends on electron/tsx.

// ── alignKeepStart (from compaction.ts) ──
function alignKeepStart(body, keepRecent) {
  let start = Math.max(0, body.length - keepRecent)
  while (start > 0 && body[start]?.role === 'tool') {
    start -= 1
  }
  if (start > 0 && body[start]?.role === 'tool') {
    let i = start
    while (i > 0 && body[i]?.role === 'tool') i -= 1
    if (body[i]?.role === 'assistant' && body[i]?.tool_calls?.length) start = i
  }
  return start
}

await test('alignKeepStart does not orphan tool messages', () => {
  const body = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
    { role: 'tool', content: 'ok', tool_call_id: '1' },
    { role: 'assistant', content: 'done' },
  ]
  // keepRecent=2 would naively start at tool message
  const start = alignKeepStart(body, 2)
  assert.ok(start <= 1, `start=${start} should include assistant tool_calls parent`)
  assert.equal(body[start].role, 'assistant')
  assert.ok(body[start].tool_calls?.length)
})

// ── blockedTools capability strip (from assembleCapabilities) ──
function stripBlockedCaps(all, blockedTools) {
  const blocked = new Set((blockedTools || []).map(String))
  if (!blocked.size) return all
  return all
    .map((c) => {
      const tools = (c.tools || []).filter((t) => !blocked.has(t))
      const toolNames = (c.toolNames || []).filter((t) => !blocked.has(t))
      return { ...c, tools, toolNames }
    })
    .filter((c) => {
      const hasTools =
        (c.tools?.length || 0) > 0 ||
        (c.toolNames?.length || 0) > 0 ||
        (c.toolNamePrefixes?.length || 0) > 0
      const instructionOnly = !!c.instructions && !hasTools && c.source === 'skill'
      if (instructionOnly) return true
      if (!hasTools && c.source !== 'skill') return false
      return true
    })
}

await test('blockedTools strips empty capabilities from catalog', () => {
  const all = [
    { id: 'skills', tools: ['skill_list', 'skill_save'], source: 'builtin' },
    { id: 'core-utils', tools: ['datetime_now'], source: 'builtin' },
    { id: 'skill:x', tools: [], instructions: 'runbook', source: 'skill' },
  ]
  const next = stripBlockedCaps(all, ['skill_list', 'skill_save'])
  assert.equal(next.some((c) => c.id === 'skills'), false, 'skills cap removed')
  assert.equal(next.some((c) => c.id === 'core-utils'), true)
  assert.equal(next.some((c) => c.id === 'skill:x'), true, 'instruction-only skill kept')
})

// ── approvalRequiredFor ──
function approvalRequiredFor(state, toolName) {
  return state.all.some(
    (c) =>
      (state.loadedIds.has(c.id) || !c.deferLoading) &&
      c.approvalTools?.includes(toolName),
  )
}

await test('approvalRequiredFor only when capability active', () => {
  const state = {
    all: [
      { id: 'shell', deferLoading: true, approvalTools: ['bash'] },
      { id: 'code-mode', deferLoading: true, approvalTools: ['run_code'] },
    ],
    loadedIds: new Set(['shell']),
  }
  assert.equal(approvalRequiredFor(state, 'bash'), true)
  assert.equal(approvalRequiredFor(state, 'run_code'), false)
})

// ── A3/A4 intent + project preload policy (from runDispatch.ts) ──
function preloadCapabilities(intentTools, capabilities, projectRoot) {
  const selected = capabilities
    .filter((cap) => cap.id !== 'core-utils' && cap.tools.some((tool) => intentTools.includes(tool)))
    .map((cap) => cap.id)
    .slice(0, 2)
  if (projectRoot) {
    for (const id of ['codegraph', 'workspace']) if (!selected.includes(id)) selected.push(id)
  }
  return selected
}

await test('intent preload is capped and project preload adds codegraph/workspace', () => {
  const capabilities = [
    { id: 'core-utils', tools: ['datetime_now'] },
    { id: 'web-research', tools: ['web_search'] },
    { id: 'workspace', tools: ['workspace_read'] },
    { id: 'codegraph', tools: ['codegraph_explore'] },
  ]
  assert.deepEqual(preloadCapabilities(['web_search'], capabilities, ''), ['web-research'])
  assert.deepEqual(preloadCapabilities(['web_search'], capabilities, '/repo'), ['web-research', 'codegraph', 'workspace'])
})

// ── B4 model-aware tool budget (from modelTuning.ts) ──
function recommendToolTuning(model) {
  const id = model.toLowerCase()
  const context = id.includes('128k') ? 128000 : id.includes('16k') ? 16000 : null
  if (context === 128000) return { threshold: 36, payload: 64, rounds: 6 }
  if (context === 16000) return { threshold: 12, payload: 24, rounds: 3 }
  return { threshold: 24, payload: 50, rounds: 4 }
}

await test('model tuning preserves baseline and shrinks small-context budgets', () => {
  assert.deepEqual(recommendToolTuning('unknown'), { threshold: 24, payload: 50, rounds: 4 })
  assert.deepEqual(recommendToolTuning('model-16k'), { threshold: 12, payload: 24, rounds: 3 })
  assert.deepEqual(recommendToolTuning('model-128k'), { threshold: 36, payload: 64, rounds: 6 })
})

// ── applyToolSearchVisibility ──
function applyToolSearchVisibility(state, defs, threshold) {
  const nonFramework = defs.filter((d) => d.name !== 'load_capability' && d.name !== 'tool_search')
  if (nonFramework.length <= threshold) return { defs, hiddenCount: 0 }
  const kept = defs.filter((d) => {
    if (d.name === 'load_capability' || d.name === 'tool_search') return true
    if (state.unlocked.has(d.name)) return true
    return state.alwaysOnTools.has(d.name)
  })
  return { defs: kept, hiddenCount: defs.length - kept.length }
}

await test('tool search hides over threshold except unlocked/always-on', () => {
  const defs = [
    { name: 'load_capability' },
    { name: 'datetime_now' },
    { name: 'web_search' },
    { name: 'bash' },
    { name: 'workspace_read' },
  ]
  const state = {
    unlocked: new Set(['bash']),
    alwaysOnTools: new Set(['datetime_now']),
  }
  const r = applyToolSearchVisibility(state, defs, 2)
  assert.ok(r.hiddenCount > 0)
  const names = r.defs.map((d) => d.name)
  assert.ok(names.includes('datetime_now'))
  assert.ok(names.includes('bash'))
  assert.ok(names.includes('load_capability'))
  assert.equal(names.includes('web_search'), false)
})

// ── queue dedupe ──
function dedupeKey(opts) {
  return [
    (opts.objective || '').trim().slice(0, 200),
    opts.loopType || '',
    opts.sourceLabel || '',
  ].join('|')
}

await test('automation queue dedupe key', () => {
  const a = dedupeKey({ objective: '  run me  ', loopType: 'Time-based', sourceLabel: 'cron' })
  const b = dedupeKey({ objective: 'run me', loopType: 'Time-based', sourceLabel: 'cron' })
  assert.equal(a, b)
  const c = dedupeKey({ objective: 'run me', loopType: 'Proactive', sourceLabel: 'cron' })
  assert.notEqual(a, c)
})

await test('runQueue remove/clear/hydrate APIs exist in source', async () => {
  const fs = await import('node:fs')
  const p = path.join(appRoot, 'src/agent/runQueue.ts')
  const src = fs.readFileSync(p, 'utf8')
  assert.match(src, /export function removeQueuedRun/)
  assert.match(src, /export function clearRunQueue/)
  assert.match(src, /export function hydrateRunQueue/)
  assert.match(src, /subagents\.runQueue\.v1/)
  assert.match(src, /skipReason:\s*'cancelled'/)
})

await test('permissionAskStore tracks timedOut + runStats for archive', async () => {
  const fs = await import('node:fs')
  const p = path.join(appRoot, 'src/store/permissionAskStore.ts')
  const src = fs.readFileSync(p, 'utf8')
  assert.match(src, /timedOut/)
  assert.match(src, /recentTimeouts/)
  assert.match(src, /resetStats/)
  assert.match(src, /beginRunAudit/)
  assert.match(src, /getRunHitlSnapshot/)
  assert.match(src, /runStats/)
})

// ── codeMode worker source must disable fetch ──
await test('codeMode worker source disables fetch', async () => {
  const fs = await import('node:fs')
  const p = path.join(appRoot, 'src/agent/tools/codeMode.ts')
  const src = fs.readFileSync(p, 'utf8')
  assert.match(src, /self\.fetch\s*=\s*undefined/)
})

// ── approvalMode decision (mirror of toolGuard.decideApprovalNeed) ──
const SIDE_EFFECT_TOOLS = new Set([
  'bash',
  'workspace_write',
  'http_fetch',
  'web_search',
  'message_send',
  'mcp_call',
  'skill_save',
  'memory_set',
  'memory_append',
  'run_code',
  'delegate_task',
])
function isSideEffectTool(tool) {
  return SIDE_EFFECT_TOOLS.has(tool) || tool.startsWith('mcp_')
}
function decideApprovalNeed(mode, tool, baseNeedAsk, sideEffectHint = false) {
  if (mode === 'full') return false
  if (mode === 'always') return baseNeedAsk || sideEffectHint || isSideEffectTool(tool)
  return baseNeedAsk
}
function effectiveApprovalMode(mode, unattended) {
  const m = mode || 'auto'
  if (m === 'full' && unattended) return 'auto'
  return m
}

await test('approvalMode: full skips asks, always asks side-effect tools, auto passes through', () => {
  // full 模式：即使 capability/pattern 要求 ask 也放行
  assert.equal(decideApprovalNeed('full', 'run_code', true), false)
  assert.equal(decideApprovalNeed('full', 'bash', true), false)
  // always 模式：副作用工具一律 ask（含動態 mcp_*），唯讀工具不 ask
  assert.equal(decideApprovalNeed('always', 'workspace_write', false), true)
  assert.equal(decideApprovalNeed('always', 'mcp_srv1_createIssue', false), true)
  assert.equal(decideApprovalNeed('always', 'workspace_read', false), false)
  assert.equal(decideApprovalNeed('always', 'datetime_now', false), false)
  // always 模式：任意名稱的自訂 http/bash 工具靠 sideEffect hint 補網
  assert.equal(decideApprovalNeed('always', 'jira_search', false, true), true)
  assert.equal(decideApprovalNeed('auto', 'jira_search', false, true), false)
  // auto 模式：只看 base 訊號（policy / bash pattern / capability approvalTools）
  assert.equal(decideApprovalNeed('auto', 'bash', true), true)
  assert.equal(decideApprovalNeed('auto', 'workspace_write', false), false)
})

await test('approvalMode: unattended downgrades full → auto (never unsupervised full access)', () => {
  assert.equal(effectiveApprovalMode('full', true), 'auto')
  assert.equal(effectiveApprovalMode('full', false), 'full')
  assert.equal(effectiveApprovalMode('always', true), 'always')
  assert.equal(effectiveApprovalMode(undefined, true), 'auto')
})

// ── external CLI approval mapping (from cliApproval.ts/localCliRunner.ts) ──
function resolveCliApproval(kind, mode, unattended, agentMode) {
  const requested = mode || 'auto'
  if (requested === 'full' && unattended) return { mode: 'auto', permissive: false }
  if (requested !== 'full') return { mode: requested, permissive: false }
  if (agentMode === 'plan') return { mode: 'auto', permissive: false }
  if (kind === 'codex' || kind === 'claude' || kind === 'grok' || kind === 'cursor') {
    return { mode: 'full', permissive: true }
  }
  return { mode: 'auto', permissive: false }
}

await test('CLI approval + headless flags for all runners', async () => {
  assert.deepEqual(resolveCliApproval('codex', 'full', false, 'build'), { mode: 'full', permissive: true })
  assert.deepEqual(resolveCliApproval('claude', 'full', false, 'build'), { mode: 'full', permissive: true })
  assert.deepEqual(resolveCliApproval('codex', 'full', true, 'build'), { mode: 'auto', permissive: false })
  assert.deepEqual(resolveCliApproval('claude', 'full', false, 'plan'), { mode: 'auto', permissive: false })
  assert.deepEqual(resolveCliApproval('grok', 'full', false, 'build'), { mode: 'full', permissive: true })
  assert.deepEqual(resolveCliApproval('cursor', 'full', false, 'build'), { mode: 'full', permissive: true })
  const fs = await import('node:fs')
  const source = fs.readFileSync(path.join(appRoot, 'electron/localCliRunner.ts'), 'utf8')
  // Codex: non-interactive exec + JSONL (never bare TUI / never legacy-only --full-auto as sole path)
  assert.match(source, /exec --json/)
  assert.match(source, /--dangerously-bypass-approvals-and-sandbox/)
  assert.match(source, /--dangerously-skip-permissions/)
  // Claude stream-json requires --verbose
  assert.match(source, /stream-json/)
  assert.match(source, /--verbose/)
  // Grok headless
  assert.match(source, /case 'grok'/)
  assert.match(source, /-p \$\{q\}|--single/)
  assert.match(source, /--always-approve/)
  assert.match(source, /streaming-json/)
  // Cursor print mode, OpenCode run
  assert.match(source, /case 'cursor'/)
  assert.match(source, /case 'opencode'/)
  assert.match(source, /opencode.*run|run \$\{modelFlag\}/)
  assert.match(source, /stripAnsi/)
  assert.match(source, /createCliStreamParser|onStream/)
  // No interactive bare fallbacks that hang Electron
  assert.doesNotMatch(source, /\$\{binQ\} \$\{modelFlag\} \$\{q\}/)
  const discover = fs.readFileSync(path.join(appRoot, 'electron/cliDiscover.ts'), 'utf8')
  assert.match(discover, /whichCodex|whichCursorAgent/)
})

await test('custom tools: bash_template always approval-gated; toolLoop passes sideEffect hint', async () => {
  const fs = await import('node:fs')
  const custom = fs.readFileSync(path.join(appRoot, 'src/agent/tools/customTools.ts'), 'utf8')
  assert.match(custom, /kind === 'bash_template' \|\| tool\.requiresApproval === true/)
  assert.match(custom, /\^\[A-Za-z\]\[A-Za-z0-9_-\]\{0,63\}\$/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /sideEffect: Boolean\(custom\)/)
  assert.match(loop, /sideEffect: Boolean\(ctx\.customMap\.get\(name\)\)/)
})

await test('side-effect drift guard: every registry tool is read-only OR classified', async () => {
  const fs = await import('node:fs')
  const registry = fs.readFileSync(path.join(appRoot, 'src/agent/tools/registry.ts'), 'utf8')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  const builtins = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/builtins.ts'), 'utf8')

  // All ToolName union members
  const names = [...registry.matchAll(/^\s*\|\s*'([a-z0-9_]+)'/gm)].map((m) => m[1])
  assert.ok(names.length >= 20, `parsed ${names.length} tool names from registry`)

  // 唯讀白名單：新工具必須加入這裡「或」進 SIDE_EFFECT_TOOLS / approvalTools，二選一
  const READ_ONLY = new Set([
    'workspace_list', 'workspace_read', 'datetime_now',
    'memory_get', 'memory_search',
    'skill_list', 'skill_load',
    'mcp_list_tools',
    'delegate_status',
    'json_extract_lite', 'table_parse',
    'codegraph_explore', 'codegraph_status', 'codegraph_impact', 'codegraph_callers',
  ])
  const sideEffectBlock = guard.slice(
    guard.indexOf('SIDE_EFFECT_TOOLS'),
    guard.indexOf('])', guard.indexOf('SIDE_EFFECT_TOOLS')),
  )
  const unclassified = names.filter(
    (n) =>
      !READ_ONLY.has(n) &&
      !sideEffectBlock.includes(`'${n}'`) &&
      !builtins.includes(`approvalTools: ['${n}'`) &&
      !new RegExp(`approvalTools:\\s*\\[[^\\]]*'${n}'`).test(builtins),
  )
  assert.deepEqual(
    unclassified,
    [],
    `未分類工具（請加入 READ_ONLY 白名單、SIDE_EFFECT_TOOLS 或 capability approvalTools）: ${unclassified.join(', ')}`,
  )
})

await test('toolGuard source wires decideApprovalNeed + full-mode safety bypass exists in engine', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /decideApprovalNeed/)
  assert.match(guard, /approvalMode/)
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(engine, /approvalMode === 'full'/)
})

// ── W1: runTask busy policy (mirror of runExternal.resolveBusyPolicy) ──
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

await test('W1: busy policy — automation queues, interactive follows followUpMode, unknown rejects', () => {
  for (const k of ['schedule', 'webhook', 'telegram', 'event', 'delegate', 'queue-drain']) {
    assert.equal(resolveBusyPolicy(k, 'steer'), 'queue', k)
  }
  assert.equal(resolveBusyPolicy('composer', 'steer'), 'steer')
  assert.equal(resolveBusyPolicy('composer', 'queue'), 'queue')
  assert.equal(resolveBusyPolicy('slash', undefined), 'steer')
  assert.equal(resolveBusyPolicy('retry', 'queue'), 'queue')
  assert.equal(resolveBusyPolicy(undefined, 'steer'), 'reject')
})

await test('W1: entry drift guard — no dispatchThreadTask outside controller', async () => {
  const fs = await import('node:fs')
  const files = [
    'src/pages/ProtocolsPage.tsx',
    'src/hooks/useSlashExecutor.ts',
    'src/App.tsx',
    'src/pages/FailedPage.tsx',
    'src/pages/RecordsPage.tsx',
    'src/pages/LogsPage.tsx',
    'src/pages/SuccessPage.tsx',
    'src/pages/EventsPage.tsx',
    'src/pages/AutomationPage.tsx',
  ]
  for (const f of files) {
    const src = fs.readFileSync(path.join(appRoot, f), 'utf8')
    assert.equal(
      /dispatchThreadTask\s*\(/.test(src),
      false,
      `${f} 不可直呼 dispatchThreadTask — 必須走 runTask/runExternalObjective`,
    )
  }
  const controller = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(controller, /resolveBusyPolicy/)
  assert.match(controller, /runId/)
})

// ── W3: config candidates — every field temporary / review / unsupported ──
function classifyOpenCodeField(field) {
  if (['instructions', 'compaction', 'small_model', 'default_agent', 'permission'].includes(field))
    return 'temporary'
  if (field === 'model' || field.startsWith('mcp.')) return 'review'
  return 'unsupported'
}

await test('W3: opencode fields classify to temporary / review / unsupported — never silent', () => {
  assert.equal(classifyOpenCodeField('instructions'), 'temporary')
  assert.equal(classifyOpenCodeField('compaction'), 'temporary')
  assert.equal(classifyOpenCodeField('model'), 'review')
  assert.equal(classifyOpenCodeField('mcp.linear'), 'review')
  assert.equal(classifyOpenCodeField('theme'), 'unsupported')
  assert.equal(classifyOpenCodeField('keybinds'), 'unsupported')
})

await test('W3: mcp candidate mapping (url → http, command → stdio, no secrets)', () => {
  function mcpCandidateToServer(name, raw) {
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.url === 'string') return { name, transport: 'http', url: raw.url }
    const cmd = raw.command
    if (Array.isArray(cmd) && cmd.length)
      return { name, transport: 'stdio', command: String(cmd[0]), args: cmd.slice(1).map(String) }
    if (typeof cmd === 'string' && cmd.trim()) {
      const [head, ...rest] = cmd.trim().split(/\s+/)
      return { name, transport: 'stdio', command: head, args: rest }
    }
    return null
  }
  assert.deepEqual(mcpCandidateToServer('a', { url: 'http://x/mcp' }), {
    name: 'a',
    transport: 'http',
    url: 'http://x/mcp',
  })
  assert.deepEqual(mcpCandidateToServer('b', { command: ['npx', 'server'] }), {
    name: 'b',
    transport: 'stdio',
    command: 'npx',
    args: ['server'],
  })
  assert.equal(mcpCandidateToServer('c', {}), null)
})

await test('W2: project context wiring contract (IPC + preload + engine + promptBuilder)', async () => {
  const fs = await import('node:fs')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(main, /project:agentsDocs/)
  assert.match(main, /AGENTS\.md/)
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  assert.match(preload, /agentsDocs/)
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(engine, /resolveProjectContext/)
  assert.match(engine, /projectGuidance/)
  const pb = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  assert.match(pb, /projectGuidance/)
})

// ── P1-A: credential vault contract ──
await test('P1-A vault: renderer never reads raw tokens; main resolves placeholders', async () => {
  const fs = await import('node:fs')
  const renderer = fs.readFileSync(
    path.join(appRoot, 'src/agent/hermes/pluginSecrets.ts'),
    'utf8',
  )
  // Electron path of getPluginSecret must return null (raw = browser fallback only)
  assert.match(renderer, /if \(vaultApi\(\)\) return null/)
  assert.match(renderer, /hydratePluginSecrets/)
  assert.match(renderer, /removeItem\(STORAGE_KEY\)/) // one-time migration cleans localStorage

  const vault = fs.readFileSync(path.join(appRoot, 'electron/secretsVault.ts'), 'utf8')
  assert.match(vault, /safeStorage/)
  assert.match(vault, /resolveSecretPlaceholders/)

  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(main, /secrets:list/)
  assert.match(main, /secrets:refresh/)
  assert.match(main, /resolveSecretPlaceholders/) // tools:httpRequest + mcp:httpRpc

  const mcpBridge = fs.readFileSync(path.join(appRoot, 'electron/mcpBridge.ts'), 'utf8')
  assert.match(mcpBridge, /resolveSecretPlaceholders/) // stdio env/args at spawn

  const mcpSecrets = fs.readFileSync(
    path.join(appRoot, 'src/agent/hermes/mcpSecrets.ts'),
    'utf8',
  )
  assert.match(mcpSecrets, /{{secret:\$\{pluginId\}}}/) // renderer sends placeholder
})

// ── P1-B: model profile degrade decision (mirror of engine gating) ──
function decideUseFc(llmOn, toolsEnabled, functionCalling, fcCapable) {
  return llmOn && toolsEnabled !== false && functionCalling !== false && fcCapable !== false
}

await test('P1-B: profile tools=false degrades FC before run; unknown stays permissive', () => {
  assert.equal(decideUseFc(true, true, true, false), false, 'verified no-tools → heuristic')
  assert.equal(decideUseFc(true, true, true, undefined), true, 'unknown → FC (conservative default is existing behavior)')
  assert.equal(decideUseFc(true, true, true, true), true)
  assert.equal(decideUseFc(true, true, false, true), false, 'user switch still wins')
})

await test('P1-B: engine + settings wiring contract', async () => {
  const fs = await import('node:fs')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(engine, /modelSupports/)
  assert.match(engine, /fcCapable !== false/)
  assert.match(engine, /'vision'\)/)
  const mp = fs.readFileSync(path.join(appRoot, 'src/agent/modelProfile.ts'), 'utf8')
  assert.match(mp, /source: 'verified'/)
  assert.match(mp, /source: 'assumed'/)
  const store = fs.readFileSync(path.join(appRoot, 'src/store/settingsStore.ts'), 'utf8')
  assert.match(store, /modelProfiles/)
})

// ── P1-C: tool package governance (mirror of toolPackage.ts core rules) ──
function pkgFingerprint(m) {
  const priv = m.tools
    .filter((t) => t.operationClass !== 'read' || t.kind === 'bash_template')
    .map((t) => `${t.name}:${t.operationClass}:${t.kind}`)
    .sort()
  const base = `${m.auth?.secretKey || ''}|${priv.join(',')}`
  let h = 5381
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}
function compileWithheld(m, approvedFingerprint) {
  const readOnly = m.tools.every(
    (t) => t.operationClass === 'read' && t.kind === 'http_template',
  )
  const approved = readOnly || approvedFingerprint === pkgFingerprint(m)
  return m.tools
    .filter((t) => (t.operationClass !== 'read' || t.kind === 'bash_template') && !approved)
    .map((t) => t.name)
}

await test('P1-C: unapproved packages withhold write/destructive/bash tools', () => {
  const pkg = {
    auth: { secretKey: 'x' },
    tools: [
      { name: 'list_items', operationClass: 'read', kind: 'http_template' },
      { name: 'delete_item', operationClass: 'destructive', kind: 'http_template' },
      { name: 'run_git', operationClass: 'read', kind: 'bash_template' },
    ],
  }
  assert.deepEqual(compileWithheld(pkg, undefined).sort(), ['delete_item', 'run_git'])
  // approve current fingerprint → everything unlocked
  assert.deepEqual(compileWithheld(pkg, pkgFingerprint(pkg)), [])
  // escalation (new write tool) changes fingerprint → withheld again
  const v2 = { ...pkg, tools: [...pkg.tools, { name: 'update_item', operationClass: 'write', kind: 'http_template' }] }
  assert.ok(compileWithheld(v2, pkgFingerprint(pkg)).includes('update_item'))
  // pure read package needs no approval
  const ro = { tools: [{ name: 'list', operationClass: 'read', kind: 'http_template' }] }
  assert.deepEqual(compileWithheld(ro, undefined), [])
})

await test('P1-C: wiring contract — packages compile through the custom-tool pipeline', async () => {
  const fs = await import('node:fs')
  const ct = fs.readFileSync(path.join(appRoot, 'src/agent/tools/customTools.ts'), 'utf8')
  assert.match(ct, /compileToolPackage/)
  assert.match(ct, /listPendingToolPackages/)
  const tp = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolPackage.ts'), 'utf8')
  assert.match(tp, /operationClass 必填/)
  assert.match(tp, /requiresReview: escalations\.length > 0/)
  const ls = fs.readFileSync(path.join(appRoot, 'src/store/learningStore.ts'), 'utf8')
  assert.match(ls, /approveToolPackage/)
})

// ── P1-D: lifecycle hooks (mirror of hooks.evaluateHooks) ──
function evaluateHooksMirror(rules, ctx) {
  const out = { deny: undefined, forceAsk: false, appendTexts: [], audits: [] }
  const matches = (rule) => {
    if (rule.point !== ctx.point) return false
    const m = rule.match
    if (!m) return true
    if (m.tool) {
      const t = ctx.tool || ''
      const ok = m.tool.endsWith('*') ? t.startsWith(m.tool.slice(0, -1)) : t === m.tool
      if (!ok) return false
    }
    if (m.sourceKind?.length && (!ctx.sourceKind || !m.sourceKind.includes(ctx.sourceKind))) return false
    if (m.onlyOnFailure && ctx.toolOk !== false) return false
    return true
  }
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (!matches(rule)) continue
    if (rule.action === 'deny' && !out.deny) out.deny = { rule, reason: rule.reason || rule.id }
    if (rule.action === 'require-approval') out.forceAsk = true
    if (rule.action === 'append-context' && rule.text) out.appendTexts.push(rule.text)
    out.audits.push(rule.id)
  }
  return out
}

await test('P1-D: hook rules — deny wins, require-approval forces ask, prefix + sourceKind match', () => {
  const rules = [
    { id: 'no-bash-cron', point: 'beforeTool', match: { tool: 'bash', sourceKind: ['schedule'] }, action: 'deny', reason: '排程禁 bash' },
    { id: 'ask-mcp', point: 'beforeTool', match: { tool: 'mcp_*' }, action: 'require-approval' },
    { id: 'ctx', point: 'beforeRun', action: 'append-context', text: 'policy note' },
    { id: 'fail-log', point: 'afterTool', match: { onlyOnFailure: true }, action: 'log' },
  ]
  // deny only when sourceKind matches
  assert.ok(evaluateHooksMirror(rules, { point: 'beforeTool', tool: 'bash', sourceKind: 'schedule' }).deny)
  assert.equal(evaluateHooksMirror(rules, { point: 'beforeTool', tool: 'bash', sourceKind: 'composer' }).deny, undefined)
  // prefix match forces approval
  assert.equal(evaluateHooksMirror(rules, { point: 'beforeTool', tool: 'mcp_srv_create' }).forceAsk, true)
  // beforeRun context
  assert.deepEqual(evaluateHooksMirror(rules, { point: 'beforeRun' }).appendTexts, ['policy note'])
  // afterTool onlyOnFailure
  assert.equal(evaluateHooksMirror(rules, { point: 'afterTool', tool: 'x', toolOk: true }).audits.length, 0)
  assert.equal(evaluateHooksMirror(rules, { point: 'afterTool', tool: 'x', toolOk: false }).audits.length, 1)
})

await test('P1-D: wiring contract — hooks evaluated at all four points; sanitize caps plugin rules', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /point: 'beforeTool'/)
  assert.match(guard, /sourceKind: opts\.sourceKind/)
  const runX = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(runX, /point: 'beforeRun'/)
  assert.match(runX, /point: 'afterRun'/)
  assert.match(runX, /sourceKind: opts\.sourceKind/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /point: 'afterTool'/)
  assert.match(loop, /sourceKind: ctx\.sourceKind/)
  const hooks = fs.readFileSync(path.join(appRoot, 'src/agent/hooks.ts'), 'utf8')
  assert.match(hooks, /sanitizeHookRules/)
  assert.match(hooks, /no 'allow' action/i)
})

console.log(`\n${passed} capability smoke tests passed, ${skipped} skipped`)
if (process.exitCode) {
  console.error('Capability smoke failed')
} else {
  console.log('OK')
}
