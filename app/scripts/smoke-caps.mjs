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
  const shell = fs.readFileSync(path.join(appRoot, 'electron/shellBridge.ts'), 'utf8')
  // Direct argv spawn (not cmd.exe shell) for agent CLIs
  assert.match(source, /buildLocalCliArgv/)
  assert.match(source, /runArgv/)
  assert.match(shell, /export async function runArgv/)
  // Codex / Claude / Grok headless flags
  assert.match(source, /'exec'/)
  assert.match(source, /--dangerously-bypass-approvals-and-sandbox/)
  assert.match(source, /--dangerously-skip-permissions/)
  assert.match(source, /stream-json/)
  assert.match(source, /--verbose/)
  assert.match(source, /case 'grok'/)
  assert.match(source, /streaming-json/)
  assert.match(source, /--always-approve/)
  assert.match(source, /--max-turns/)
  assert.match(source, /case 'cursor'/)
  assert.match(source, /case 'opencode'/)
  assert.match(source, /stripAnsi/)
  assert.match(source, /createCliStreamParser|onStream/)
  // No bare shell fallback that opens TUI
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

// ── Loop Engine × Hermes gap plan (Tasks 1–7) ────────────────────
function parseDodVerdictMirror(raw) {
  const match = (raw || '').trim().match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    if (typeof obj.met !== 'boolean') return null
    const confidence =
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : obj.met ? 0.85 : 0.4
    const missing = Array.isArray(obj.missing)
      ? obj.missing.filter((m) => typeof m === 'string' && m.trim()).slice(0, 8)
      : []
    return { met: obj.met, confidence, missing }
  } catch {
    return null
  }
}

await test('Loop plan: DoD verdict parses and constrains semantic evaluator output', () => {
  assert.deepEqual(
    parseDodVerdictMirror('判定：```json\n{"met": false, "confidence": 1.4, "missing": ["缺證據"]}\n```'),
    { met: false, confidence: 1, missing: ['缺證據'] },
  )
  assert.equal(parseDodVerdictMirror('{"confidence": 0.9}'), null)
})

function parseLlmPlanMirror(raw, forceLoopType) {
  const loopTypes = ['Turn-based', 'Goal-based', 'Time-based', 'Proactive']
  const match = (raw || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    const loopType = forceLoopType || (loopTypes.includes(obj.loopType) ? obj.loopType : 'Goal-based')
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter((s) => typeof s === 'string' && s.trim()).slice(0, 7)
      : []
    const dod = typeof obj.definitionOfDone === 'string' ? obj.definitionOfDone.trim().slice(0, 400) : ''
    if (steps.length < 2 || !dod) return null
    const maxIterations = typeof obj.maxIterations === 'number' && obj.maxIterations >= 1
      ? Math.min(8, Math.round(obj.maxIterations))
      : loopType === 'Goal-based' ? 5 : 1
    return { loopType, steps, dod, maxIterations }
  } catch {
    return null
  }
}

await test('Loop plan: LLM plan validation falls back for malformed plans', () => {
  const plan = parseLlmPlanMirror('{"loopType":"Goal-based","steps":["查詢","比較"],"definitionOfDone":"輸出比較表","maxIterations":3}')
  assert.equal(plan.loopType, 'Goal-based')
  assert.equal(plan.maxIterations, 3)
  assert.equal(parseLlmPlanMirror('{"steps":["only one"],"definitionOfDone":"x"}'), null)
})

