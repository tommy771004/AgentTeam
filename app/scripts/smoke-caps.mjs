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
  assert.match(src, /MAX_RUN_HITL_AUDITS = 100/)
  assert.match(src, /resolve: \(requestId, decision\)/)
  const modal = fs.readFileSync(path.join(appRoot, 'src/components/PermissionAskModal.tsx'), 'utf8')
  assert.match(modal, /current\.runId/)
  assert.match(modal, /resolve\(current\.id, 'allow'\)/)
  assert.match(modal, /resolve\(current\.id, 'deny'\)/)
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

await test('Phase 0: OpenCode CLI has explicit agent/file/JSON event contract', async () => {
  const fs = await import('node:fs')
  const source = fs.readFileSync(path.join(appRoot, 'electron/localCliRunner.ts'), 'utf8')
  assert.match(source, /args\.push\('--agent', input\.agentMode\)/)
  assert.match(source, /args\.push\('--format', 'json'\)/)
  assert.match(source, /args\.push\('--file', file\)/)
  assert.match(source, /normalizeOpenCodeEvent/)
  assert.match(source, /permissionRequest/)
})

await test('Phase 1: OpenCode server adapter is localhost-only and has safe fallback', async () => {
  const fs = await import('node:fs')
  const bridge = fs.readFileSync(path.join(appRoot, 'electron/opencodeServerBridge.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(bridge, /\/global\/health/)
  assert.match(bridge, /\/doc/)
  assert.match(bridge, /\/session\//)
  assert.match(bridge, /\/global\/event/)
  assert.match(bridge, /\/abort/)
  assert.match(bridge, /127\.0\.0\.1/)
  assert.doesNotMatch(bridge, /--mdns/)
  assert.doesNotMatch(bridge, /--cors/)
  assert.doesNotMatch(bridge, /0\.0\.0\.0/)
  assert.match(main, /serverMode \|\| 'auto'/)
  assert.match(main, /runLocalCliAgent/)
})

await test('Phase 2: OpenCode session todo/children/fork map into Thread state', async () => {
  const fs = await import('node:fs')
  const mapping = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/sessionMapping.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const serverClient = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/serverClient.ts'), 'utf8')
  const thread = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  assert.match(mapping, /normalizeOpenCodeTodo/)
  assert.match(mapping, /normalizeOpenCodeChildren/)
  assert.match(runExternal, /syncOpenCodeSessionMapping/)
  assert.match(runExternal, /setRunPlan\(threadId, plan\)/)
  assert.match(runExternal, /createThread\(/)
  assert.match(serverClient, /forkOpenCodeSession/)
  assert.match(thread, /fork-pending/)
})

await test('Phase 3: MCP access is per-agent allowlist with health/secret owner UX', async () => {
  const fs = await import('node:fs')
  const access = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/mcpAccess.ts'), 'utf8')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(access, /mcpAgentServers/)
  assert.match(access, /hasOwnProperty\.call\(map, agentId\)/)
  assert.match(loop, /mcpServersForAgent/)
  assert.match(loop, /parentMcpAgentId/)
  assert.match(settings, /Per-agent MCP/)
  assert.match(settings, /secret owner/)
})

await test('Sub Agent switch defaults off and gates role/delegate paths', async () => {
  const fs = await import('node:fs')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const runtime = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/runtime.ts'), 'utf8')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  const background = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(types, /subAgentsEnabled: boolean/)
  assert.match(llm, /subAgentsEnabled: false/)
  assert.match(engine, /private subAgentsEnabled\(\)/)
  assert.match(engine, /runPrimaryAgentTask/)
  assert.match(runExternal, /opts\.sourceKind === 'delegate'/)
  assert.match(runtime, /capability\.id !== 'delegate'/)
  assert.match(guard, /Sub Agent 功能目前已關閉/)
  assert.match(delegate, /settings\.subAgentsEnabled !== true/)
  assert.match(background, /背景委派未排入/)
  assert.match(settings, /title="啟用 Sub Agent"/)
})

await test('Phase 4/5: LSP adapter, provider adoption, and plugin summary stay explicit', async () => {
  const fs = await import('node:fs')
  const lsp = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/codeIntelligenceAdapter.ts'), 'utf8')
  const graph = fs.readFileSync(path.join(appRoot, 'src/agent/codegraphClient.ts'), 'utf8')
  const provider = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/providerAdapter.ts'), 'utf8')
  const config = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/configCandidates.ts'), 'utf8')
  assert.match(lsp, /incomingCalls/)
  assert.match(lsp, /goToDefinition|definition/)
  assert.match(graph, /parseOpenCodeLspToGraph/)
  assert.match(provider, /source: 'discovered'/)
  assert.match(config, /permission 需人工審核/)
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
    'workspace_list', 'workspace_read', 'workspace_diff', 'datetime_now',
    'memory_get', 'memory_search',
    'skill_list', 'skill_load',
    'mcp_list_tools',
    'delegate_status',
    'json_extract_lite', 'table_parse', 'update_plan', 'ask_user',
    'codegraph_explore', 'codegraph_status', 'codegraph_impact', 'codegraph_callers',
    // SubDesign coordination mutates local metadata only; it never writes workspace files.
    'design_brief_update', 'design_direction_select', 'design_system_list', 'design_system_read',
    'design_artifact_register',
    'design_critique_note',
    'design_critique',
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

// ── W1: runTask capacity policy (mirror of runExternal.resolveBusyPolicy) ──
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

await test('Phase 3 item 1: taskRunCoordinator is the canonical ingress', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const legacy = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const callers = [
    'src/App.tsx',
    'src/store/agentStore.ts',
    'src/hooks/useSlashExecutor.ts',
    'src/pages/ProtocolsPage.tsx',
    'src/pages/AutomationPage.tsx',
    'src/pages/EventsPage.tsx',
    'src/pages/FailedPage.tsx',
    'src/pages/LogsPage.tsx',
    'src/pages/RecordsPage.tsx',
    'src/pages/SuccessPage.tsx',
    'src/pages/SubDesignPage.tsx',
    'src/components/InlineRunPanel.tsx',
    'src/components/subdesign/CritiqueTheater.tsx',
    'src/agent/hermes/backgroundJobs.ts',
  ]
  assert.match(coordinator, /export async function coordinateTaskRun/)
  assert.match(coordinator, /export async function runTask/)
  assert.match(coordinator, /normalizeTaskRunInput/)
  assert.match(coordinator, /await import\('\.\/runExternal'\)/)
  assert.match(legacy, /compatibility adapter for the canonical taskRunCoordinator seam/)
  assert.match(legacy, /coordinateTaskRun/)
  assert.match(legacy, /@deprecated New callers must use `taskRunCoordinator\.runTask`/)
  for (const file of callers) {
    const source = fs.readFileSync(path.join(appRoot, file), 'utf8')
    assert.doesNotMatch(
      source,
      /runExternalObjective\s*\(/,
      `${file} 不可直接呼叫 runExternalObjective`,
    )
    assert.match(source, /taskRunCoordinator/)
  }
})

await test('Phase 3 item 6/7: background delegate links Archive once + hidden worker thread', async () => {
  const fs = await import('node:fs')
  const bg = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  const thread = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  const sidebar = fs.readFileSync(path.join(appRoot, 'src/components/ThreadSidebar.tsx'), 'utf8')
  const legacy = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(bg, /archiveRunId/)
  assert.match(bg, /workerThread: true/)
  assert.match(bg, /job\.archiveRunId/)
  assert.match(bg, /Link-only|coordinator finalization already archived/i)
  assert.match(thread, /hidden\?: boolean/)
  assert.match(thread, /t\.hidden/)
  assert.match(sidebar, /threads\.filter\(\(t\) => !t\.hidden\)/)
  assert.match(legacy, /workerThread\?: boolean/)
  assert.match(coordinator, /hidden: opts\.hidden/)
})

await test('Phase 3 item 3: runDispatch consumes RunDispatchSnapshot only', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const legacy = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(coordinator, /export type RunDispatchSnapshot/)
  assert.match(coordinator, /export function buildRunDispatchSnapshot/)
  assert.match(coordinator, /deferFinalization: true/)
  assert.match(dispatch, /RunDispatchSnapshot/)
  assert.match(dispatch, /isRunDispatchSnapshot|snapshot\.runId|snapshot\.overrides/)
  assert.doesNotMatch(dispatch, /canStartRun/)
  assert.doesNotMatch(dispatch, /materializeAttachmentsOnDisk/)
  assert.doesNotMatch(dispatch, /hydrateAttachmentsFromDisk/)
  assert.doesNotMatch(dispatch, /normalizeImageAttachmentsForVision/)
  assert.match(legacy, /buildRunDispatchSnapshot/)
  assert.match(legacy, /dispatchThreadTask\(snapshot\)/)
})

await test('Phase 3 item 4/5: unique finalization order; stop does not drain', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const legacy = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  assert.match(coordinator, /export async function finalizeTaskRun/)
  // Ordered step comments encode the unique finalization sequence
  assert.match(coordinator, /\/\/ 2\) afterRun hooks/)
  assert.match(coordinator, /\/\/ 3\) Archive/)
  assert.match(coordinator, /\/\/ 4\) onSettled/)
  assert.match(coordinator, /\/\/ 5\) release capacity/)
  assert.match(coordinator, /\/\/ 6\) queue drain/)
  const a2 = coordinator.indexOf('// 2) afterRun hooks')
  const a3 = coordinator.indexOf('// 3) Archive')
  const a4 = coordinator.indexOf('// 4) onSettled')
  const a5 = coordinator.indexOf('// 5) release capacity')
  const a6 = coordinator.indexOf('// 6) queue drain')
  assert.ok(a2 < a3 && a3 < a4 && a4 < a5 && a5 < a6, 'finalization step comments stay ordered')
  assert.match(types, /deferFinalization\?: boolean/)
  assert.match(agent, /deferFinalization/)
  assert.match(agent, /Phase 3 item 5: stop only terminates/)
  assert.doesNotMatch(
    agent.slice(agent.indexOf('stopExecution:'), agent.indexOf('continueTurn:')),
    /drainQueueAfterRun/,
  )
  assert.match(legacy, /finalizeTaskRun/)
  // Lifecycle implementation must not drain outside finalize
  assert.doesNotMatch(legacy, /drainExternalRunQueue/)
})

