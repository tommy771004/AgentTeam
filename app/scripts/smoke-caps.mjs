/**
 * Pure-logic smoke tests for capability runtime + compaction alignment.
 * Run: node scripts/smoke-caps.mjs  (via tsx import of TS source)
 * Or:  npx tsx scripts/smoke-caps.mjs
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

let passed = 0
function test(name, fn) {
  try {
    fn()
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

test('alignKeepStart does not orphan tool messages', () => {
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

test('blockedTools strips empty capabilities from catalog', () => {
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

test('approvalRequiredFor only when capability active', () => {
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

test('intent preload is capped and project preload adds codegraph/workspace', () => {
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

test('model tuning preserves baseline and shrinks small-context budgets', () => {
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

test('tool search hides over threshold except unlocked/always-on', () => {
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

test('automation queue dedupe key', () => {
  const a = dedupeKey({ objective: '  run me  ', loopType: 'Time-based', sourceLabel: 'cron' })
  const b = dedupeKey({ objective: 'run me', loopType: 'Time-based', sourceLabel: 'cron' })
  assert.equal(a, b)
  const c = dedupeKey({ objective: 'run me', loopType: 'Proactive', sourceLabel: 'cron' })
  assert.notEqual(a, c)
})

test('runQueue remove/clear/hydrate APIs exist in source', async () => {
  const fs = await import('node:fs')
  const p = path.join(appRoot, 'src/agent/runQueue.ts')
  const src = fs.readFileSync(p, 'utf8')
  assert.match(src, /export function removeQueuedRun/)
  assert.match(src, /export function clearRunQueue/)
  assert.match(src, /export function hydrateRunQueue/)
  assert.match(src, /subagents\.runQueue\.v1/)
  assert.match(src, /skipReason:\s*'cancelled'/)
})

test('permissionAskStore tracks timedOut + runStats for archive', async () => {
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
test('codeMode worker source disables fetch', async () => {
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

test('approvalMode: full skips asks, always asks side-effect tools, auto passes through', () => {
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

test('approvalMode: unattended downgrades full → auto (never unsupervised full access)', () => {
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
  if (kind === 'codex' || kind === 'claude') return { mode: 'full', permissive: true }
  return { mode: 'auto', permissive: false }
}

test('CLI approval mapping permits only interactive Codex/Claude full mode', async () => {
  assert.deepEqual(resolveCliApproval('codex', 'full', false, 'build'), { mode: 'full', permissive: true })
  assert.deepEqual(resolveCliApproval('claude', 'full', false, 'build'), { mode: 'full', permissive: true })
  assert.deepEqual(resolveCliApproval('codex', 'full', true, 'build'), { mode: 'auto', permissive: false })
  assert.deepEqual(resolveCliApproval('claude', 'full', false, 'plan'), { mode: 'auto', permissive: false })
  assert.deepEqual(resolveCliApproval('grok', 'full', false, 'build'), { mode: 'auto', permissive: false })
  const fs = await import('node:fs')
  const source = fs.readFileSync(path.join(appRoot, 'electron/localCliRunner.ts'), 'utf8')
  assert.match(source, /--full-auto/)
  assert.match(source, /--dangerously-skip-permissions/)
  assert.match(source, /Safe fallback is intentional/)
})

test('custom tools: bash_template always approval-gated; toolLoop passes sideEffect hint', async () => {
  const fs = await import('node:fs')
  const custom = fs.readFileSync(path.join(appRoot, 'src/agent/tools/customTools.ts'), 'utf8')
  assert.match(custom, /kind === 'bash_template' \|\| tool\.requiresApproval === true/)
  assert.match(custom, /\^\[A-Za-z\]\[A-Za-z0-9_-\]\{0,63\}\$/)
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /sideEffect: Boolean\(custom\)/)
  assert.match(loop, /sideEffect: Boolean\(ctx\.customMap\.get\(name\)\)/)
})

test('side-effect drift guard: every registry tool is read-only OR classified', async () => {
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

test('toolGuard source wires decideApprovalNeed + full-mode safety bypass exists in engine', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /decideApprovalNeed/)
  assert.match(guard, /approvalMode/)
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.match(engine, /approvalMode === 'full'/)
})

console.log(`\n${passed} capability smoke tests passed`)
if (process.exitCode) {
  console.error('Capability smoke failed')
} else {
  console.log('OK')
}