await test('Loop plan: parser/evaluator/iteration contracts are wired', async () => {
  const fs = await import('node:fs')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const replan = fs.readFileSync(path.join(appRoot, 'src/agent/replan.ts'), 'utf8')
  assert.match(engine, /from '\.\/dodEvaluator'/)
  assert.ok(engine.includes('evaluateDoD('))
  assert.match(engine, /from '\.\/llmParser'/)
  assert.ok(engine.includes('parseWithLlm('))
  assert.match(engine, /allDone && !dodMet/)
  assert.match(engine, /上一輪 DoD 缺口/)
  assert.match(engine, /replanCorrectiveSteps/)
  assert.match(engine, /formatPlanBubble/)
  assert.match(engine, /loopTypeMode/)
  assert.match(engine, /this\.state\.loopConfig\.loopType/)
  assert.match(parser, /export function buildParseResult/)
  assert.match(parser, /export function isChatLiteObjective/)
  assert.match(parser, /export function classifyLoopType/)
  assert.match(parser, /export function formatPlanBubble/)
  assert.match(parser, /個\|項\|款\|種/)
  assert.match(replan, /export function replanCorrectiveSteps/)
})

// Mirror of replan.ts + chat-lite classify (conversation loop engineering)
function replanCorrectiveStepsMirror(missing, objective, opts) {
  const maxSteps = Math.max(1, Math.min(4, opts?.maxSteps ?? 3))
  const gaps = (missing || []).map((item) => String(item).trim()).filter(Boolean).slice(0, Math.max(1, maxSteps - 1))
  const sequence =
    gaps.length > 0
      ? gaps.map((gap) => `補齊缺口：${gap}`.slice(0, 240))
      : [`依目標補齊未達標部分：${String(objective || '').slice(0, 120)}`]
  if (sequence.length < maxSteps) sequence.push('依 Definition of Done 重新驗證並產出完整結果')
  return sequence.slice(0, maxSteps)
}

function isChatLiteObjectiveMirror(input) {
  const text = (input || '').trim()
  if (!text || text.length > 100) return false
  if (/(\d+)\s*(?:個|項|款|種|items?|tools?)/i.test(text)) return false
  if (/以及|並且|然後|比較|分析|研究|調查|重構|實作|修復/.test(text)) return false
  if (/find|analyze|research|compare|build|create|報告|摘要/i.test(text)) return false
  if (text.split(/\n/).filter((line) => line.trim()).length >= 3) return false
  return true
}

await test('Loop plan: chat-lite classifies short turns; complex goals do not', () => {
  assert.equal(isChatLiteObjectiveMirror('你好'), true)
  assert.equal(isChatLiteObjectiveMirror('什麼是 React？'), true)
  assert.equal(isChatLiteObjectiveMirror('分析 2025 年 AI 市場趨勢並給出報告'), false)
  assert.equal(isChatLiteObjectiveMirror('找 3 個 AI 剪輯工具並比較價格'), false)
})

await test('Loop plan: replanCorrectiveSteps builds gap-driven steps', () => {
  const steps = replanCorrectiveStepsMirror(['缺價格欄', '缺第三個工具'], '比較工具', { maxSteps: 3 })
  assert.equal(steps.length, 3)
  assert.match(steps[0], /缺價格欄/)
  assert.match(steps[1], /缺第三個工具/)
  assert.match(steps[2], /Definition of Done/)
})