await test('Phase 3 item 2: coordinator owns capacity / attachments / thread / beforeRun once', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const legacy = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')

  // Coordinator exports the single-owner prep APIs
  assert.match(coordinator, /export async function prepareRunAttachments/)
  assert.match(coordinator, /export async function checkRunCapacity/)
  assert.match(coordinator, /export async function reserveRunCapacity/)
  assert.match(coordinator, /export async function bindRunThread/)
  assert.match(coordinator, /export async function evaluateBeforeRunHooks/)
  assert.match(coordinator, /phase === 'persist'/)
  assert.match(coordinator, /phase === 'hydrate'/)
  assert.match(coordinator, /point: 'beforeRun'/)

  // Lifecycle implementation uses coordinator helpers (not local reimplementation)
  assert.match(legacy, /prepareRunAttachments/)
  assert.match(legacy, /checkRunCapacity/)
  assert.match(legacy, /reserveRunCapacity/)
  assert.match(legacy, /bindRunThread/)
  assert.match(legacy, /evaluateBeforeRunHooks/)
  assert.doesNotMatch(legacy, /materializeAttachmentsOnDisk/)
  assert.doesNotMatch(legacy, /hydrateAttachmentsFromDisk/)
  assert.doesNotMatch(legacy, /normalizeImageAttachmentsForVision/)
  assert.doesNotMatch(legacy, /\.canStartRun\(/)
  assert.doesNotMatch(legacy, /\.reserveRun\(/)
  assert.doesNotMatch(legacy, /\.bindRun\(/)

  // runDispatch must not re-own capacity or attachment I/O
  assert.doesNotMatch(dispatch, /canStartRun/)
  assert.doesNotMatch(dispatch, /materializeAttachmentsOnDisk/)
  assert.doesNotMatch(dispatch, /hydrateAttachmentsFromDisk/)
  assert.doesNotMatch(dispatch, /normalizeImageAttachmentsForVision/)
  assert.doesNotMatch(dispatch, /prepareRunAttachments/)
  assert.match(dispatch, /already-prepared|must not re-check capacity|must not re-run/i)
})

await test('ADR3: concurrent-run registry, targeted HITL, and CLI cancellation stay wired', async () => {
  const fs = await import('node:fs')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const thread = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  const permission = fs.readFileSync(path.join(appRoot, 'src/store/permissionAskStore.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const settingsPage = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const scenario = fs.readFileSync(path.join(appRoot, 'scripts/smoke-scenario-e2e.mjs'), 'utf8')
  assert.match(engine, /class AgentEngineRegistry/)
  assert.match(engine, /create\(runId\?/)
  assert.match(agent, /activeRunIds/)
  assert.match(agent, /reserveRun/)
  assert.match(agent, /getRunState/)
  assert.match(thread, /runningThreadIds/)
  assert.match(thread, /runningRunIds/)
  assert.match(permission, /threadId\?: string/)
  assert.match(permission, /runId\?: string/)
  assert.match(permission, /sessionAllowByThread/)
  // Phase 3 item 2: capacity check/reserve owned by coordinator, used by controller
  assert.match(controller, /checkRunCapacity|reserveRunCapacity/)
  assert.match(
    fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8'),
    /export async function (checkRunCapacity|reserveRunCapacity)/,
  )
  assert.doesNotMatch(controller, /agent\.isRunning/)
  assert.match(settings, /concurrentRunsEnabled: false/)
  assert.match(settings, /maxConcurrentRuns: 4/)
  assert.match(settingsPage, /實驗性：[\s\S]*多 run 呈現尚未完成/)
  assert.match(preload, /cancel: \(runId\?: string\)/)
  assert.match(main, /ipcMain\.handle\('cli:cancel', async \(_evt, runId\?: string\)/)
  assert.match(scenario, /ADR3: opt-in concurrent runs/)
})

await test('Phase 1: run presentation components use explicit run selectors', async () => {
  const fs = await import('node:fs')
  const feed = fs.readFileSync(path.join(appRoot, 'src/components/RunProcessFeed.tsx'), 'utf8')
  const panel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  assert.match(feed, /runId/)
  assert.match(panel, /runId/)
  assert.doesNotMatch(feed, /useAgentStore\(\(s\) => s\.agent\)/)
  assert.doesNotMatch(feed, /useRunActivityStore\(\)/)
  assert.doesNotMatch(panel, /useAgentStore\(\)/)
  assert.doesNotMatch(panel, /useRunActivityStore\(\)/)
  assert.match(panel, /stopExecution\(runId\)/)
  assert.match(panel, /continueTurn\(runId\)/)
  assert.match(panel, /resolveIntervention\([\s\S]*runId\)/)
  assert.match(agent, /MAX_RUN_AGENT_STATES = 100/)
  assert.match(agent, /pruneRunAgentStates/)
  assert.match(agent, /lastRunIdByThread/)
  assert.match(agent, /resolveIntervention: \(decision, runId\)/)
  assert.doesNotMatch(agent, /const target = runId \|\| get\(\)\.selectedRunId/)
})

await test('Phase 0: workflow baseline matrix stays recorded', async () => {
  const fs = await import('node:fs')
  const scenario = fs.readFileSync(path.join(appRoot, 'scripts/smoke-scenario-e2e.mjs'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const background = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  const baseline = {
    twoBuiltInRuns:
      /ADR3: opt-in concurrent runs/.test(scenario) &&
      /parallel-1/.test(scenario) &&
      /parallel-2/.test(scenario),
    builtInAndCli:
      /startLocalCliExecution/.test(dispatch) &&
      /path: 'cli'/.test(dispatch),
    twoHitlAsks: /HITL asks must retain the originating run and thread/.test(scenario),
    queueOverflow: /overflow should drain after a slot frees/.test(scenario),
    backgroundDelegate:
      /sourceKind: 'delegate'/.test(background) &&
      /runTask\(\{/.test(background) &&
      /archiveBackgroundJob\(/.test(background),
  }
  assert.deepEqual(
    Object.entries(baseline).filter(([, present]) => !present).map(([name]) => name),
    [],
    'Phase 0 baseline evidence is incomplete',
  )
})

await test('Phase 1: active thread selects its run state through the UI seam', async () => {
  const fs = await import('node:fs')
  const protocols = fs.readFileSync(path.join(appRoot, 'src/pages/ProtocolsPage.tsx'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  assert.match(protocols, /getRunIdForThread/)
  assert.match(protocols, /selectRun/)
  assert.match(protocols, /selectActivityRun/)
  assert.match(protocols, /Phase 1: thread selection is the UI seam/)
  assert.match(protocols, /const presentationRunId = activeId \? getRunIdForThread\(activeId\) : null/)
  assert.match(protocols, /selectRun\(presentationRunId\)/)
  assert.match(protocols, /selectActivityRun\(presentationRunId\)/)
  assert.match(agent, /selectRun: \(runId\)/)
  assert.match(agent, /agent: state \|\| emptyAgent\(\)/)
})

await test('Phase 1: run activity is run-scoped with bounded terminal retention', async () => {
  const fs = await import('node:fs')
  const activity = fs.readFileSync(path.join(appRoot, 'src/store/runActivityStore.ts'), 'utf8')
  assert.match(activity, /presentations: Record<string, RunPresentation>/)
  assert.match(activity, /MAX_PRESENTATIONS = 100/)
  assert.match(activity, /getPresentation: \(runId\)/)
  assert.match(activity, /terminalizePresentation/)
  assert.match(activity, /get\(\)\.end\(streamRunId/)
  assert.match(activity, /clearDraft: \(runId\)/)
})

await test('Phase 1: finalization summary consumes the explicit run presentation', async () => {
  const fs = await import('node:fs')
  // Phase 3 item 4: process summary moved into coordinator finalizeTaskRun
  const controller = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(controller, /getState\(\)\.getPresentation\(runId\)/)
  assert.match(controller, /const presentation = useRunActivityStore\.getState\(\)\.getPresentation\(runId\)/)
  assert.match(controller, /presentation\?\.events/)
  assert.match(controller, /presentation\?\.fileChanges/)
  assert.doesNotMatch(controller, /const activity = useRunActivityStore\.getState\(\)[\s\S]{0,120}activity\.events/)
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

await test('Phase 3: OpenCode permission projection preserves patterns and restrictive merge', async () => {
  const fs = await import('node:fs')
  const config = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/configTypes.ts'), 'utf8')
  const permissions = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/permissions.ts'), 'utf8')
  const registry = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/agentRegistry.ts'), 'utf8')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(config, /projectOpenCodePermissions/)
  assert.match(config, /mergePermissionProjectionsRestrictive/)
  assert.match(permissions, /checkProjectedToolPermission/)
  assert.match(permissions, /mcp_/)
  assert.match(registry, /restrictivePermission/)
  assert.match(guard, /OpenCode permission deny/)
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

await test('SubDesign Phase 4/5: critique gate + Electron export contract', async () => {
  const fs = await import('node:fs')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const critique = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/critique.ts'), 'utf8')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  const capability = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/subDesign.ts'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  // Phase 3 item 4: subDesign export digest lives in coordinator finalization summary
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(critique, /critiqueAllowsDeliver/)
  assert.match(guard, /design_artifact_export/)
  assert.match(capability, /design_artifact_export/)
  assert.match(main, /subdesign:exportArtifact/)
  assert.match(main, /printToPDF/)
  assert.match(main, /createHash\(['"]sha256['"]\)/)
  assert.match(main, /isProjectRelativePath/)
  assert.match(preload, /exportArtifact:/)
  assert.match(page, /CritiquePanel/)
  assert.match(page, /ArtifactDeliveryPanel/)
  assert.match(coordinator, /sha256/)
  assert.match(coordinator, /pushRunSummary/)
})

await test('SubDesign Phase 6: canonical metadata, artifact IPC, bash gate, and critique evidence', async () => {
  const fs = await import('node:fs')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  const critique = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/critique.ts'), 'utf8')
  const preview = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ArtifactPreview.tsx'), 'utf8')
  const executor = fs.readFileSync(path.join(appRoot, 'src/agent/tools/executor.ts'), 'utf8')
  const registry = fs.readFileSync(path.join(appRoot, 'src/agent/tools/registry.ts'), 'utf8')
  const schemas = fs.readFileSync(path.join(appRoot, 'src/agent/tools/schemas.ts'), 'utf8')
  const capability = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/subDesign.ts'), 'utf8')
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const preference = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/preference.ts'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const tweak = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ArtifactTweakPanel.tsx'), 'utf8')
  const referencePanel = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ReferenceImportPanel.tsx'), 'utf8')
  const delivery = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ArtifactDeliveryPanel.tsx'), 'utf8')
  assert.match(main, /subdesign:readMetadata/)
  assert.match(main, /subdesign:writeMetadata/)
  assert.match(main, /SUBDESIGN_METADATA_ROOT/)
  assert.match(main, /subdesign:verifyEvidence/)
  assert.match(main, /subdesign:captureEvidence/)
  assert.match(main, /captureSubDesignEvidence/)
  assert.match(main, /subdesign:patchArtifact/)
  assert.match(main, /subdesign:exportCapabilities/)
  assert.match(main, /buildPptxFiles/)
  assert.match(main, /exportSubDesignMp4/)
  assert.match(main, /verifySubDesignEvidenceContent/)
  assert.match(main, /attestSubDesignEvidence/)
  assert.match(main, /readAndVerifyEvidenceAttestation/)
  assert.match(main, /lintSubDesignArtifact/)
  assert.match(main, /importSubDesignReference/)
  assert.match(main, /referenceTokens/)
  assert.match(main, /subDesignPatchDirectionGateError/)
  assert.match(preload, /readMetadata:/)
  assert.match(preload, /writeMetadata:/)
  assert.match(preload, /verifyEvidence:/)
  assert.match(preload, /captureEvidence:/)
  assert.match(preload, /patchArtifact:/)
  assert.match(preload, /applyTweak:/)
  assert.match(preload, /lintEvidence:/)
  assert.match(preload, /importReference:/)
  assert.match(preload, /exportCapabilities:/)
  assert.match(preview, /readArtifact/)
  assert.match(guard, /isSubDesignWritableBashCommand/)
  assert.match(guard, /isSubDesignReadonlyBashCommand/)
  assert.match(guard, /curl\|wget/)
  assert.match(guard, /tool === 'bash'/)
  assert.match(critique, /critiqueHasRequiredEvidence/)
  assert.match(critique, /screenshot/)
  assert.match(critique, /dom/)
  assert.match(critique, /lint/)
  assert.match(registry, /design_artifact_patch/)
  assert.match(registry, /design_artifact_capture/)
  assert.match(registry, /design_artifact_tweak/)
  assert.match(registry, /design_artifact_lint/)
  assert.match(schemas, /expectedMatches/)
  assert.match(schemas, /exports:.*pptx.*mp4/)
  assert.match(schemas, /format:.*pptx.*mp4/)
  assert.match(executor, /'pptx' \| 'mp4'/)
  assert.match(tweak, /exact patch/)
  assert.match(tweak, /requestAsk/)
  assert.match(tweak, /Structured|structured|inferred/)
  assert.match(page, /ReferenceImportPanel/)
  assert.match(referencePanel, /references/)
  assert.match(critique, /evidenceId/)
  assert.match(capability, /design_artifact_lint/)
  assert.match(delivery, /ffmpeg/)
  assert.match(delivery, /單頁摘要/)
  assert.match(delivery, /靜態縮圖/)
  assert.match(executor, /onSubDesignPass/)
  assert.match(capability, /design_artifact_capture/)
  assert.match(learning, /subdesign-preference/)
  assert.match(preference, /findLatestPassedSubDesignPreference/)
  assert.match(preference, /subDesignProjectMemoryKey/)
  assert.match(preference, /memoryEntries/)
  assert.match(learning, /subDesignProjectMemoryKey/)
  assert.match(page, /memoryEntries/)
  assert.match(page, /latestPassedPreference/)
})

await test('SubDesign R3: deep brief route, in-page run feed, and return link', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const inspector = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignRunInspector.tsx'), 'utf8')
  const studio = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignProjectStudio.tsx'), 'utf8')
  const preview = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ArtifactPreview.tsx'), 'utf8')
  const summary = fs.readFileSync(path.join(appRoot, 'src/components/RunSummaryCard.tsx'), 'utf8')
  const sourceFiles = await fs.promises.readdir(path.join(appRoot, 'src'), { recursive: true })
  assert.match(app, /subdesign\/:briefId\?/)
  assert.match(page, /useParams/)
  assert.match(page, /navigate\(`\/subdesign\/\$\{created\.id\}`\)/)
  assert.match(page, /navigate\(`\/subdesign\/\$\{item\.id\}`\)/)
  assert.match(page, /SubDesignRunInspector/)
  assert.match(inspector, /RunProcessFeed/)
  assert.match(page, /SubDesignProjectStudio/)
  assert.match(page, /routeBriefId && activeBrief && workspace/)
  assert.match(studio, /Project Studio/)
  assert.match(studio, /Design Files/)
  assert.match(studio, /Critique/)
  assert.match(studio, /Deliver/)
  assert.match(studio, /onSelectDirection/)
  assert.match(studio, /RunProcessFeed/)
  assert.match(preview, /mode === 'source'/)
  assert.match(page, /runningThreadId/)
  assert.match(page, /useRunActivityStore/)
  assert.match(page, /startingRun/)
  assert.match(page, /hydrateThreads/)
  assert.match(page, /runTask\(/)
  assert.match(page, /setShowRunPanel/)
  assert.match(page, /navigate\(`\/\?thread=/)
  assert.match(summary, /useNavigate/)
  assert.match(summary, /navigate\(`\/subdesign\/\$\{summary\.subDesign\?\.briefId\}`\)/)
  assert.match(summary, /查看設計/)
  for (const file of sourceFiles.filter((entry) => typeof entry === 'string' && /\.(tsx?|css)$/.test(entry))) {
    const contents = fs.readFileSync(path.join(appRoot, 'src', file), 'utf8')
    assert.equal(contents.includes('c96646'), false, `legacy brand color remains in src/${file}`)
  }
})

await test('SubDesign R3-P4/P5: critique theater and Design System resource routes', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const layout = fs.readFileSync(path.join(appRoot, 'src/components/Layout.tsx'), 'utf8')
  const theater = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/CritiqueTheater.tsx'), 'utf8')
  const session = fs.readFileSync(path.join(appRoot, 'src/store/subDesignCritiqueSessionStore.ts'), 'utf8')
  const designSystem = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/designSystem.ts'), 'utf8')
  const workspaceNav = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignStudioNav.tsx'), 'utf8')
  const listPage = fs.readFileSync(path.join(appRoot, 'src/pages/DesignSystemsPage.tsx'), 'utf8')
  const createPage = fs.readFileSync(path.join(appRoot, 'src/pages/DesignSystemCreatePage.tsx'), 'utf8')
  const detailPage = fs.readFileSync(path.join(appRoot, 'src/pages/DesignSystemDetailPage.tsx'), 'utf8')
  const subDesignPage = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  assert.match(theater, /Critique Theater/)
  assert.match(theater, /2 rounds · 3 panelists/)
  assert.match(theater, /runTask\(/)
  assert.match(theater, /stopExecution/)
  assert.match(theater, /design_artifact_capture/)
  assert.match(theater, /design_artifact_lint/)
  assert.match(theater, /design_critique/)
  assert.match(theater, /Live review trace/)
  assert.match(session, /recordPanelistNote/)
  assert.match(session, /isCritiqueSessionReadyForFinal/)
  assert.match(session, /claimFinalCritique/)
  assert.match(session, /finalCritiqueClaimed/)
  assert.match(session, /isCritiqueRoundComplete\(current\.rounds\[0\]\)/)
  assert.match(session, /interrupt/)
  assert.match(session, /threshold: 70/)
  assert.match(session, /finish:/)
  assert.match(designSystem, /createDesignSystemDocument/)
  assert.match(designSystem, /updateDesignSystemDocument/)
  assert.match(designSystem, /workspaceMkdir/)
  assert.match(app, /design-systems\/create/)
  assert.match(app, /design-systems\/:id/)
  assert.match(app, /DesignSystemsPage/)
  assert.match(layout, /pathname\.startsWith\('\/design-systems\/'\)/)
  assert.doesNotMatch(layout, /to: '\/design-systems', label: 'Design Systems'/)
  assert.match(workspaceNav, /SubDesign workspace/)
  assert.match(workspaceNav, /Design Systems/)
  assert.match(listPage, /Choose a Design System/)
  assert.match(listPage, /Search design systems/)
  assert.match(listPage, /Project default/)
  assert.match(listPage, /Apply and return to Studio/)
  assert.match(listPage, /role="radiogroup"/)
  assert.match(listPage, /updateBrief/)
  assert.match(createPage, /從品牌來源建立 Design System/)
  assert.match(createPage, /Brand → Studio/)
  assert.match(createPage, /createBrief/)
  assert.match(createPage, /surface: 'design-system'/)
  assert.match(createPage, /importReference/)
  assert.match(createPage, /navigate\(`\/subdesign\/\$\{brief\.id\}`\)/)
  assert.match(detailPage, /Project Studio \/ Design System/)
  assert.match(detailPage, /Design System/)
  assert.match(detailPage, /DESIGN\.md/)
  assert.match(detailPage, /Live contract/)
  assert.match(detailPage, /readDesignSystem/)
  assert.match(detailPage, /applyToStudio/)
  assert.match(subDesignPage, /瀏覽與套用 Design system/)
  assert.match(subDesignPage, /updateBrief\(activeBrief\.id, \{ designSystemId:/)
  const prompt = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/prompt.ts'), 'utf8')
  assert.match(prompt, /Design System Studio contract/)
  assert.match(prompt, /design_system_update/)
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
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  // Phase 3: beforeRun + afterRun owned by coordinator (admit + finalize)
  assert.match(coordinator, /point: 'beforeRun'/)
  assert.match(coordinator, /point: 'afterRun'/)
  assert.match(runX, /evaluateBeforeRunHooks/)
  assert.match(runX, /finalizeTaskRun/)
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
  const autoLoopTypes = ['Turn-based', 'Goal-based']
  const match = (raw || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    const allowed = forceLoopType ? loopTypes : autoLoopTypes
    const loopType = forceLoopType || (allowed.includes(obj.loopType) ? obj.loopType : 'Goal-based')
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

await test('Phase 2a: conversational automation is suggestion-only and auto loops stay Turn/Goal', async () => {
  const fs = await import('node:fs')
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const automation = fs.readFileSync(path.join(appRoot, 'src/agent/automationSuggestion.ts'), 'utf8')
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/llmParser.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const scheduleText = '每天 08:00 寄摘要'
  assert.equal(/每日|每天|定時|排程/.test(scheduleText), true)
  assert.equal(parseLlmPlanMirror('{"loopType":"Time-based","steps":["a","b"],"definitionOfDone":"ok"}').loopType, 'Goal-based')
  assert.match(parser, /detectAutomationSuggestion/)
  assert.match(automation, /source: 'conversation'/)
  assert.match(automation, /尚未執行/)
  assert.match(llm, /AUTO_LOOP_TYPES/)
  assert.match(llm, /不得輸出 Time-based 或 Proactive/)
  assert.match(runExternal, /presentConversationAutomationSuggestion/)
  assert.match(runExternal, /status: 'suggested'/)
  assert.match(runExternal, /no capacity reservation, engine start, or tool call/i)
})

await test('Phase 2b: Time-based runs require a claimed ScheduledJob trigger snapshot', async () => {
  const fs = await import('node:fs')
  const scheduler = fs.readFileSync(path.join(appRoot, 'src/agent/scheduler.ts'), 'utf8')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  assert.match(scheduler, /createScheduleTriggerSnapshot/)
  assert.match(scheduler, /job\.lastRunAt \|\| ''/)
  assert.match(scheduler, /validateScheduleTriggerSnapshot/)
  assert.match(scheduler, /isClaimedScheduleTrigger/)
  assert.match(app, /scheduleTriggeredAt: scheduleTrigger\.triggeredAt/)
  assert.match(app, /scheduleKind: scheduleTrigger\.scheduleKind/)
  assert.match(runExternal, /resolveScheduleTrigger/)
  assert.match(runExternal, /verifyClaimedScheduleTrigger/)
  assert.match(runExternal, /Time-based 僅能由有效 ScheduledJob 到期 trigger 進入/)
  assert.ok(
    runExternal.indexOf('const scheduleTriggerResolution') <
      runExternal.indexOf('await checkRunCapacity(runId'),
    'trigger validation must precede capacity reservation',
  )
  assert.match(queue, /scheduleTriggeredAt/)
  assert.match(queue, /scheduleKind/)
  assert.match(engine, /validateScheduleTriggerSnapshot/)
  assert.match(engine, /isClaimedScheduleTrigger/)
  assert.match(engine, /private async validateTimeBasedTrigger\(\)/)
  assert.match(engine, /this\.state\.scheduleTrigger = validation\.snapshot/)
  assert.match(types, /interface ScheduleTriggerSnapshot/)
  assert.match(agent, /scheduleTrigger: agent\.scheduleTrigger/)
  assert.match(agent, /scheduleTrigger\?: RuntimeOverrides\['scheduleTrigger'\]/)
  assert.match(dispatch, /scheduleTrigger: snapshot\.overrides\.scheduleTrigger/)
})

await test('Phase 2c: Proactive runs require matcher-produced event evidence', async () => {
  const fs = await import('node:fs')
  const matcher = fs.readFileSync(path.join(appRoot, 'src/agent/eventMatcher.ts'), 'utf8')
  const store = fs.readFileSync(path.join(appRoot, 'src/store/scheduleStore.ts'), 'utf8')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  assert.match(matcher, /export function matchProactiveEvent/)
  assert.match(matcher, /matched: true/)
  assert.match(matcher, /validateEventTriggerSnapshot/)
  assert.match(store, /matchEventEvidence/)
  assert.match(store, /lastTriggerEvidence: evidence/)
  assert.match(app, /matchEventEvidence/)
  assert.match(app, /meta: \{ eventTrigger: matched\.trigger \}/)
  assert.match(runExternal, /resolveProactiveTrigger/)
  assert.match(runExternal, /Proactive trigger 無效/)
  assert.ok(
    runExternal.indexOf('const proactiveTriggerResolution') <
      runExternal.indexOf('await checkRunCapacity(runId'),
    'event evidence validation must precede capacity reservation',
  )
  assert.match(queue, /eventTrigger/)
  assert.match(engine, /validateEventTriggerSnapshot/)
  assert.match(engine, /this\.state\.eventTrigger = validation\.snapshot/)
  assert.doesNotMatch(engine, /predicate has_trigger|Event criteria not met|when\/if/)
  assert.match(types, /interface EventTriggerSnapshot/)
  assert.match(agent, /eventTrigger: agent\.eventTrigger/)
  assert.match(dispatch, /eventTrigger: snapshot\.overrides\.eventTrigger/)
})

await test('Phase 2d: Next_State is consumed once with explicit webhook delivery audit', async () => {
  const fs = await import('node:fs')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const outcome = fs.readFileSync(path.join(appRoot, 'src/agent/outcomeDispatcher.ts'), 'utf8')
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const llmParser = fs.readFileSync(path.join(appRoot, 'src/agent/llmParser.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const settingsPage = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const server = fs.readFileSync(path.join(appRoot, 'electron/webhookServer.ts'), 'utf8')
  assert.match(types, /type NextState = 'Halt' \| 'Await User Input' \| 'Dispatch Webhook'/)
  assert.match(types, /interface PostStateOutcome/)
  assert.match(outcome, /export async function consumeNextState/)
  assert.match(outcome, /未設定有效 webhook target/)
  assert.match(outcome, /window\.subagents\?\.webhook\?\.dispatch/)
  assert.match(parser, /nextState\?: NextState/)
  assert.match(llmParser, /Dispatch Webhook/)
  assert.match(agent, /await consumeNextState/)
  assert.match(agent, /applyPostState/)
  assert.match(agent, /saveToArchive\(settled/)
  // Phase 3 item 4: postState audit bubbles live in coordinator finalization
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /postState\?\.status === 'failed'/)
  assert.match(coordinator, /finalizeTaskRun/)
  assert.match(dispatch, /nextState: snapshot\.overrides\.nextState/)
  assert.match(queue, /\| 'nextState'/)
  assert.match(settings, /webhookTarget: ''/)
  assert.match(settingsPage, /settings\.webhookTarget/)
  assert.match(preload, /webhook:dispatch/)
  assert.match(main, /webhook:dispatch/)
  assert.match(server, /export async function dispatchWebhook/)
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

await test('Phase 2e: plan bubble preserves source and classification reason', async () => {
  const fs = await import('node:fs')
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
  assert.match(parser, /export function resolvePlanBubbleMetadata/)
  assert.match(parser, /Trigger source：\$\{meta\.triggerSource\}/)
  assert.match(parser, /分類原因：\$\{meta\.classificationReason\}/)
  assert.match(parser, /ScheduledJob trigger/)
  assert.match(parser, /Webhook matcher evidence/)
  assert.match(parser, /由使用者手動指定/)
  assert.match(runExternal, /resolvePlanBubbleMetadata\(/)
  assert.match(runExternal, /sourceLabel: opts\.sourceLabel/)
  assert.match(engine, /sourceKind: this\.overrides\.sourceKind/)
  assert.match(engine, /classificationReason: this\.overrides\.classificationReason/)
  assert.match(queue, /\| 'triggerSource'/)
  assert.match(queue, /\| 'classificationReason'/)
  assert.match(queue, /triggerSource: o\.triggerSource/)
  assert.match(queue, /classificationReason: o\.classificationReason/)
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
  const textSim = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/textSimilarity.ts'), 'utf8')
  assert.match(memory, /buildPromptBlock\(enabled = true, objective\?: string\)/)
  assert.match(memory, /失敗教訓/)
  assert.match(memory, /scoreQueryText/)
  assert.match(memory, /buildFailureLessonsBlock/)
  assert.match(prompt, /buildContextPacket/)
  assert.match(prompt, /buildPromptBlock/)
  assert.match(learning, /onGoalFailure/)
  assert.match(learning, /toolCalls/)
  assert.match(learning, /tool:\$\{/)
  assert.match(learning, /strategy:\$\{/)
  assert.match(engine, /noteLearningFailure/)
  assert.match(engine, /sessionRecallEnabled|searchSessions/)
  assert.match(engine, /formatSessionRecallBlock|sessionRecallBlock/)
  assert.match(runExternal, /loopTypeMode/)
  assert.match(runExternal, /forcedLoopType|forceLoopType/)
  assert.match(textSim, /export function scoreQueryText/)
  const turn = engine.slice(engine.indexOf('private async runTurnBased'), engine.indexOf('private async runGoalBased'))
  assert.match(turn, /overrides\.unattended/)
  assert.match(turn, /waitForUser/)
  assert.match(turn, /sourceKind === 'composer'/)
  assert.match(skills, /export function cjkAwareHit/)
  assert.match(intent, /[一-鿿]|\\u4e00/)
})

await test('Phase 6: docs align concurrency, triggers, runners, no in-repo RTK.md', async () => {
  const fs = await import('node:fs')
  const agents = fs.readFileSync(path.join(appRoot, '../AGENTS.md'), 'utf8')
  const claude = fs.readFileSync(path.join(appRoot, '../CLAUDE.md'), 'utf8')
  const context = fs.readFileSync(path.join(appRoot, '../CONTEXT.md'), 'utf8')
  const flow = fs.readFileSync(path.join(appRoot, '../docs/CONVERSATION_LOOP_HERMES_FLOW.md'), 'utf8')
  const adr = fs.readFileSync(path.join(appRoot, '../docs/adr/0003-concurrent-run-lock-removal.md'), 'utf8')
  const plan = fs.readFileSync(
    path.join(appRoot, '../docs/TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14.md'),
    'utf8',
  )

  // No in-repo RTK.md; guidance points elsewhere
  assert.equal(fs.existsSync(path.join(appRoot, '../RTK.md')), false)
  assert.match(agents, /no in-repo `RTK\.md`|No in-repo `RTK\.md`|There is \*\*no in-repo `RTK\.md`\*\*/i)
  assert.match(claude, /No in-repo `RTK\.md`/i)

  // Concurrency language: default single, opt-in cap — not "always global mutex only"
  assert.match(agents, /default single run|預設單 run|concurrentRunsEnabled/i)
  assert.match(claude, /default single run|concurrentRunsEnabled|maxConcurrentRuns/i)
  assert.match(context, /concurrentRunsEnabled|opt-in|maxConcurrentRuns/i)
  assert.match(adr, /Default.*single-run|concurrentRunsEnabled/i)
  assert.doesNotMatch(agents, /isRunning` is a global mutex/)
  assert.doesNotMatch(claude, /isRunning` is a global mutex/)

  // Time/Proactive triggers
  assert.match(agents, /Time-based.*ScheduledJob|ScheduledJob trigger/i)
  assert.match(agents, /Proactive.*matcher|event matcher/i)
  assert.match(claude, /Time-based.*ScheduledJob|ScheduledJob/i)
  assert.match(flow, /Time-based.*ScheduledJob|claimed `ScheduledJob`/i)

  // Runner matrix + plan backlink
  assert.match(agents, /Runner capability matrix|executionKind/i)
  assert.match(claude, /executionKind: 'loop'|runners\//)
  assert.match(flow, /TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14/)
  assert.match(flow, /taskRunCoordinator/)
  assert.match(plan, /Phase 6 實作記錄/)
})

await test('Phase 5: runner capability matrix, honest CLI DoD, continueGoal gated', async () => {
  const fs = await import('node:fs')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/runners/types.ts'), 'utf8')
  const index = fs.readFileSync(path.join(appRoot, 'src/agent/runners/index.ts'), 'utf8')
  const localCli = fs.readFileSync(path.join(appRoot, 'src/agent/localCliRun.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const panel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  const runX = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')

  assert.match(types, /export type RunnerCapabilities/)
  assert.match(types, /export type ExecutionKind/)
  assert.match(types, /BUILTIN_RUNNER_CAPABILITIES/)
  assert.match(types, /EXTERNAL_CLI_RUNNER_CAPABILITIES/)
  assert.match(types, /continueGoal: false/)
  assert.match(types, /validateDoD: false/)
  assert.match(types, /EXTERNAL_CLI_DOD_LABEL/)
  assert.match(types, /formatCliContinueGoalPrompt/)
  assert.match(types, /isCompleteCliContinueGoalContract/)
  assert.match(index, /from '\.\/types'/)

  // Honest CLI DoD — never "CLI returned" as met
  assert.doesNotMatch(localCli, /definitionOfDone: 'CLI returned'/)
  assert.doesNotMatch(agent, /definitionOfDone: 'CLI returned'/)
  assert.match(localCli, /EXTERNAL_CLI_DOD_LABEL/)
  assert.match(agent, /EXTERNAL_CLI_DOD_LABEL/)
  assert.match(agent, /executionKind: 'external'/)
  assert.match(engine, /executionKind: 'loop'/)
  assert.match(dispatch, /executionKind: 'external'/)
  assert.match(dispatch, /executionKind: 'loop'/)

  // continueGoal UI gated; contract documented but capability stays false
  assert.match(panel, /canContinueGoal/)
  assert.match(panel, /EXTERNAL_CLI_UI_LABEL/)
  assert.match(panel, /外部 CLI 不支援/)
  assert.match(panel, /formatRunnerCapabilitiesSummary/)
  assert.match(runX, /capabilitiesForRunner/)
  assert.match(runX, /continueBlockedNote|不支援 continueGoal/)

  // Prompt contract fixture completeness (capability still false)
  assert.match(types, /## Definition of Done/)
  assert.match(types, /## Missing gaps/)
  assert.match(types, /## Prior digest/)
  assert.match(types, /## Project root/)
  assert.match(types, /## Approval mode/)
})

await test('Phase 4: ContextPacket slots, no final 2000-slice, onUserTurn ownership', async () => {
  const fs = await import('node:fs')
  const packet = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/contextPacket.ts'), 'utf8')
  const prompt = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  const session = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/sessionSearch.ts'), 'utf8')

  assert.match(packet, /export function buildContextPacket/)
  assert.match(packet, /export function formatSessionRecallBlock/)
  assert.match(packet, /failureLessons/)
  assert.match(packet, /sessionRecall/)
  assert.match(packet, /includedChars/)
  assert.match(packet, /CONTEXT_PACKET_TOTAL_BUDGET/)
  assert.match(packet, /temporary chat/)

  // No whole-blob final extraContext.slice(0, 2000) in prompt builder
  assert.doesNotMatch(prompt, /extraContext\.slice\(\s*0\s*,\s*2000\s*\)/)
  assert.match(prompt, /buildContextPacket/)
  assert.match(prompt, /packetDiagnostics/)

  // onUserTurn only from coordinator user chat; onGoalSuccess must not call it
  assert.match(runExternal, /learningLoop\.onUserTurn/)
  assert.match(runExternal, /sourceKind === 'composer'/)
  const successBody = learning.slice(
    learning.indexOf('onGoalSuccess(input'),
    learning.indexOf('onGoalFailure(input'),
  )
  assert.doesNotMatch(successBody, /this\.onUserTurn\(/)
  assert.doesNotMatch(engine, /learningLoop\.onUserTurn\(/)

  assert.match(session, /scoreQueryText/)
  assert.match(learning, /getUserTurnCount/)
})

await test('attachments: tiny vision images are upscaled above provider minimum', async () => {
  const fs = await import('node:fs')
  const attachments = fs.readFileSync(path.join(appRoot, 'src/lib/chatAttachments.ts'), 'utf8')
  assert.match(attachments, /MIN_VISION_IMAGE_PIXELS = 512/)
  assert.match(attachments, /visionImageDimensions/)
  assert.match(attachments, /normalizeImageAttachmentsForVision/)
  // Phase 3 item 2: attachment normalize owned by coordinator prepareRunAttachments
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /normalizeImageAttachmentsForVision/)
  assert.match(coordinator, /prepareRunAttachments/)
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(runExternal, /prepareRunAttachments/)
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

await test('Open Design Phase 0/1/2: inventory, safe pack boundary, project copy, and provenance wiring', async () => {
  const fs = await import('node:fs')
  const inventoryPath = path.join(appRoot, 'public/open-design/OPEN_DESIGN_INVENTORY.json')
  assert.ok(fs.existsSync(inventoryPath), 'inventory must be generated before smoke')
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
  assert.equal(inventory.version, 1)
  assert.ok(Array.isArray(inventory.records) && inventory.records.length > 0)
  assert.ok(inventory.records.every((r) => typeof r.digest === 'string' && r.digest.length >= 16))
  assert.ok(inventory.records.every((r) => (r.assetPaths || []).every((p) => !p.startsWith('/') && !p.includes('..'))))
  assert.equal(inventory.records.some((r) => /(^|\/)AGENTS\.md$/i.test(r.sourcePath)), false, 'vendor guidance files must not become packs')
  for (const record of inventory.records.filter((r) => r.kind === 'design-system')) {
    assert.ok((record.assetPaths || []).some((asset) => /(^|\/)DESIGN\.md$/i.test(asset)), 'design-system packs must carry DESIGN.md')
  }
  const catalog = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/catalog.ts'), 'utf8')
  const packs = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/packs.ts'), 'utf8')
  const packStore = fs.readFileSync(path.join(appRoot, 'src/store/openDesignPackStore.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  assert.match(catalog, /parseOpenDesignInventory/)
  assert.match(catalog, /readOpenDesignText/)
  assert.match(packs, /customTools: \[\]/)
  assert.match(packs, /mcpServers: \[\]/)
  assert.match(packStore, /pluginRegistry\.add/)
  assert.match(packs, /remote-unverified pack 預設停用/)
  assert.match(main, /subdesign:copyVendorPack/)
  assert.match(main, /Open Design pack 超過複製大小限制/)
  assert.match(main, /design-system pack 必須包含 DESIGN\.md/)
  assert.match(preload, /copyVendorPack/)
  assert.match(preload, /designSystemPath/)
  assert.match(page, /loadOpenDesignCatalog/)
  assert.match(page, /provenance: selectedCatalogRecord/)
})

await test('Open Design Phase 3: shared adapter contract and Gemini diagnostic', async () => {
  const fs = await import('node:fs')
  const adapters = fs.readFileSync(path.join(appRoot, 'src/agent/cliAdapters.ts'), 'utf8')
  const localRenderer = fs.readFileSync(path.join(appRoot, 'src/agent/localCliRun.ts'), 'utf8')
  const localMain = fs.readFileSync(path.join(appRoot, 'electron/localCliRunner.ts'), 'utf8')
  const discover = fs.readFileSync(path.join(appRoot, 'electron/cliDiscover.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  assert.match(adapters, /export type CliAdapterDefinition/)
  for (const id of ['codex', 'claude', 'opencode', 'gemini', 'cursor']) assert.match(adapters, new RegExp(`id: '${id}'`))
  assert.match(adapters, /buildInvocation/)
  assert.match(adapters, /parseEvent/)
  assert.match(adapters, /DISCOVERY_ONLY_AGENT_ADAPTERS/)
  assert.match(localRenderer, /'gemini'/)
  assert.match(localMain, /case 'gemini'/)
  assert.match(localMain, /kind === 'gemini'/)
  assert.match(discover, /name: 'Gemini CLI'/)
  assert.match(dispatch, /kind === 'gemini' \? 'google'/)
})

await test('ADR3 follow-up: interactive entry points snapshot projectRoot at dispatch (no implicit global fallback)', async () => {
  const fs = await import('node:fs')
  const protocols = fs.readFileSync(path.join(appRoot, 'src/pages/ProtocolsPage.tsx'), 'utf8')
  const slash = fs.readFileSync(path.join(appRoot, 'src/hooks/useSlashExecutor.ts'), 'utf8')
  const inlinePanel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  const runContext = fs.readFileSync(path.join(appRoot, 'src/agent/tools/runContext.ts'), 'utf8')
  // Each interactive runTask() call must snapshot the active project explicitly —
  // a concurrent run must not silently re-resolve to whatever project the UI
  // switches to mid-flight. See docs/adr/0003-concurrent-run-lock-removal.md.
  assert.match(protocols, /runTask\(\{[\s\S]{0,400}projectRoot: projectRoot \|\| undefined/)
  assert.match(slash, /runTask\(\{[\s\S]{0,400}projectRoot: projectRoot\(\) \|\| undefined/)
  assert.match(inlinePanel, /runTask\(\{[\s\S]{0,600}projectRoot: useProjectStore\.getState\(\)\.root \|\| undefined/)
  assert.match(runContext, /should therefore be unreachable during a real run/)
})

// ── Phase 0 (grok-build plan G1/G3): LLM resilience + token estimation ──
// Mirrors agent/llmResilience.ts CircuitBreaker / backoff and
// agent/tokenEstimate.ts math. Keep in sync with the TS source.

class MirrorBreaker {
  constructor(cfg, now) {
    this.cfg = { windowMs: 60_000, minSamples: 5, errorRateThreshold: 0.5, cooldownMs: 30_000, ...cfg }
    this.now = now
    this.samples = []
    this.state = 'closed'
    this.openedAt = 0
    this.probing = false
  }
  allowRequest() {
    const at = this.now()
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (at - this.openedAt >= this.cfg.cooldownMs) {
        this.state = 'half-open'
        this.probing = true
        return true
      }
      return false
    }
    if (this.probing) return false
    this.probing = true
    return true
  }
  record(ok) {
    const at = this.now()
    if (this.state === 'half-open') {
      this.probing = false
      if (ok) {
        this.state = 'closed'
        this.samples = []
      } else {
        this.state = 'open'
        this.openedAt = at
      }
      return
    }
    this.samples.push({ at, ok })
    const cutoff = at - this.cfg.windowMs
    while (this.samples.length && this.samples[0].at < cutoff) this.samples.shift()
    if (this.state === 'closed') {
      const n = this.samples.length
      if (n >= this.cfg.minSamples) {
        const errors = this.samples.filter((s) => !s.ok).length
        if (errors / n >= this.cfg.errorRateThreshold) {
          this.state = 'open'
          this.openedAt = at
        }
      }
    }
  }
}

await test('circuit breaker: needs minSamples before tripping', () => {
  let t = 0
  const b = new MirrorBreaker({ minSamples: 5 }, () => t)
  // 4 straight failures — below minSamples, must stay closed
  for (let i = 0; i < 4; i++) { assert.equal(b.allowRequest(), true); b.record(false); t += 100 }
  assert.equal(b.state, 'closed')
  // 5th failure crosses minSamples at 100% error rate → open
  b.record(false)
  assert.equal(b.state, 'open')
  assert.equal(b.allowRequest(), false)
})

await test('circuit breaker: error rate below threshold stays closed', () => {
  let t = 0
  const b = new MirrorBreaker({ minSamples: 5, errorRateThreshold: 0.5 }, () => t)
  // 6 ok + 2 fail = 25% error rate < 50%
  for (let i = 0; i < 6; i++) { b.record(true); t += 10 }
  b.record(false); b.record(false)
  assert.equal(b.state, 'closed')
})

await test('circuit breaker: cooldown → half-open probe; success closes, failure reopens', () => {
  let t = 0
  const b = new MirrorBreaker({ minSamples: 3, cooldownMs: 30_000 }, () => t)
  b.record(false); b.record(false); b.record(false)
  assert.equal(b.state, 'open')
  t += 10_000
  assert.equal(b.allowRequest(), false, 'still cooling down')
  t += 25_000
  assert.equal(b.allowRequest(), true, 'half-open probe allowed')
  assert.equal(b.allowRequest(), false, 'only one probe at a time')
  b.record(false)
  assert.equal(b.state, 'open', 'failed probe reopens')
  t += 30_000
  assert.equal(b.allowRequest(), true)
  b.record(true)
  assert.equal(b.state, 'closed', 'successful probe closes')
  assert.equal(b.samples.length, 0, 'window cleared on close')
})

await test('circuit breaker: old samples evicted from sliding window', () => {
  let t = 0
  const b = new MirrorBreaker({ windowMs: 60_000, minSamples: 5 }, () => t)
  for (let i = 0; i < 4; i++) { b.record(false); t += 100 }
  // 4 failures age out of the window → later failures start fresh
  t += 61_000
  b.record(false)
  assert.equal(b.state, 'closed', 'evicted samples must not count toward trip')
  assert.equal(b.samples.length, 1)
})

await test('llm retry: error classification + backoff math', () => {
  const isRetryable = (message) => {
    const m = /HTTP (\d{3})/.exec(message)
    if (m) {
      const status = Number(m[1])
      return status === 429 || status === 408 || status >= 500
    }
    return /network|failed to fetch|fetch failed|timeout|timed out|econn|enotfound|eai_again|socket|und_err|aborted/i.test(message)
  }
  assert.equal(isRetryable('LLM HTTP 429 (retry-after:7s): rate limit'), true)
  assert.equal(isRetryable('LLM HTTP 503: upstream'), true)
  assert.equal(isRetryable('LLM HTTP 401: bad key'), false)
  assert.equal(isRetryable('LLM HTTP 400: bad request'), false)
  assert.equal(isRetryable('TypeError: Failed to fetch'), true)

  const backoff = (attempt, retryAfterMs, jitter = () => 0) => {
    if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000)
    return Math.min(2000 * 2 ** Math.max(0, attempt), 16_000) + Math.floor(jitter() * 250)
  }
  assert.equal(backoff(0), 2000)
  assert.equal(backoff(1), 4000)
  assert.equal(backoff(2), 8000)
  assert.equal(backoff(5), 16_000, 'exponential capped at 16s')
  assert.equal(backoff(0, 7000), 7000, 'server retry-after wins')
  assert.equal(backoff(0, 90_000), 30_000, 'retry-after capped at 30s')

  const parseRetryAfter = (message) => {
    const m = /retry-after:(\d+)s/.exec(message)
    if (!m) return undefined
    const s = Number(m[1])
    return s > 0 ? s * 1000 : undefined
  }
  assert.equal(parseRetryAfter('LLM HTTP 429 (retry-after:7s): x'), 7000)
  assert.equal(parseRetryAfter('LLM HTTP 500: x'), undefined)
})

await test('token estimate: bytes/4 heuristic + preflight gate', () => {
  const estimate = (text) => (text ? Math.ceil(new TextEncoder().encode(text).length / 4) : 0)
  assert.equal(estimate(''), 0)
  assert.equal(estimate('abcd'), 1)
  assert.equal(estimate('abcde'), 2)
  // CJK: 3 bytes/char → 4 chars = 12 bytes = 3 tokens
  assert.equal(estimate('中文字元'), 3)

  const shouldCompact = (tokens, cw, reserve = 2500) => tokens > Math.max(1024, cw - reserve)
  assert.equal(shouldCompact(61_000, 64_000), false)
  assert.equal(shouldCompact(61_501, 64_000), true)
  assert.equal(shouldCompact(1_025, 2_000), true, 'tiny window floors at 1024')
  assert.equal(shouldCompact(1_000, 2_000), false)
})

await test('drift guard: llm.ts routes calls through callWithResilience', async () => {
  const fs = await import('node:fs')
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  assert.match(llm, /callWithResilience\(/)
  assert.match(llm, /breakerKey\(settings\.baseUrl/)
  assert.match(llm, /maxAttempts: settings\.llmRetryMaxAttempts/)
})

await test('drift guard: toolLoop preflights context overflow via tokenEstimate', async () => {
  const fs = await import('node:fs')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /resolveContextWindow\(settings, settings\.model\)/)
  assert.match(loop, /shouldPreflightCompact\(estTokens, contextWindow\)/)
  assert.match(loop, /force: true/)
})

// ── Phase 1 (grok-build plan G2): tool-result pruning + compaction flush ──
// Mirrors agent/contextPruning.ts. Keep in sync with the TS source.

const HARD_CLEAR_MARKER = '〔工具結果已由 pruning 清除'
const SOFT_TRIM_MARKER = '…〔pruning 截斷 '

function pruneToolResults(messages, cfg) {
  cfg = {
    enabled: true, keepLastNRounds: 3, softTrimThresholdChars: 4000,
    softTrimHeadChars: 1500, softTrimTailChars: 1500, hardClearAgeRounds: 10, ...cfg,
  }
  const stats = { changed: false, softTrimmed: 0, hardCleared: 0, savedChars: 0 }
  if (!cfg.enabled) return { messages, stats }
  const totalRounds = messages.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length
  if (totalRounds === 0) return { messages, stats }
  let roundIdx = 0
  const next = messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) { roundIdx += 1; return m }
    if (m.role !== 'tool' || typeof m.content !== 'string') return m
    const age = totalRounds - roundIdx
    if (age < cfg.keepLastNRounds) return m
    const content = m.content
    if (content.includes(HARD_CLEAR_MARKER) || content.includes(SOFT_TRIM_MARKER)) return m
    if (age >= cfg.hardClearAgeRounds) {
      const replaced = `${HARD_CLEAR_MARKER}（${age} 輪前，原 ${content.length} chars）— 需要此結果時請重新呼叫工具〕`
      if (replaced.length >= content.length) return m
      stats.changed = true
      stats.hardCleared += 1
      stats.savedChars += content.length - replaced.length
      return { ...m, content: replaced }
    }
    if (content.length > cfg.softTrimThresholdChars) {
      const head = content.slice(0, cfg.softTrimHeadChars)
      const tail = content.slice(-cfg.softTrimTailChars)
      const cut = content.length - head.length - tail.length
      const trimmed = `${head}\n${SOFT_TRIM_MARKER}${cut} chars（${age} 輪前）〕\n${tail}`
      if (trimmed.length >= content.length) return m
      stats.changed = true
      stats.softTrimmed += 1
      stats.savedChars += content.length - trimmed.length
      return { ...m, content: trimmed }
    }
    return m
  })
  return { messages: stats.changed ? next : messages, stats }
}

function fcRound(id, toolContent) {
  return [
    { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'bash', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: id, content: toolContent },
  ]
}

await test('pruning: recent keepLastNRounds tool results stay untouched', () => {
  const big = 'x'.repeat(6000)
  const messages = [
    { role: 'user', content: 'go' },
    ...fcRound('a', big), ...fcRound('b', big), ...fcRound('c', big),
  ]
  const { messages: out, stats } = pruneToolResults(messages, { keepLastNRounds: 3 })
  assert.equal(stats.changed, false)
  assert.equal(out, messages, 'unchanged input returns same reference')
})

await test('pruning: old oversized tool result gets head/tail soft-trim', () => {
  const big = 'H'.repeat(2000) + 'M'.repeat(3000) + 'T'.repeat(2000)
  const messages = [
    ...fcRound('a', big),
    ...fcRound('b', 'ok'), ...fcRound('c', 'ok'), ...fcRound('d', 'ok'),
  ]
  const { messages: out, stats } = pruneToolResults(messages)
  assert.equal(stats.softTrimmed, 1)
  const pruned = out[1].content
  assert.ok(pruned.startsWith('H'.repeat(1500)), 'head preserved')
  assert.ok(pruned.endsWith('T'.repeat(1500)), 'tail preserved')
  assert.ok(pruned.includes(SOFT_TRIM_MARKER))
  assert.ok(pruned.length < big.length)
})

await test('pruning: tool results older than hardClearAgeRounds become placeholders', () => {
  const rounds = []
  for (let i = 0; i < 12; i++) rounds.push(...fcRound(`r${i}`, `result-${i} ` + 'z'.repeat(300)))
  const { messages: out, stats } = pruneToolResults(rounds)
  assert.ok(stats.hardCleared >= 1)
  assert.ok(out[1].content.includes(HARD_CLEAR_MARKER), 'oldest round cleared')
  // FC chain intact: every tool message still has its tool_call_id
  for (const m of out) {
    if (m.role === 'tool') assert.ok(m.tool_call_id, 'tool_call_id preserved')
  }
  assert.equal(out.filter((m) => m.role === 'assistant').length, 12, 'no messages removed')
})

await test('pruning: idempotent — second pass changes nothing', () => {
  const rounds = []
  for (let i = 0; i < 12; i++) rounds.push(...fcRound(`r${i}`, 'y'.repeat(5000)))
  const first = pruneToolResults(rounds)
  assert.equal(first.stats.changed, true)
  const second = pruneToolResults(first.messages)
  assert.equal(second.stats.changed, false, 'already-pruned content is skipped')
})

await test('drift guard: compaction applies pruning and returns pruneStats', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/opencode/compaction.ts'), 'utf8')
  assert.match(src, /pruneToolResults\(messages, DEFAULT_PRUNING_CONFIG\)/)
  assert.match(src, /pruneStats\?: PruneStats/)
})

await test('drift guard: toolLoop wires checkpoint + memory flush + post-compaction recall', async () => {
  const fs = await import('node:fs')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /saveCompactionCheckpoint\(/)
  assert.match(loop, /onPreCompactionFlush\(/)
  assert.match(loop, /壓縮後記憶召回/)
  assert.match(loop, /onContextUsage\?\.\(\{ tokens: estTokens, contextWindow, ratio: usageRatio \}\)/)
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  assert.match(learning, /onPreCompactionFlush\(input/)
  assert.match(learning, /textSimilarity\(flushText, prev\.text\) >= 0\.85/)
})

// ── Phase 3 (grok-build plan G6): memory temporal decay + dream gates ──
// Mirrors agent/hermes/memory.ts decay math and hermes/dream.ts gates.

await test('memory decay: auto/flush half-life 7d; manual entries exempt', () => {
  const HALF_LIFE_DAYS = 7
  const DAY = 86_400_000
  const decayFactor = (entry, nowMs) => {
    if (!(entry.tags || []).some((t) => t === 'auto' || t === 'flush')) return 1
    const created = Date.parse(entry.createdAt || '')
    if (!Number.isFinite(created)) return 1
    const age = nowMs - created
    if (age <= 0) return 1
    return 0.5 ** (age / (HALF_LIFE_DAYS * DAY))
  }
  const now = Date.parse('2026-07-16T00:00:00Z')
  const at = (daysAgo) => new Date(now - daysAgo * DAY).toISOString()
  assert.equal(decayFactor({ createdAt: at(7), tags: ['auto'] }, now).toFixed(3), '0.500')
  assert.equal(decayFactor({ createdAt: at(14), tags: ['flush'] }, now).toFixed(3), '0.250')
  assert.equal(decayFactor({ createdAt: at(0), tags: ['auto'] }, now), 1)
  assert.equal(decayFactor({ createdAt: at(30), tags: ['success'] }, now), 1, '手寫/curated 不衰減')
})

await test('dream gates: ≥4h since last run AND ≥3 new machine entries', () => {
  const dreamDue = (nowMs, lastRunAtIso, newEntries) => {
    const last = Date.parse(lastRunAtIso || '')
    const hoursOk = !Number.isFinite(last) || nowMs - last >= 4 * 3_600_000
    return hoursOk && newEntries >= 3
  }
  const now = Date.parse('2026-07-16T12:00:00Z')
  assert.equal(dreamDue(now, undefined, 3), true, '從未跑過且量夠 → due')
  assert.equal(dreamDue(now, undefined, 2), false, '量不夠')
  assert.equal(dreamDue(now, '2026-07-16T10:00:00Z', 5), false, '2h 前跑過 → 未到')
  assert.equal(dreamDue(now, '2026-07-16T07:59:00Z', 5), true, '4h 已過且量夠')
})

await test('drift guard: memory decay + staleness + dream wiring', async () => {
  const fs = await import('node:fs')
  const memory = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/memory.ts'), 'utf8')
  assert.match(memory, /MEMORY_DECAY_HALF_LIFE_DAYS = 7/)
  assert.match(memory, /score \*= memoryDecayFactor\(e\)/)
  assert.match(memory, /memoryStalenessNote\(entry\)/)
  const dream = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/dream.ts'), 'utf8')
  assert.match(dream, /DREAM_MIN_HOURS = 4/)
  assert.match(dream, /DREAM_MIN_NEW_ENTRIES = 3/)
  assert.match(dream, /memoryEnabled === false \|\| settings\.memoryWriteEnabled === false/)
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  assert.match(app, /scheduleDreamConsolidation\(settings\)/)
})

await test('drift guard: rewind snapshots wired into write tools + thread rewind', async () => {
  const fs = await import('node:fs')
  const executor = fs.readFileSync(path.join(appRoot, 'src/agent/tools/executor.ts'), 'utf8')
  for (const kind of ["kind: 'write'", "kind: 'delete'", "kind: 'move'"]) {
    assert.ok(executor.includes(kind), `executor records rewind ${kind}`)
  }
  const store = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  assert.match(store, /rewindToBubble/)
  assert.match(store, /lastCapabilityIds: undefined/)
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  assert.match(preload, /rewind:restore/)
})

// ── Phase 4 (grok-build plan G7+G8): hooks expansion + plan mode wiring ──

await test('drift guard: plan mode enforced in toolGuard before approvalMode; cleared at finalize', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /isPlanModeActive\(opts\.runId\)/)
  assert.match(guard, /planModeToolDecision\(/)
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /clearPlanMode\(runId\)/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /ENTER_PLAN_MODE_TOOL \|\| tc\.name === EXIT_PLAN_MODE_TOOL/)
  assert.match(loop, /unattended/, 'plan tools gated for unattended runs')
})

await test('drift guard: new hook points are passive-only and wired', async () => {
  const fs = await import('node:fs')
  const hooks = fs.readFileSync(path.join(appRoot, 'src/agent/hooks.ts'), 'utf8')
  for (const point of ['permissionDenied', 'beforeCompaction', 'afterCompaction', 'delegateStart', 'delegateEnd', 'userTurn']) {
    assert.match(hooks, new RegExp(`${point}: \\['log', 'notify'\\]`), `${point} passive-only`)
  }
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /point: 'beforeCompaction'/)
  assert.match(loop, /point: 'afterCompaction'/)
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.match(delegate, /'delegateStart'/)
  assert.match(delegate, /emitDelegateHook\('delegateEnd', r\.ok\)/)
  const runExternal = fs.readFileSync(path.join(appRoot, 'src/agent/runExternal.ts'), 'utf8')
  assert.match(runExternal, /point: 'userTurn'/)
})

await test('drift guard: project hooks require folder trust and stay sanitized', async () => {
  const fs = await import('node:fs')
  const project = fs.readFileSync(path.join(appRoot, 'src/agent/projectHooks.ts'), 'utf8')
  assert.match(project, /isProjectHooksTrusted\(settings, root\)/)
  assert.match(project, /skipped: 'untrusted'/)
  assert.match(project, /sanitizeHookRules\(raw, 'project'\)/)
  const hooks = fs.readFileSync(path.join(appRoot, 'src/agent/hooks.ts'), 'utf8')
  assert.match(hooks, /activeProjectHookRules\(\)/)
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /hydrateProjectHooks\(opts\.settings, opts\.projectRoot\)/)
})

// ── Phase 5 (grok-build plan G9/G10/G11): wiring drift guards ──

await test('drift guard: delegate capability_mode stacks on role blocks; wait primitives wired', async () => {
  const fs = await import('node:fs')
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.match(delegate, /blockedToolsForCapabilityMode\(input\.capabilityMode\)/)
  assert.match(delegate, /roleBlocked/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /capability_mode/)
  assert.match(loop, /parseCapabilityMode\(/)
  const jobs = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  assert.match(jobs, /export async function waitBackgroundJobs/)
  assert.match(jobs, /wait_any/)
  const executor = fs.readFileSync(path.join(appRoot, 'src/agent/tools/executor.ts'), 'utf8')
  assert.match(executor, /waitBackgroundJobs\(/)
})

await test('drift guard: metrics recorded at coordinator settle + guard/loop bumps', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /finalizeRunMetric\(runId/)
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /bumpRunMetric\(opts\.runId, 'toolAsks'\)/)
  assert.match(guard, /'toolDenials'\)/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /'compactions'\)/)
  assert.match(loop, /'llmRetries'\)/)
})

// ── Phase 5 遞延項 (G9b/c/d + G10 monitor): wiring drift guards ──

await test('drift guard: persona resolution — role > persona > parent; unknown persona fails spawn', async () => {
  const fs = await import('node:fs')
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.match(delegate, /settings\.delegatePersonas\?\.\[input\.persona\]/)
  assert.match(delegate, /persona「\$\{input\.persona\}」不存在/)
  assert.match(delegate, /roleResolved\.source === 'role'\s*\?\s*roleResolved\.model\s*:\s*persona\?\.model/)
})

await test('drift guard: resume_from requires finished job; worktree isolation falls back safely', async () => {
  const fs = await import('node:fs')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /resume_from 失敗:找不到背景委派/)
  assert.match(loop, /尚未完成/)
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.match(delegate, /worktreeCreate\?\.\(/)
  assert.match(delegate, /回退共用 workspace/)
  const bridge = fs.readFileSync(path.join(appRoot, 'electron/projectBridge.ts'), 'utf8')
  assert.match(bridge, /git worktree add -b/)
  assert.match(bridge, /git apply --3way/, 'apply 衝突失敗而非覆蓋')
  assert.match(bridge, /git worktree remove --force/)
})

await test('drift guard: monitor tool gated like bash and feeds eventMatcher', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /tool === 'monitor' && String\(input\.action \|\| ''\) === 'start'/)
  const builtins = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/builtins.ts'), 'utf8')
  assert.match(builtins, /approvalTools: \['monitor'\]/)
  const bridge = fs.readFileSync(path.join(appRoot, 'electron/monitorBridge.ts'), 'utf8')
  assert.match(bridge, /MAX_LINES_PER_WINDOW/, 'volume control present')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  assert.match(app, /source: 'monitor'/)
  assert.match(app, /eventPreMatched: true/)
})

console.log(`\n${passed} capability smoke tests passed, ${skipped} skipped`)
if (process.exitCode) {
  console.error('Capability smoke failed')
} else {
  console.log('OK')
}