await test('Loop plan: memory relevance, failure learning, unattended turn, and CJK matching are wired', async () => {
  const fs = await import('node:fs')
  const memory = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/memory.ts'), 'utf8')
  const prompt = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const skills = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/skills.ts'), 'utf8')
  const intent = fs.readFileSync(path.join(appRoot, 'src/agent/intentPreload.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(memory, /buildPromptBlock\(enabled = true, objective\?: string\)/)
  assert.match(memory, /失敗教訓/)
  assert.match(prompt, /buildPromptBlock\(memoryOn, opts\?\.objective\)/)
  assert.match(learning, /onGoalFailure/)
  assert.match(learning, /toolCalls/)
  assert.match(engine, /noteLearningFailure/)
  assert.match(engine, /sessionRecallEnabled|searchSessions/)
  assert.match(runExternal, /loopTypeMode/)
  assert.match(runExternal, /forcedLoopType|forceLoopType/)
  const turn = engine.slice(engine.indexOf('private async runTurnBased'), engine.indexOf('private async runGoalBased'))
  assert.match(turn, /overrides\.unattended/)
  assert.match(turn, /waitForUser/)
  assert.match(turn, /sourceKind === 'composer'/)
  assert.match(skills, /export function cjkAwareHit/)
  assert.match(intent, /[一-鿿]|\\u4e00/)
})

await test('attachments: tiny vision images are upscaled above provider minimum', async () => {
  const fs = await import('node:fs')
  const attachments = fs.readFileSync(path.join(appRoot, 'src/lib/chatAttachments.ts'), 'utf8')
  assert.match(attachments, /MIN_VISION_IMAGE_PIXELS = 512/)
  assert.match(attachments, /visionImageDimensions/)
  assert.match(attachments, /normalizeImageAttachmentsForVision/)
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(runExternal, /normalizeImageAttachmentsForVision/)
})

// ── Slice D: continueGoal + chat history + busy UX ───────────────
function buildChatHistoryContextMirror(bubbles, opts = {}) {
  const keepRecent = opts.keepRecent ?? 3
  const chat = bubbles.filter((b) => b.role === 'user' || b.role === 'assistant')
  if (chat.length <= keepRecent + 1) {
    return chat.map((b) => `${b.role}: ${b.content}`).join('\n')
  }
  const older = chat.slice(0, -keepRecent)
  const recent = chat.slice(-keepRecent)
  return [
    '## 對話摘要',
    ...older.map((b) => `- ${b.role}: ${b.content.slice(0, 40)}`),
    '## 近期對話',
    ...recent.map((b) => `${b.role}: ${b.content}`),
  ].join('\n')
}

function isContinueGoalPhraseMirror(text) {
  return /^(繼續|補齊|接著|再試|重試|繼續補|補上|continue\b|retry\b|keep going)/i.test(
    (text || '').trim(),
  )
}

await test('P3: chat history condenses older turns', () => {
  const bubbles = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `msg-${i} ${'x'.repeat(20)}`,
  }))
  const ctx = buildChatHistoryContextMirror(bubbles, { keepRecent: 3 })
  assert.match(ctx, /對話摘要/)
  assert.match(ctx, /近期對話/)
  assert.match(ctx, /msg-7/)
})

await test('P3: continue goal phrase detection', () => {
  assert.equal(isContinueGoalPhraseMirror('繼續'), true)
  assert.equal(isContinueGoalPhraseMirror('補齊價格欄'), true)
  assert.equal(isContinueGoalPhraseMirror('重新做一個完全不同的任務'), false)
})

await test('P3: continueGoal + steer digest + chatHistory wiring', async () => {
  const fs = await import('node:fs')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const runDispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const continueGoal = fs.readFileSync(path.join(appRoot, 'src/agent/continueGoal.ts'), 'utf8')
  const chatHistory = fs.readFileSync(path.join(appRoot, 'src/agent/chatHistory.ts'), 'utf8')
  const threadStore = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  assert.match(continueGoal, /export function buildContinueGoalSnapshot/)
  assert.match(continueGoal, /export function formatContinueGoalOffer/)
  assert.match(chatHistory, /export function buildChatHistoryContext/)
  assert.match(chatHistory, /export function isContinueGoalPhrase/)
  assert.match(engine, /continueGoal/)
  assert.match(engine, /persistContinueGoal/)
  assert.match(engine, /clearContinueGoal/)
  assert.match(runExternal, /buildSteerPartialDigest/)
  assert.match(runExternal, /continueGoal/)
  assert.match(runExternal, /佇列第/)
  assert.match(runDispatch, /buildChatHistoryContext/)
  assert.match(threadStore, /setContinueGoal/)
  assert.match(threadStore, /continueGoal/)
})

console.log(`\n${passed} capability smoke tests passed, ${skipped} skipped`)
if (process.exitCode) {
  console.error('Capability smoke failed')
} else {
  console.log('OK')
}
