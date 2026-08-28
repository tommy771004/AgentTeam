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

function readTaskRunRuntimeSource(fs) {
  // runExternal.ts retired — policy + coordinator + types + OpenCode mapping/sync
  return [
    fs.readFileSync(path.join(appRoot, 'src/agent/taskRunTypes.ts'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'src/agent/taskRunPolicy.ts'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'src/agent/opencode/sessionMapping.ts'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'src/agent/opencode/sessionSync.ts'), 'utf8'),
  ].join('\n')
}

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
  assert.match(src, /resolve: \(requestId[^)]*answer\?/)
  // ask_user is HITL by definition: it always pops (sessionAllow shortcut
  // skipped) and its schema carries structured-question parameters.
  assert.match(src, /tool === 'ask_user'/)
  const askTool = fs.readFileSync(path.join(appRoot, 'electron/piExtensionPacks/interactionPlanning.ts'), 'utf8')
  assert.match(askTool, /name: 'ask_user'[\s\S]*options: \{[\s\S]*maxItems: 12/)
  assert.match(askTool, /multiSelect: \{ type: 'boolean'/)
  assert.match(askTool, /allowFreeform: \{ type: 'boolean'/)
  assert.match(askTool, /hitl: true/)
  const policy = fs.readFileSync(path.join(appRoot, 'electron/piPolicyEvidence.ts'), 'utf8')
  assert.match(policy, /effectiveMode !== 'full' \|\| input\.requirements\.hitl/)
  const modal = fs.readFileSync(path.join(appRoot, 'src/components/PermissionAskModal.tsx'), 'utf8')
  assert.match(modal, /current\.runId/)
  assert.match(modal, /resolve\(current\.id, 'allow'/)
  assert.match(modal, /resolve\(current\.id, 'deny'\)/)
})

// ── approvalMode decision: mirrors removed — see smoke-approval-decision.mts ──
// Real import of decide() / decideApprovalNeed / effectiveApprovalMode lives there.

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
  const runExternal = readTaskRunRuntimeSource(fs)
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
  const settings = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(access, /mcpAgentServers/)
  assert.match(access, /hasOwnProperty\.call\(map, agentId\)/)
  assert.match(settings, /Per-agent MCP/)
  assert.match(settings, /secret owner/)
})

await test('Sub Agent switch defaults off and gates role/delegate paths', async () => {
  const fs = await import('node:fs')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
  const runtime = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/runtime.ts'), 'utf8')
  const decision = fs.readFileSync(path.join(appRoot, 'src/agent/tools/approvalDecision.ts'), 'utf8')
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  const background = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(types, /subAgentsEnabled: boolean/)
  assert.match(llm, /subAgentsEnabled: false/)
  // The legacy engine/loop that used to host the primary-vs-subagent dispatch
  // is gone (ADR-0045). The role-model call itself still lives in llm.ts and
  // the gate is enforced by the approval decision + delegate seams below.
  const llmDispatch = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  assert.match(llmDispatch, /export async function runPrimaryAgentTask/)
  assert.match(runExternal, /opts\.sourceKind === 'delegate'/)
  assert.match(runtime, /capability\.id !== 'delegate'/)
  assert.match(decision, /Sub Agent 功能目前已關閉/)
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

await test('custom tools: bash_template always approval-gated', async () => {
  const fs = await import('node:fs')
  const custom = fs.readFileSync(path.join(appRoot, 'src/agent/tools/customTools.ts'), 'utf8')
  assert.match(custom, /kind === 'bash_template' \|\| tool\.requiresApproval === true/)
  assert.match(custom, /\^\[A-Za-z\]\[A-Za-z0-9_-\]\{0,63\}\$/)
})

await test('side-effect drift guard: every registry tool is read-only OR classified', async () => {
  const fs = await import('node:fs')
  const registry = fs.readFileSync(path.join(appRoot, 'src/agent/tools/registry.ts'), 'utf8')
  // SIDE_EFFECT_TOOLS lives in toolGuardShared (leaf); toolGuard re-exports it.
  const guardShared = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuardShared.ts'), 'utf8')
  const builtins = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/builtins.ts'), 'utf8')

  // ToolName is derived from TOOL_DEFINITIONS keys (single source)
  const defs = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolDefinitions.ts'), 'utf8')
  const names = [...defs.matchAll(/^  ([a-z0-9_]+): \{/gm)].map((m) => m[1])
  assert.ok(names.length >= 20, `parsed ${names.length} tool names from toolDefinitions`)

  // 唯讀白名單：新工具必須加入這裡「或」進 SIDE_EFFECT_TOOLS / approvalTools，二選一
  const READ_ONLY = new Set([
    'workspace_list', 'workspace_read', 'workspace_grep', 'workspace_glob', 'tool_output_read', 'workspace_diff', 'datetime_now',
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
  const sideEffectBlock = guardShared.slice(
    guardShared.indexOf('SIDE_EFFECT_TOOLS'),
    guardShared.indexOf('])', guardShared.indexOf('SIDE_EFFECT_TOOLS')),
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

await test('toolGuard adapter wires pure decide() + full-mode safety bypass exists in engine', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /from '\.\/approvalDecision(\.ts)?'/)
  assert.match(guard, /\bdecide\b/)
  const decision = fs.readFileSync(path.join(appRoot, 'src/agent/tools/approvalDecision.ts'), 'utf8')
  assert.match(decision, /export function decide\b/)
  assert.match(decision, /export function decideApprovalNeed\b/)
  // Full-mode handling now lives entirely in the approval decision, which the
  // Pi Host tool gate consults — including the unattended downgrade that stops
  // `full` from silently skipping asks in automation.
  assert.match(decision, /if \(m === 'full' && unattended\) return 'auto'/)
  assert.match(decision, /mode === 'full'/)
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
    'src/pages/SuccessPage.tsx',
    'src/pages/OpsPage.tsx',
  ]
  for (const f of files) {
    const src = fs.readFileSync(path.join(appRoot, f), 'utf8')
    assert.equal(
      /dispatchThreadTask\s*\(/.test(src),
      false,
      `${f} 不可直呼 dispatchThreadTask — 必須走 runTask/runExternalObjective`,
    )
  }
  const controller = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(controller, /resolveBusyPolicy/)
  assert.match(controller, /runId/)
})

/**
 * Pure: find any surviving reference to the deleted legacy execution path.
 *
 * `agent/engine.ts` and `agent/loop/` were removed once abort and timeout
 * existed in Pi Host (ADR-0045). The rule is no longer "only engine.ts may
 * import the loop" — it is that neither exists anywhere in the tree, so a
 * second execution path with its own interrupt semantics cannot come back.
 */
function findLegacyEngineResidue(files) {
  const violations = []
  const importRe = /\bfrom\s+['"]([^'"]+)['"]/g
  for (const f of files) {
    let m
    importRe.lastIndex = 0
    while ((m = importRe.exec(f.content))) {
      const spec = m[1]
      if (!spec.startsWith('.')) continue
      const importerDir = path.posix.dirname(f.path)
      const resolved = path.posix.normalize(path.posix.join(importerDir, spec)).replace(/\.tsx?$/, '')
      if (resolved === 'src/agent/loop' || resolved.startsWith('src/agent/loop/') || resolved === 'src/agent/engine') {
        violations.push(`${f.path} imports '${spec}' → the legacy engine/loop is deleted`)
      }
    }
    if (/agent\/loop\/|agent\/engine\.ts|\bagentEngine\b/.test(f.content)) {
      violations.push(`${f.path} references the deleted legacy engine/loop`)
    }
  }
  return violations
}

await test('drift guard: the legacy engine/loop leaves no residue (fixture)', () => {
  assert.deepEqual(
    findLegacyEngineResidue([
      { path: 'src/store/agentStore.ts', content: "import { foo } from './otherThing.ts'" },
    ]),
    [],
  )
  assert.equal(
    findLegacyEngineResidue([
      { path: 'src/agent/runDispatch.ts', content: "import { runLoop } from './loop/index.ts'" },
    ]).length,
    1,
    'a resurrected relative import is caught even when the text says no agent/loop',
  )
  assert.equal(
    findLegacyEngineResidue([
      { path: 'src/store/agentStore.ts', content: "import { agentEngine } from '../agent/engine.ts'" },
    ]).length,
    2,
    'and an engine import trips both the import rule and the text rule',
  )
  assert.equal(
    findLegacyEngineResidue([
      { path: 'src/pages/SettingsPage.tsx', content: "const legacy = 'agent/loop/stepRun.ts'" },
    ]).length,
    1,
    'a string reference is residue too',
  )
})

await test('drift guard: the legacy engine/loop is gone from the real tree', async () => {
  const fs = await import('node:fs')
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/engine.ts')), false, 'engine.ts must stay deleted')
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/loop')), false, 'agent/loop must stay deleted')
  const srcRoot = path.join(appRoot, 'src')
  const entries = fs.readdirSync(srcRoot, { recursive: true, withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    const abs = path.join(entry.parentPath ?? entry.path, entry.name)
    const rel = 'src/' + path.relative(srcRoot, abs).split(path.sep).join('/')
    files.push({ path: rel, content: fs.readFileSync(abs, 'utf8') })
  }
  assert.ok(files.length > 50, 'sanity: the source tree must actually be scanned')
  const violations = findLegacyEngineResidue(files)
  assert.deepEqual(violations, [], `the legacy engine/loop must leave no residue:\n${violations.join('\n')}`)
})

await test('Phase 3 item 1: taskRunCoordinator is the canonical ingress', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const policy = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunPolicy.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunTypes.ts'), 'utf8')
  const callers = [
    'src/App.tsx',
    'src/hooks/useSlashExecutor.ts',
    'src/pages/ProtocolsPage.tsx',
    'src/pages/FailedPage.tsx',
    'src/pages/RecordsPage.tsx',
    'src/pages/SuccessPage.tsx',
    'src/agent/subdesign/workspaceIntegration.ts',
    'src/components/RunContinuationActions.tsx',
    'src/components/subdesign/CritiqueTheater.tsx',
    'src/agent/hermes/backgroundJobs.ts',
  ]
  assert.match(coordinator, /async function coordinateTaskRun/)
  assert.doesNotMatch(coordinator, /export async function coordinateTaskRun/)
  assert.match(coordinator, /export async function runTask/)
  assert.match(coordinator, /normalizeTaskRunInput/)
  // Extension-agnostic: must not dynamically import retired runExternal at all
  assert.doesNotMatch(coordinator, /import\(['"]\.\/runExternal(?:\.ts)?['"]\)/)
  assert.match(coordinator, /dispatchThreadTask\(snapshot\)/)
  assert.match(types, /export type ExternalRunOpts/)
  assert.match(types, /export type RunSourceKind/)
  // The busy policy is defined once on the neutral leaf so the coordinator,
  // the queue and the Ops projection read one decision (ticket 12).
  assert.match(types, /export function resolveBusyPolicy/)
  assert.match(policy, /export \{ resolveBusyPolicy[^}]*\} from '\.\/taskRunTypes(\.ts)?'/)
  const ops = fs.readFileSync(path.join(appRoot, 'src/agent/opsConsole.ts'), 'utf8')
  assert.match(ops, /resolveBusyPolicy/)
  assert.doesNotMatch(ops, /reason:\s*'capacity'/)
  // Legacy shell must not exist
  assert.equal(
    fs.existsSync(path.join(appRoot, 'src/agent/runExternal.ts')),
    false,
    'runExternal.ts must be deleted',
  )
  for (const file of callers) {
    const source = fs.readFileSync(path.join(appRoot, file), 'utf8')
    assert.doesNotMatch(
      source,
      /runExternalObjective\s*\(/,
      `${file} 不可直接呼叫 runExternalObjective`,
    )
    assert.match(source, /taskRunCoordinator/)
  }
  const subDesignPage = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  assert.doesNotMatch(subDesignPage, /dispatchThreadTask|startExecution/)
})

await test('Task run deepening: coordinator owns orchestration; runExternal shell gone', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  // Fixed: previous regex missed `./runExternal.ts` (with extension) and was a false pass
  assert.doesNotMatch(
    coordinator,
    /import\(['"]\.\/runExternal(?:\.ts)?['"]\)/,
    'coordinator 不可動態 import 已退役的 runExternal',
  )
  assert.match(coordinator, /dispatchThreadTask\(snapshot\)/)
  assert.match(coordinator, /enqueueExternalRun/)
  assert.match(coordinator, /evaluateBeforeRunHooks/)
  assert.match(coordinator, /opencode\/sessionSync/)
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/runExternal.ts')), false)
})

await test('Ticket 03: lifecycle-control plumbing is contracted', async () => {
  const fs = await import('node:fs')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  assert.doesNotMatch(types, /deferFinalization/, 'RuntimeOverrides must not expose lifecycle switches')
  assert.doesNotMatch(coordinator, /deferFinalization/, 'Coordinator snapshot must not carry lifecycle switches')
  assert.doesNotMatch(dispatch, /deferFinalization/, 'Runner selection must not forward lifecycle switches')
  assert.doesNotMatch(agent, /deferFinalization/, 'Execution adapters must not declare lifecycle switches')
  assert.match(dispatch, /dispatchThreadTask\(\s*\n?\s*snapshot:\s*RunDispatchSnapshot/)
  assert.doesNotMatch(dispatch, /snapshotOrGoal|legacyOpts|run_legacy_/, 'Runner dispatch must not synthesize legacy entry context')
  assert.doesNotMatch(dispatch, /thr\.activeId|thread\?\.runner|useProjectStore\.getState\(\)\.root/, 'Dispatch must not fall back to mutable UI identity')
  assert.match(dispatch, /const attachments = snapshot\.attachments/)
  assert.doesNotMatch(dispatch, /useSettingsStore/, 'Dispatch adapters must consume admitted settings, not mutable Settings')
  assert.match(coordinator, /settings:\s*snapshotRunSettings\(parts\.settings\)/)
  assert.match(coordinator, /contextPolicySnapshot:\s*admittedSettings\.contextPolicySnapshot/)
})

await test('Ticket 04: lifecycle ownership drift stays blocked at module seams', async () => {
  const fs = await import('node:fs')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const entryFiles = [
    'src/App.tsx',
    'src/hooks/useSlashExecutor.ts',
    'src/pages/ProtocolsPage.tsx',
    'src/pages/OpsPage.tsx',
    'src/pages/FailedPage.tsx',
    'src/pages/RecordsPage.tsx',
    'src/pages/SuccessPage.tsx',
    'src/pages/SubDesignPage.tsx',
    'src/components/InlineRunPanel.tsx',
    'src/components/subdesign/CritiqueTheater.tsx',
    'src/agent/hermes/backgroundJobs.ts',
  ]
  for (const file of entryFiles) {
    const source = fs.readFileSync(path.join(appRoot, file), 'utf8')
    assert.doesNotMatch(source, /dispatchThreadTask\s*\(/, `${file} must enter through runTask`)
    assert.doesNotMatch(source, /startExecution\s*\(|startLocalCliExecution\s*\(/, `${file} must not enter a runner adapter directly`)
  }
  assert.doesNotMatch(
    dispatch,
    /reserveRun\s*\(|releaseRun\s*\(|saveToArchive\s*\(|drainExternalRunQueue|drainQueueAfterRun|deferFinalization/,
    'runner selection must not own admitted-run lifecycle finalization',
  )
})

await test('Phase 3 item 6/7: background delegate links Archive once + hidden worker thread', async () => {
  const fs = await import('node:fs')
  const bg = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  const thread = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  // The sidebar now groups by project; hidden-thread exclusion moved with the
  // grouping into its own pure module (covered by smoke-thread-project-groups).
  const sidebar = fs.readFileSync(path.join(appRoot, 'src/lib/threadProjectGroups.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunTypes.ts'), 'utf8')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(bg, /archiveRunId/)
  assert.match(bg, /workerThread: true/)
  assert.match(bg, /job\.archiveRunId/)
  assert.match(bg, /Link-only|coordinator finalization already archived/i)
  assert.match(thread, /hidden\?: boolean/)
  assert.match(thread, /t\.hidden/)
  assert.match(sidebar, /if \(thread\.hidden\) continue/)
  assert.match(types, /workerThread\?: boolean/)
  assert.match(coordinator, /hidden: opts\.hidden/)
})

await test('Phase 3 item 3: runDispatch consumes RunDispatchSnapshot only', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  assert.match(coordinator, /export type RunDispatchSnapshot/)
  assert.match(coordinator, /export function buildRunDispatchSnapshot/)
  assert.doesNotMatch(coordinator, /deferFinalization/)
  assert.match(dispatch, /RunDispatchSnapshot/)
  assert.match(dispatch, /dispatchThreadTask\(\s*\n?\s*snapshot:\s*RunDispatchSnapshot/)
  assert.doesNotMatch(dispatch, /snapshotOrGoal|legacyOpts|run_legacy_/)
  assert.doesNotMatch(dispatch, /canStartRun/)
  assert.doesNotMatch(dispatch, /materializeAttachmentsOnDisk/)
  assert.doesNotMatch(dispatch, /hydrateAttachmentsFromDisk/)
  assert.doesNotMatch(dispatch, /normalizeImageAttachmentsForVision/)
  assert.match(coordinator, /buildRunDispatchSnapshot/)
  assert.match(coordinator, /dispatchThreadTask\(snapshot\)/)
})

await test('Phase 3 item 4/5: unique finalization order; stop does not drain', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
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
  assert.ok(a2 < a3 && a3 < a4, 'finalization step comments stay ordered')
  assert.ok(a5 < a6, 'release still precedes the single drain')
  // Steps 5/6 live in the cleanup helper invoked from the claim holder's
  // finally: they remain obligations an exception cannot skip.
  const cleanupStart = coordinator.indexOf('async function cleanupFinalization')
  const gateStart = coordinator.indexOf('async function executeClaimedFinalization')
  const publicStart = coordinator.indexOf('export async function finalizeTaskRun')
  const sequenceStart = coordinator.indexOf('async function runFinalizationSequence')
  assert.ok(cleanupStart >= 0 && gateStart > cleanupStart && publicStart > gateStart && sequenceStart > publicStart, 'cleanup, claim gate, public seam and sequence remain separate owners')
  assert.ok(a5 > cleanupStart && a6 < gateStart, 'release/drain live in the cleanup owner')
  assert.match(coordinator.slice(gateStart, publicStart), /finally\s*\{[\s\S]*cleanupFinalization/, 'the claim holder finally invokes cleanup')
  assert.ok(a2 > sequenceStart, 'the ordered sequence steps live in the sequence')
  assert.match(coordinator.slice(gateStart, sequenceStart), /finalizationClaims/)
  assert.match(coordinator.slice(gateStart, publicStart), /finally\s*\{[\s\S]*cleanupFinalization/, 'release rides the claim holder finally through its cleanup owner')
  assert.doesNotMatch(types, /deferFinalization/)
  assert.doesNotMatch(agent, /deferFinalization/)
  assert.match(agent, /Phase 3 item 5: stop only terminates/)
  assert.doesNotMatch(
    agent.slice(agent.indexOf('stopExecution:'), agent.indexOf('continueTurn:')),
    /drainQueueAfterRun/,
  )
  // File absence is stronger than checking dead code is gone
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/runExternal.ts')), false)
})

await test('Phase 3 item 2: coordinator owns capacity / attachments / thread / beforeRun once', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
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
  assert.match(coordinator, /prepareRunAttachments/)
  assert.match(coordinator, /checkRunCapacity/)
  assert.match(coordinator, /reserveRunCapacity/)
  assert.match(coordinator, /bindRunThread/)
  assert.match(coordinator, /evaluateBeforeRunHooks/)
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/runExternal.ts')), false)

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
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const thread = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  const permission = fs.readFileSync(path.join(appRoot, 'src/store/permissionAskStore.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  const settingsPage = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const scenario = fs.readFileSync(path.join(appRoot, 'scripts/smoke-scenario-e2e.mjs'), 'utf8')
  // The per-run registry moved out of the deleted engine into the store that
  // owns reservation, capacity and per-run agent snapshots.
  const agentStoreSrc = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  assert.match(agentStoreSrc, /const reservedRuns = new Map/)
  assert.match(agentStoreSrc, /reserveRun: \(runId, threadId/)
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
  assert.match(settings, /concurrentRunsEnabled: true/)
  assert.match(settings, /maxConcurrentRuns: 4/)
  assert.match(settingsPage, /同時任務上限[\s\S]*不同對話會各自執行/)
  assert.match(preload, /cancel: \(runId\?: string\)/)
  assert.match(main, /ipcMain\.handle\('cli:cancel', async \(_evt, runId\?: string\)/)
  assert.match(scenario, /ADR3: independent thread runs/)
})

await test('Phase 1: run presentation components use explicit run selectors', async () => {
  const fs = await import('node:fs')
  const feed = fs.readFileSync(path.join(appRoot, 'src/components/RunProcessFeed.tsx'), 'utf8')
  const panel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  const continuation = fs.readFileSync(path.join(appRoot, 'src/components/RunContinuationActions.tsx'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  assert.match(feed, /runId/)
  assert.match(panel, /runId/)
  assert.doesNotMatch(feed, /useAgentStore\(\(s\) => s\.agent\)/)
  assert.doesNotMatch(feed, /useRunActivityStore\(\)/)
  assert.doesNotMatch(panel, /useAgentStore\(\)/)
  assert.doesNotMatch(panel, /useRunActivityStore\(\)/)
  // The intervention overlay and the 繼續回合 button existed only to drive the
  // deleted engine, and were already dead controls in a real Electron session.
  assert.equal(fs.existsSync(path.join(appRoot, 'src/components/InterventionOverlay.tsx')), false)
  assert.doesNotMatch(continuation, /continueTurn/)
  // Every run-scoped action still resolves an explicit runId, never a global one.
  assert.doesNotMatch(continuation, /claimCheckpointResume\(runId\)/, 'renderer cannot claim Host resume checkpoints')
  assert.match(agent, /MAX_RUN_AGENT_STATES = 100/)
  assert.match(agent, /pruneRunAgentStates/)
  assert.match(agent, /lastRunIdByThread/)
  assert.doesNotMatch(agent, /resolveIntervention/)
  assert.doesNotMatch(agent, /const target = runId \|\| get\(\)\.selectedRunId/)
})

await test('Phase 0: workflow baseline matrix stays recorded', async () => {
  const fs = await import('node:fs')
  const scenario = fs.readFileSync(path.join(appRoot, 'scripts/smoke-scenario-e2e.mjs'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const background = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  const baseline = {
    twoBuiltInRuns:
      /ADR3: independent thread runs/.test(scenario) &&
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
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(activity, /presentations: Record<string, RunPresentation>/)
  assert.match(activity, /MAX_PRESENTATIONS = 100/)
  assert.match(activity, /getPresentation: \(runId\)/)
  assert.match(activity, /terminalizePresentation/)
  // Stream adapters keep the feed live through summary/archive finalization;
  // the coordinator is the single owner of terminalization.
  assert.match(activity, /get\(\)\.setStatus\(payload\.title \|\| 'CLI 完成', streamRunId\)/)
  // The terminal call now also carries the settled outcome the shell announces;
  // ownership is unchanged — the coordinator remains the only caller of end().
  assert.match(coordinator, /useRunActivityStore\.getState\(\)\.end\(runId, terminalLabel, \{/)
  assert.match(coordinator, /status:\s*\n\s*String\(status\) === 'failed' \? 'failed' : String\(status\) === 'halted' \? 'halted' : 'success',/)
  assert.match(activity, /clearDraft: \(runId\)/)
})

await test('Phase 1: finalization summary derives from the Turn Record, never the live cache', async () => {
  const fs = await import('node:fs')
  // The four-source fallback ladder (live activity → Host audit → toolCalls →
  // steps+logs) is deleted: the execution-process record projects from the
  // Turn Record through runOperationsProjection and from nothing else, so a
  // memory cap can never bound durable history.
  const controller = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  const projection = fs.readFileSync(path.join(appRoot, 'src/agent/runOperationsProjection.ts'), 'utf8')
  assert.match(controller, /projectRunOperations\(finalAgent\.turnRecord\)/)
  assert.match(controller, /projectProducedFiles\(finalAgent\.turnRecord\)/)
  // The live activity store is written for in-flight rendering but is no
  // longer an input to anything the summary persists.
  assert.doesNotMatch(controller, /getPresentation\(runId\)/)
  assert.match(projection, /sort\(\(left, right\) => left\.seq - right\.seq\)/)
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
  const decision = fs.readFileSync(path.join(appRoot, 'src/agent/tools/approvalDecision.ts'), 'utf8')
  assert.match(config, /projectOpenCodePermissions/)
  assert.match(config, /mergePermissionProjectionsRestrictive/)
  assert.match(permissions, /checkProjectedToolPermission/)
  assert.match(permissions, /mcp_/)
  assert.match(registry, /restrictivePermission/)
  assert.match(decision, /OpenCode permission deny/)
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
  // Project guidance is owned by projectContext + the prompt builder now.
  assert.match(fs.readFileSync(path.join(appRoot, 'src/agent/projectContext.ts'), 'utf8'), /resolveProjectContext/)
  assert.match(fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8'), /projectGuidance/)
  const pb = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  assert.match(pb, /projectGuidance/)
})

await test('SubDesign Phase 4/5: critique gate + Electron export contract', async () => {
  const fs = await import('node:fs')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const critique = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/critique.ts'), 'utf8')
  const guardShared = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuardShared.ts'), 'utf8')
  const capability = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/subDesign.ts'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  // Phase 3 item 4: subDesign export digest lives in coordinator finalization summary
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(critique, /critiqueAllowsDeliver/)
  assert.match(guardShared, /design_artifact_export/)
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
  const guardShared = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuardShared.ts'), 'utf8')
  const decision = fs.readFileSync(path.join(appRoot, 'src/agent/tools/approvalDecision.ts'), 'utf8')
  const critique = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/critique.ts'), 'utf8')
  const preview = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ArtifactPreview.tsx'), 'utf8')
  const toolDefs = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolDefinitions.ts'), 'utf8')
  const hostPack = fs.readFileSync(path.join(appRoot, 'electron/piExtensionPacks/subdesignPack.ts'), 'utf8')
  const capability = fs.readFileSync(path.join(appRoot, 'src/agent/capabilities/subDesign.ts'), 'utf8')
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const preference = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/preference.ts'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspace.ts'), 'utf8')
  const integration = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspaceIntegration.ts'), 'utf8')
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
  assert.match(guardShared, /curl\|wget/)
  assert.match(decision, /tool === 'bash'/)
  assert.match(critique, /critiqueHasRequiredEvidence/)
  assert.match(critique, /screenshot/)
  assert.match(critique, /dom/)
  assert.match(critique, /lint/)
  assert.match(toolDefs, /design_artifact_patch:/)
  assert.match(toolDefs, /design_artifact_capture:/)
  assert.match(toolDefs, /design_artifact_tweak:/)
  assert.match(toolDefs, /design_artifact_lint:/)
  assert.match(toolDefs, /expectedMatches/)
  assert.match(toolDefs, /"pptx"/)
  assert.match(toolDefs, /"mp4"/)
  assert.match(hostPack, /name: 'design_artifact_export'/)
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
  assert.match(hostPack, /name: 'design_critique'/)
  assert.match(capability, /design_artifact_capture/)
  assert.match(learning, /subdesign-preference/)
  assert.match(preference, /findLatestPassedSubDesignPreference/)
  assert.match(preference, /subDesignProjectMemoryKey/)
  assert.match(preference, /memoryEntries/)
  assert.match(learning, /subDesignProjectMemoryKey/)
  assert.match(workspace, /memoryEntries/)
  assert.match(integration, /memoryEntries/)
  assert.match(page, /latestPassedPreference/)
})

await test('SubDesign R3: deep brief route, in-page run feed, and return link', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspace.ts'), 'utf8')
  const integration = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspaceIntegration.ts'), 'utf8')
  const inspector = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignRunInspector.tsx'), 'utf8')
  const studio = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignProjectStudio.tsx'), 'utf8')
  const conversation = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignConversationPane.tsx'), 'utf8')
  const preview = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/ArtifactPreview.tsx'), 'utf8')
  const summary = fs.readFileSync(path.join(appRoot, 'src/components/RunSummaryCard.tsx'), 'utf8')
  const sourceFiles = await fs.promises.readdir(path.join(appRoot, 'src'), { recursive: true })
  assert.match(app, /subdesign\/:briefId\?/)
  assert.match(page, /useParams/)
  assert.match(workspace, /navigate\(`\/subdesign\/\$\{brief\.id\}`\)/)
  assert.match(workspace, /resume: \(briefId\)/)
  assert.match(page, /SubDesignRunInspector/)
  assert.match(inspector, /RunProcessFeed/)
  assert.match(page, /SubDesignProjectStudio/)
  assert.match(page, /routeBriefId && activeBrief && workspace/)
  assert.match(studio, /SubDesign task/)
  assert.match(studio, /label: '輸出'/)
  assert.match(studio, /Critique/)
  assert.match(studio, /Deliver/)
  assert.match(studio, /onSelectDirection/)
  assert.match(conversation, /RunProcessFeed/)
  assert.match(conversation, /RunSummaryCard/)
  assert.match(conversation, /onStopRun/)
  assert.match(preview, /mode === 'source'/)
  assert.match(page, /workspaceProjection\.presentation|runIsLive/)
  assert.match(integration, /runningThreadIds/)
  assert.match(integration, /useRunActivityStore/)
  assert.match(page, /startingRun/)
  assert.match(integration, /useThreadStore\.getState\(\)\.hydrate\(\)/)
  assert.match(workspace, /runTask\(/)
  assert.match(integration, /setShowRunPanel/)
  assert.match(page, /navigate\(`\/\?thread=/)
  assert.match(summary, /useNavigate/)
  assert.match(summary, /navigate\(`\/subdesign\/\$\{summary\.subDesign\?\.briefId\}`\)/)
  assert.match(summary, /查看設計/)
  for (const file of sourceFiles.filter((entry) => typeof entry === 'string' && /\.(tsx?|css)$/.test(entry))) {
    const contents = fs.readFileSync(path.join(appRoot, 'src', file), 'utf8')
    assert.equal(contents.includes('c96646'), false, `legacy brand color remains in src/${file}`)
  }
})

await test('SubDesign R3-P4/P5: critique theater contract', async () => {
  const fs = await import('node:fs')
  const theater = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/CritiqueTheater.tsx'), 'utf8')
  const session = fs.readFileSync(path.join(appRoot, 'src/store/subDesignCritiqueSessionStore.ts'), 'utf8')
  const gates = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/critique.ts'), 'utf8')
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
  // Critique verification gates（ADR-0048）：pass verdict 需要 gate 證據，gate 沒跑不得宣稱分數。
  assert.match(gates, /SUBDESIGN_CRITIQUE_GATE_REGISTRY/)
  assert.match(gates, /critiqueGateStatus/)
  assert.match(gates, /Gate 沒跑不得宣稱分數/)
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
  // Model-profile degrade lives in the Loop Runner's step-execution seam (ticket 02).
  const modelProfileSrc = fs.readFileSync(path.join(appRoot, 'src/agent/modelProfile.ts'), 'utf8')
  // Model capability gating lives in the profile module the Host consults.
  assert.match(modelProfileSrc, /modelSupports/)
  assert.match(modelProfileSrc, /vision/)
  assert.match(modelProfileSrc, /tools/)
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

await test('P1-D: active hook owners stay wired; sanitize caps plugin rules', async () => {
  const fs = await import('node:fs')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  const decision = fs.readFileSync(path.join(appRoot, 'src/agent/tools/approvalDecision.ts'), 'utf8')
  // beforeTool evaluated inside pure decide(); adapter collects rules + forwards sourceKind
  assert.match(decision, /point !== 'beforeTool'/)
  assert.match(guard, /collectHookRules/)
  assert.match(guard, /sourceKind: opts\.sourceKind/)
  const runX = readTaskRunRuntimeSource(fs)
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  // Phase 3: beforeRun + afterRun owned by coordinator (admit + finalize)
  assert.match(coordinator, /point: 'beforeRun'/)
  assert.match(coordinator, /point: 'afterRun'/)
  assert.match(runX, /evaluateBeforeRunHooks/)
  assert.match(runX, /finalizeTaskRun/)
  assert.match(runX, /sourceKind: opts\.sourceKind/)
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
  // The LLM planner that carried this rule in its prompt is gone with the
  // legacy engine; the heuristic classifier in parser.ts is now the only place
  // that maps free text to a loop type, and it still refuses the trigger-only
  // patterns outright rather than asking a model not to emit them.
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
  const scheduleText = '每天 08:00 寄摘要'
  assert.equal(/每日|每天|定時|排程/.test(scheduleText), true)
  assert.equal(parseLlmPlanMirror('{"loopType":"Time-based","steps":["a","b"],"definitionOfDone":"ok"}').loopType, 'Goal-based')
  assert.match(parser, /detectAutomationSuggestion/)
  assert.match(automation, /source: 'conversation'/)
  assert.match(automation, /尚未執行/)
  assert.match(llm, /Time-based and\s*\n?\s*\/\/ Proactive remain valid for explicit trigger adapters, never for text auto/)
  assert.match(llm, /if \(detectAutomationSuggestion\(text\)\) return 'Goal-based'/)
  // Nothing in the classifier may return a trigger-only pattern from prose.
  assert.doesNotMatch(llm, /return 'Time-based'/)
  assert.doesNotMatch(llm, /return 'Proactive'/)
  assert.match(runExternal, /presentConversationAutomationSuggestion/)
  assert.match(runExternal, /status: 'suggested'/)
  assert.match(runExternal, /no capacity reservation, engine start, or tool call/i)
})

await test('Phase 2b: Time-based runs require a claimed ScheduledJob trigger snapshot', async () => {
  const fs = await import('node:fs')
  const scheduler = fs.readFileSync(path.join(appRoot, 'src/agent/scheduler.ts'), 'utf8')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const policySrc = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunPolicy.ts'), 'utf8')
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
  // Admission moved to the coordinator's policy seam; smoke-runner-contract
  // drives the fail-closed cases behaviourally.
  assert.match(policySrc, /validateScheduleTriggerSnapshot/)
  assert.match(runExternal, /verifyClaimedScheduleTrigger/)
  assert.match(policySrc, /Time-based 僅能由有效 ScheduledJob 到期 trigger 進入/)
  assert.match(policySrc, /return validation\.ok/)
  assert.match(types, /interface ScheduleTriggerSnapshot/)
  assert.match(agent, /scheduleTrigger: agent\.scheduleTrigger/)
  assert.match(agent, /scheduleTrigger\?: RuntimeOverrides\['scheduleTrigger'\]/)
  assert.match(dispatch, /scheduleTrigger: snapshot\.overrides\.scheduleTrigger/)
})

await test('Phase 2c: Proactive runs require matcher-produced event evidence', async () => {
  const fs = await import('node:fs')
  const policySrc = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunPolicy.ts'), 'utf8')
  const matcher = fs.readFileSync(path.join(appRoot, 'src/agent/eventMatcher.ts'), 'utf8')
  const store = fs.readFileSync(path.join(appRoot, 'src/store/scheduleStore.ts'), 'utf8')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
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
  assert.match(policySrc, /validateEventTriggerSnapshot/)
  assert.match(policySrc, /Proactive trigger 無效/)
  assert.doesNotMatch(policySrc, /predicate has_trigger|Event criteria not met/)
  assert.match(types, /interface EventTriggerSnapshot/)
  assert.match(agent, /eventTrigger: agent\.eventTrigger/)
  assert.match(dispatch, /eventTrigger: snapshot\.overrides\.eventTrigger/)
})

await test('Phase 2d: Next_State is consumed once with explicit webhook delivery audit', async () => {
  const fs = await import('node:fs')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8')
  const outcome = fs.readFileSync(path.join(appRoot, 'src/agent/outcomeDispatcher.ts'), 'utf8')
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
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
  // Next_State is a typed contract now; the dispatcher and the coordinator's
  // delivery audit are what carry the wording the planner prompt used to.
  assert.match(fs.readFileSync(path.join(appRoot, 'src/agent/types.ts'), 'utf8'), /'Dispatch Webhook'/)
  assert.match(fs.readFileSync(path.join(appRoot, 'src/agent/outcomeDispatcher.ts'), 'utf8'), /Dispatch Webhook/)
  assert.match(agent, /await consumeNextState/)
  assert.match(agent, /applyPostState/)
  assert.doesNotMatch(agent, /saveToArchive\(settled/, 'execution adapters must not own Archive finalization')
  // Phase 3 item 4: postState audit bubbles live in coordinator finalization
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /postState\?\.status === 'failed'/)
  assert.match(coordinator, /finalizeTaskRun/)
  assert.match(coordinator, /saveToArchive\(finalAgent/)
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
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  // Loop Runner deepening (ticket 03): DoD/replan iteration wiring moved to
  // DoD evaluation and iteration are Pi Host orchestration now (ADR-0045); the
  // renderer keeps only Parse and the plan bubble.
  const orchestration = fs.readFileSync(path.join(appRoot, 'electron/piOrchestrationExtension.ts'), 'utf8')
  assert.match(orchestration, /dodMet/)
  assert.match(orchestration, /last\.done === true/)
  assert.match(orchestration, /Pi Goal-based DoD was not met before the iteration cap/)
  const hostProtocol = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  assert.match(hostProtocol, /isPiHostDefinitionOfDoneMet/)
  assert.match(hostProtocol, /DoD unmet; retrying the Pi turn/)
  assert.match(fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8'), /formatPlanBubble/)
  assert.match(parser, /export function buildParseResult/)
  assert.match(parser, /export function isChatLiteObjective/)
  assert.match(parser, /export function classifyLoopType/)
  assert.match(parser, /export function formatPlanBubble/)
  assert.match(parser, /個\|項\|款\|種/)
})

await test('Phase 2e: plan bubble preserves source and classification reason', async () => {
  const fs = await import('node:fs')
  const coordinatorSrc = readTaskRunRuntimeSource(fs)
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
  const queue = fs.readFileSync(path.join(appRoot, 'src/agent/runQueue.ts'), 'utf8')
  assert.match(parser, /export function resolvePlanBubbleMetadata/)
  assert.match(parser, /Trigger source：\$\{meta\.triggerSource\}/)
  assert.match(parser, /分類原因：\$\{meta\.classificationReason\}/)
  assert.match(parser, /ScheduledJob trigger/)
  assert.match(parser, /Webhook matcher evidence/)
  assert.match(parser, /由使用者手動指定/)
  assert.match(runExternal, /resolvePlanBubbleMetadata\(/)
  assert.match(runExternal, /sourceLabel: opts\.sourceLabel/)
  // The plan bubble is built by the coordinator now that the engine is gone.
  assert.match(coordinatorSrc, /triggerSource: planBubbleMetadata\.triggerSource/)
  assert.match(coordinatorSrc, /classificationReason: planBubbleMetadata\.classificationReason/)
  assert.match(
    fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8'),
    /resolvePlanBubbleMetadata/,
  )
  assert.match(queue, /\| 'triggerSource'/)
  assert.match(queue, /\| 'classificationReason'/)
  assert.match(queue, /triggerSource: o\.triggerSource/)
  assert.match(queue, /classificationReason: o\.classificationReason/)
})

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

await test('Loop plan: memory relevance, failure learning, unattended turn, and CJK matching are wired', async () => {
  const fs = await import('node:fs')
  const memory = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/memory.ts'), 'utf8')
  const prompt = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const skills = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/skills.ts'), 'utf8')
  const intent = fs.readFileSync(path.join(appRoot, 'src/agent/intentPreload.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
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
  // Loop Runner deepening (ticket 03): noteLearningFailure + Turn-based pattern
  // Failure learning and session recall live in the Hermes modules the Pi
  // adapters call; the loop that used to drive them is deleted.
  const learningSrc = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  assert.match(learningSrc, /onStepFailure|noteFailure|failure/i)
  const promptSrc = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  assert.match(promptSrc, /formatSessionRecallBlock|sessionRecallBlock/)
  assert.match(runExternal, /loopTypeMode/)
  assert.match(runExternal, /forcedLoopType|forceLoopType/)
  assert.match(textSim, /export function scoreQueryText/)
  // The legacy loop's per-pattern unattended handling is gone. What survives is
  // the one place that decides it: the coordinator derives `unattended` from the
  // source, and the approval decision is what makes it mean something.
  assert.match(runExternal, /unattended: opts\.overrides\?\.unattended \?\? sourceIsAutomation/)
  assert.match(runExternal, /isInteractiveConversationSource|sourceIsAutomation/)
  const approvalSrc = fs.readFileSync(path.join(appRoot, 'src/agent/tools/approvalDecision.ts'), 'utf8')
  assert.match(approvalSrc, /if \(m === 'full' && unattended\) return 'auto'/)
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

  // Concurrency language: different conversations are independent, with a cap.
  assert.match(agents, /different conversation|不同對話|maxConcurrentRuns/i)
  assert.match(claude, /different conversation|不同對話|maxConcurrentRuns/i)
  assert.match(context, /different conversation|不同對話|maxConcurrentRuns/i)
  assert.match(adr, /different conversation|不同對話|maxConcurrentRuns/i)
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

await test('Phase 5: runner capability matrix, honest CLI DoD, continueGoal contract', async () => {
  const fs = await import('node:fs')
  const agentStoreExecKind = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const types = fs.readFileSync(path.join(appRoot, 'src/agent/runners/types.ts'), 'utf8')
  const index = fs.readFileSync(path.join(appRoot, 'src/agent/runners/index.ts'), 'utf8')
  const localCli = fs.readFileSync(path.join(appRoot, 'src/agent/localCliRun.ts'), 'utf8')
  const agent = fs.readFileSync(path.join(appRoot, 'src/store/agentStore.ts'), 'utf8')
  const panel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  const continuation = fs.readFileSync(path.join(appRoot, 'src/components/RunContinuationActions.tsx'), 'utf8')
  const runX = readTaskRunRuntimeSource(fs)
  const dispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')

  assert.match(types, /export type RunnerCapabilities/)
  assert.match(types, /export type ExecutionKind/)
  assert.match(types, /BUILTIN_RUNNER_CAPABILITIES/)
  assert.match(types, /EXTERNAL_CLI_RUNNER_CAPABILITIES/)
  assert.match(types, /continueGoal: true/)
  assert.match(types, /validateDoD: false/)
  assert.match(types, /EXTERNAL_CLI_DOD_LABEL/)
  assert.match(types, /formatCliContinueGoalPrompt/)
  assert.match(types, /isCompleteCliContinueGoalContract/)
  assert.match(index, /from '\.\/types(\.ts)?'/)

  // Honest CLI DoD — never "CLI returned" as met
  assert.doesNotMatch(localCli, /definitionOfDone: 'CLI returned'/)
  assert.doesNotMatch(agent, /definitionOfDone: 'CLI returned'/)
  assert.match(localCli, /EXTERNAL_CLI_DOD_LABEL/)
  assert.match(agent, /EXTERNAL_CLI_DOD_LABEL/)
  assert.match(agent, /executionKind: 'external'/)
  assert.match(agentStoreExecKind, /executionKind: 'loop'/)
  assert.match(dispatch, /executionKind: 'external'/)
  assert.match(dispatch, /executionKind: 'loop'/)

  // continueGoal UI gated; contract documented but capability stays false
  assert.match(continuation, /canContinueGoal/)
  assert.match(panel, /EXTERNAL_CLI_UI_LABEL/)
  assert.match(continuation, /不支援繼續 Goal/)
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
  const coordinatorSrc = readTaskRunRuntimeSource(fs)
  const packet = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/contextPacket.ts'), 'utf8')
  const prompt = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
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
  // onUserTurn is owned by the coordinator; nothing else may call it.
  assert.match(coordinatorSrc, /onUserTurn/)

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
  const runExternal = readTaskRunRuntimeSource(fs)
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
  const coordinatorSrc = readTaskRunRuntimeSource(fs)
  const continueGoalSrc = fs.readFileSync(path.join(appRoot, 'src/agent/continueGoal.ts'), 'utf8')
  const threadStoreSrc = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  const runExternal = readTaskRunRuntimeSource(fs)
  const runDispatch = fs.readFileSync(path.join(appRoot, 'src/agent/runDispatch.ts'), 'utf8')
  const continueGoal = fs.readFileSync(path.join(appRoot, 'src/agent/continueGoal.ts'), 'utf8')
  const chatHistory = fs.readFileSync(path.join(appRoot, 'src/agent/chatHistory.ts'), 'utf8')
  const threadStore = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  assert.match(continueGoal, /export function buildContinueGoalSnapshot/)
  assert.match(continueGoal, /export function formatContinueGoalOffer/)
  assert.match(chatHistory, /export function buildChatHistoryContext/)
  assert.match(chatHistory, /export function isContinueGoalPhrase/)
  assert.match(coordinatorSrc, /continueGoal/)
  // Loop Runner deepening (ticket 03): persistContinueGoal/clearContinueGoal's
  // Snapshot-building now lives in continueGoal.ts; the threadStore write
  // (a UI-store side effect the loop module must not import directly) stays on
  // engine behind the onGoalIncomplete/onGoalCleared ports.
  assert.match(continueGoalSrc, /buildContinueGoalSnapshot/)
  assert.match(threadStoreSrc, /onGoalIncomplete|continueGoal/)
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
  const catalog = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/catalog.ts'), 'utf8')
  const packs = fs.readFileSync(path.join(appRoot, 'src/agent/openDesign/packs.ts'), 'utf8')
  const packStore = fs.readFileSync(path.join(appRoot, 'src/store/openDesignPackStore.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const integration = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/workspaceIntegration.ts'), 'utf8')
  assert.match(catalog, /parseOpenDesignInventory/)
  assert.match(catalog, /readOpenDesignText/)
  assert.match(packs, /customTools: \[\]/)
  assert.match(packs, /mcpServers: \[\]/)
  assert.match(packStore, /pluginRegistry\.add/)
  assert.match(packs, /remote-unverified pack 預設停用/)
  assert.match(main, /subdesign:copyVendorPack/)
  assert.match(main, /Open Design pack 超過複製大小限制/)
  assert.match(preload, /copyVendorPack/)
  assert.match(integration, /loadOpenDesignCatalog/)
  assert.match(page, /catalogRecords/)
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
  const composerControls = fs.readFileSync(path.join(appRoot, 'src/agent/composerRunControls.ts'), 'utf8')
  const slash = fs.readFileSync(path.join(appRoot, 'src/hooks/useSlashExecutor.ts'), 'utf8')
  const continuation = fs.readFileSync(path.join(appRoot, 'src/components/RunContinuationActions.tsx'), 'utf8')
  const runContext = fs.readFileSync(path.join(appRoot, 'src/agent/tools/runContext.ts'), 'utf8')
  // Each interactive runTask() call must snapshot the active project explicitly —
  // a concurrent run must not silently re-resolve to whatever project the UI
  // switches to mid-flight. See docs/adr/0003-concurrent-run-lock-removal.md.
  assert.match(protocols, /buildComposerRunInput\(\{[\s\S]{0,400}projectRoot: projectRoot \|\| undefined/)
  assert.match(protocols, /runTask\(runInput\)/)
  assert.match(composerControls, /projectRoot: input\.projectRoot\?\.trim\(\) \|\| undefined/)
  assert.match(slash, /runTask\(\{[\s\S]{0,400}projectRoot: projectRoot\(\) \|\| undefined/)
  assert.match(continuation, /runTask\(\{[\s\S]{0,600}projectRoot: useProjectStore\.getState\(\)\.root \|\| undefined/)
  assert.match(runContext, /should therefore be unreachable during a real run/)
})

// ── Phase 0 (grok-build plan G1/G3): LLM resilience ──
// Mirrors agent/llmResilience.ts CircuitBreaker / backoff.

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
  assert.match(dream, /api\.consolidateDream/)
  const sqliteMemory = fs.readFileSync(path.join(appRoot, 'electron/sqliteDurableMemoryStore.ts'), 'utf8')
  assert.match(sqliteMemory, /async consolidateDream/)
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  assert.match(app, /scheduleDreamConsolidation\(settings, undefined, projectRoot \|\| undefined\)/)
})

await test('drift guard: rewind snapshots wired into write tools + thread rewind', async () => {
  const fs = await import('node:fs')
  const helpers = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolIoHelpers.ts'), 'utf8')
  assert.match(helpers, /recordRewindSnapshot/)
  // ADR-0027 removal: workspace_write's renderer handler is GONE; the Host
  // owns writes now. The guard asserts the removal holds and the remaining
  // mutating renderer tools still record their rewind kinds.
  const removed = fs.existsSync(path.join(appRoot, 'src/agent/tools/registered/workspace_write.ts'))
  assert.equal(removed, false, 'workspace_write renderer handler must stay deleted')
  const writeTools = ['workspace_delete', 'workspace_move']
    .map((n) => fs.readFileSync(path.join(appRoot, `src/agent/tools/registered/${n}.ts`), 'utf8'))
    .join('\n')
  for (const kind of ["kind: 'delete'", "kind: 'move'"]) {
    assert.ok(writeTools.includes(kind), `registered write tools record rewind ${kind}`)
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
})

await test('drift guard: remaining hook points are passive-only and wired', async () => {
  const fs = await import('node:fs')
  const hooks = fs.readFileSync(path.join(appRoot, 'src/agent/hooks.ts'), 'utf8')
  for (const point of ['permissionDenied', 'beforeCompaction', 'afterCompaction', 'delegateStart', 'delegateEnd', 'userTurn']) {
    assert.match(hooks, new RegExp(`${point}: \\['log', 'notify'\\]`), `${point} passive-only`)
  }
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.match(delegate, /'delegateStart'/)
  assert.match(delegate, /emitDelegateHook\('delegateEnd', r\.ok\)/)
  const runExternal = readTaskRunRuntimeSource(fs)
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
  const jobs = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/backgroundJobs.ts'), 'utf8')
  assert.match(jobs, /export async function waitBackgroundJobs/)
  assert.match(jobs, /wait_any/)
})

await test('drift guard: metrics recorded at coordinator settle + guard decisions', async () => {
  const fs = await import('node:fs')
  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  // Settle moved onto the per-run finalization claim, so the once-per-run
  // metric must be recorded there — inside settleOnce, not in the sequence
  // an exception can skip.
  const settleOnce = coordinator.slice(
    coordinator.indexOf('const settleOnce = async'),
    coordinator.indexOf('const outcome = (async ()'),
  )
  assert.ok(settleOnce.length > 0, 'the claim holder still owns settle')
  assert.match(settleOnce, /finalizeRunMetric\(input\.runId/)
  assert.match(settleOnce, /input\.onSettled\?\.\(result\)/, 'and owns onSettled')
  assert.match(settleOnce, /if \(settled\) return/, 'settle is once per run, by construction')
  const guard = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolGuard.ts'), 'utf8')
  assert.match(guard, /bumpRunMetric\(opts\.runId, 'toolAsks'\)/)
  assert.match(guard, /'toolDenials'\)/)
})

// ── Phase 5 遞延項 (G9b/c/d + G10 monitor): wiring drift guards ──

await test('drift guard: persona resolution — role > persona > parent; unknown persona fails spawn', async () => {
  const fs = await import('node:fs')
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.match(delegate, /settings\.delegatePersonas\?\.\[input\.persona\]/)
  assert.match(delegate, /persona「\$\{input\.persona\}」不存在/)
  assert.match(delegate, /roleResolved\.source === 'role'\s*\?\s*roleResolved\.model\s*:\s*persona\?\.model/)
})

await test('drift guard: worktree isolation falls back safely', async () => {
  const fs = await import('node:fs')
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

await test('drift guard: the Pi path\'s live timeline is the record projection, never synthesised events', async () => {
  const fs = await import('node:fs')
  // ONE reading of one ordered source. Before this, the running view came from
  // the activity event stream (arrival order) and the finished view from the
  // Turn Record (recorded order) — two builders, no reason to agree. The feed
  // must therefore reach its rows through the shared projection and through
  // nothing else.
  const feed = fs.readFileSync(path.join(appRoot, 'src/components/RunProcessFeed.tsx'), 'utf8')
  const panel = fs.readFileSync(path.join(appRoot, 'src/components/InlineRunPanel.tsx'), 'utf8')
  assert.match(feed, /const recordView = useMemo\(\s*\(\) => projectLiveTimeline\(recordEntries, recordTotal\)/,
    'the timeline view is projected from the record entries the run published')
  assert.match(feed, /runTimelineRows\(recordView, draftText\)/,
    'and its rows are the fold over that projection — not a second synthesis')
  assert.match(feed, /const hasRecordTimeline = recordTimeline\.length > 0/)
  assert.match(feed, /agent-conversation-timeline[\s\S]*data-run-timeline="record"[\s\S]*<RunTimelineList rows=\{recordTimeline\}/,
    'the canonical conversation stays in the visible flow instead of the diagnostics disclosure')
  const timelineList = fs.readFileSync(path.join(appRoot, 'src/components/RunTimelineList.tsx'), 'utf8')
  assert.doesNotMatch(timelineList, /agent-process-chip[^"\n]*flex-1/,
    'timeline chips size to their text instead of filling the remaining row')
  assert.doesNotMatch(timelineList, />assistant\{row\.draft/,
    'assistant narration reads as prose in the sequence, not as a competing labelled panel')
  assert.doesNotMatch(panel, /projectLiveTimeline|RunTimelineList|recordTimeline/,
    'the right-side task panel must not duplicate the center timeline')
  assert.match(panel, /title="任務步驟"/,
    'the right-side panel owns structured task progress instead')
  assert.match(panel, /\) : !isPiHost && agent\.steps\.length > 0 \? \(/,
    'the fixed Pi Core Host turn is never presented as if it were live progress')
  assert.doesNotMatch(panel, /\{agent\.progress\}%/,
    'a Pi Host run without a finite plan must not display a fake percentage')
  // The activity-event trace is the FALLBACK. It renders only where no record
  // exists, so the two can never appear side by side as rival accounts.
  for (const fallback of [
    /\{!hasRecordTimeline && thought\.trim\(\) \? \(/,
    /\{!hasRecordTimeline && groups\.length > 0 \? \(/,
    /\{draftText && !hasRecordTimeline \? \(/,
  ]) {
    assert.match(feed, fallback, `the activity-event surface stays gated behind the record path: ${fallback}`)
  }

  // The live projection is a composition of the replay one, not a second
  // implementation of it: one function shapes a row, or neither does.
  const live = fs.readFileSync(path.join(appRoot, 'src/agent/liveTimeline.ts'), 'utf8')
  assert.match(live, /return projectTrajectory\(liveTimelinePage\(entries, seen, limit\)\)/)
  assert.doesNotMatch(live, /RunActivityEvent|piHostActivity/, 'the live timeline may not read the activity vocabulary')

  // Record appends never travel through the activity translator; App handles
  // them first so the two channels keep separate jobs.
  const activity = fs.readFileSync(path.join(appRoot, 'src/agent/piHostActivity.ts'), 'utf8')
  assert.doesNotMatch(activity, /record-append|TurnRecord/, 'the host→feed translator stays transport-only')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const appendIndex = app.indexOf('recordAppendFromEvent(event')
  const mapIndex = app.indexOf('mapPiHostEventToActivity(event)')
  assert.ok(appendIndex > 0 && mapIndex > appendIndex,
    'record appends are handled before — and instead of — the activity mapping')

  const trajectoryPanel = fs.readFileSync(path.join(appRoot, 'src/components/TrajectoryPanel.tsx'), 'utf8')
  assert.match(trajectoryPanel, /const loader = useMemo\(\(\) => loadPage \|\| hostPageLoader\(\), \[loadPage\]\)/,
    'the Host page loader is stable across renderer state updates')
  assert.match(trajectoryPanel, /generation !== requestGeneration\.current/,
    'late page reads cannot overwrite a newer session/request')
  assert.match(trajectoryPanel, /mergeTrajectoryPages\(next, current\)/,
    'overlapping Host pages merge by record identity')

  // Reasoning is written whole. A cap added "just to be safe" is the failure
  // this asserts against, in the Host writer and in the projection alike.
  const host = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  const flush = host.slice(host.indexOf('function flushReasoning'), host.indexOf('function flushReasoning') + 500)
  assert.match(flush, /recorder\.reasoning\.join\(''\)/)
  assert.doesNotMatch(flush, /slice\(0,|substring\(|\.slice\(-/, 'the recorded thought is never shortened')
  const projection = fs.readFileSync(path.join(appRoot, 'src/agent/conversationProjection.ts'), 'utf8')
  const reasoningCase = projection.slice(projection.indexOf("case 'reasoning':"), projection.indexOf("case 'tool-call':"))
  assert.match(reasoningCase, /content: entry\.content/)
  assert.doesNotMatch(reasoningCase, /slice\(/, 'the projection hands over the whole thought')
})

await test('Ticket 05: Working State UI is Host-owned, monotonic, bounded, and read-only', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  const projection = fs.readFileSync(path.join(appRoot, 'src/agent/workingStateProjection.ts'), 'utf8')
  const store = fs.readFileSync(path.join(appRoot, 'src/store/workingStateProjectionStore.ts'), 'utf8')
  const view = fs.readFileSync(path.join(appRoot, 'src/components/WorkingStateView.tsx'), 'utf8')
  const archivePage = fs.readFileSync(path.join(appRoot, 'src/pages/RecordsPage.tsx'), 'utf8')
  const threadStore = fs.readFileSync(path.join(appRoot, 'src/store/threadStore.ts'), 'utf8')
  assert.match(app, /hydrateHostSessions\(sessions\)/)
  assert.match(app, /appendHostRecord\(appended\.entries, appended\.runId\)/)
  assert.match(app, /if \(!api\?\.list\) \{\s*useWorkingStateProjectionStore\.getState\(\)\.setHostAvailable\(false\)/,
    'missing Host capability fail-closed downgrades existing verified projections')
  assert.match(app, /catch \{\s*useWorkingStateProjectionStore\.getState\(\)\.setHostAvailable\(false\)\s*\/\* Host projection/,
    'Host list failure fail-closed downgrades existing verified projections')
  assert.match(projection, /WORKING_STATE_EVIDENCE_LIMIT = 3/)
  assert.match(projection, /if \(current\.tombstoned\) return current/)
  assert.match(projection, /if \(incomingRevision < currentRevision\) return current/)
  assert.match(store, /projectWorkingStateEntries\(entries, state\.hostAvailable\)/)
  assert.match(view, /data-working-state-verification/)
  assert.doesNotMatch(view, /<input|<textarea|contentEditable|onChange|onSubmit/,
    'the renderer may inspect Working State but cannot edit or submit it')
  assert.match(archivePage, /projectWorkingStateEntries\([\s\S]*?turnRecordEntries\(record\),\s*false,/,
    'a renderer archive stays unverified until it is matched to Host-owned identity')
  assert.match(threadStore, /hydrateHostSessions\(\[\{ \.\.\.session, archived: true \}\]\)/,
    'a confirmed Host archive installs a tombstone from the verified pre-archive projection')
})

await test('Ticket 06: delegated goals remain parent-owned and CAS-checked', async () => {
  const fs = await import('node:fs')
  const host = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  const bridge = fs.readFileSync(path.join(appRoot, 'electron/piPackBridges.ts'), 'utf8')
  const background = fs.readFileSync(path.join(appRoot, 'electron/piExtensionPacks/backgroundWork.ts'), 'utf8')
  const record = fs.readFileSync(path.join(appRoot, 'src/agent/turnRecord.ts'), 'utf8')
  const working = fs.readFileSync(path.join(appRoot, 'src/agent/workingState.ts'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.match(host, /createDelegatedGoalAssignment\(/)
  assert.match(host, /checkDelegatedGoalObservation\(\{ state: workingState, assignment, observation, enabled: recorder\.memoryControl\.delegatedGoalChecker \}\)/)
  assert.match(host, /kind: 'delegation-assignment'/)
  assert.match(host, /kind: 'delegation-observation'/)
  assert.match(host, /kind: 'delegation-check'/)
  assert.match(bridge, /requestGoalAdoption/)
  assert.match(host, /delegatedEvidenceStillApplies/)
  assert.match(working, /delegated-evidence-invalidated/)
  assert.match(background, /name: 'delegate_adopt_results'[\s\S]*?policyMigration: \{ sideEffect: true \}/)
  const statusDefinition = background.slice(background.indexOf("name: 'delegate_status'"), background.indexOf("name: 'delegate_adopt_results'"))
  assert.doesNotMatch(statusDefinition, /policyMigration/, 'delegate_status remains a pure observation')
  assert.match(working, /evidence\.parentRunId !== state\.runId/)
  assert.match(working, /stale-goal-conflict/)
  assert.match(record, /TURN_RECORD_FORMAT_VERSION = 11/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-delegated-working-goal\.mts/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-delegated-goal-host\.mts/)
})

await test('Ticket 07: state-changing Skill preflight is contract-bound and zero-match passes through', async () => {
  const fs = await import('node:fs')
  const policy = fs.readFileSync(path.join(appRoot, 'electron/piPolicyEvidence.ts'), 'utf8')
  const preflight = fs.readFileSync(path.join(appRoot, 'electron/piSkillPreflight.ts'), 'utf8')
  const toolHost = fs.readFileSync(path.join(appRoot, 'electron/piToolHost.ts'), 'utf8')
  const host = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  const record = fs.readFileSync(path.join(appRoot, 'src/agent/turnRecord.ts'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.match(policy, /requirements\.sideEffect === true \|\| requirements\.skillPreflight === true/)
  assert.match(policy, /input\.origin === 'model'[\s\S]*?skillPreflight:/)
  assert.match(preflight, /MAX_SKILL_PREFLIGHT_DRAFT_BYTES = 65_536/)
  assert.match(toolHost, /consumePiSkillPreflightDirective\(/)
  assert.match(toolHost, /Host Skill preflight owner is unavailable/)
  assert.match(host, /setPiSkillPreflightBridge\(/)
  assert.match(host, /createSkillPreflight\(/)
  assert.match(host, /kind: 'skill-invocation'/)
  assert.match(record, /TURN_RECORD_FORMAT_VERSION = 11/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-skill-preflight-pass-through\.mts/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-working-state-completion\.mts/)
})

await test('Ticket 08: Skill match blocks the original call and injects one immutable redraft revision', async () => {
  const fs = await import('node:fs')
  const skills = fs.readFileSync(path.join(appRoot, 'electron/piSkills.ts'), 'utf8')
  const toolHost = fs.readFileSync(path.join(appRoot, 'electron/piToolHost.ts'), 'utf8')
  const host = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  const record = fs.readFileSync(path.join(appRoot, 'src/agent/turnRecord.ts'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.match(skills, /selectFrozenPiPreflightSkills/)
  assert.match(skills, /maxSkills === 2[\s\S]*?explicit reason and hard context budget/)
  assert.match(toolHost, /Skill preflight intervened; original call/)
  assert.match(toolHost, /piSkillPreflightExtensionFactory/)
  assert.match(toolHost, /fresh call identity/)
  assert.match(host, /settlement: 'not-executed'/)
  assert.match(host, /kind: 'skill-context'/)
  assert.match(record, /TURN_RECORD_FORMAT_VERSION = 11/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-skill-preflight-redraft\.mts/)
})

await test('Ticket 09: Skill preflight retries are batch-bound and block parallel siblings atomically', async () => {
  const fs = await import('node:fs')
  const preflight = fs.readFileSync(path.join(appRoot, 'electron/piSkillPreflight.ts'), 'utf8')
  const toolHost = fs.readFileSync(path.join(appRoot, 'electron/piToolHost.ts'), 'utf8')
  const runtime = fs.readFileSync(path.join(appRoot, 'electron/piCoreRuntime.ts'), 'utf8')
  const record = fs.readFileSync(path.join(appRoot, 'src/agent/turnRecord.ts'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.match(preflight, /schemaVersion: 2/)
  assert.match(preflight, /batchId: input\.batchId/)
  assert.match(preflight, /identityDigest/)
  assert.match(toolHost, /installPiSkillPreflightBatchBarrier/)
  assert.match(toolHost, /Skill preflight batch identity conflict/)
  assert.match(toolHost, /markBatchNotExecuted/)
  assert.match(runtime, /installPiSkillPreflightBatchBarrier\(sessionId, created\.session\.agent\)/)
  assert.match(record, /TURN_RECORD_FORMAT_VERSION = 11/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-skill-preflight-batch\.mts/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-pi-skill-preflight-stop-replay\.mts/)
})

await test('Ticket 10: each Task run freezes one active Memory-Control Package revision', async () => {
  const fs = await import('node:fs')
  const repository = fs.readFileSync(path.join(appRoot, 'electron/memoryControlPackageRepository.ts'), 'utf8')
  const host = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  const entry = fs.readFileSync(path.join(appRoot, 'electron/piHostEntry.ts'), 'utf8')
  const record = fs.readFileSync(path.join(appRoot, 'src/agent/turnRecord.ts'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
  assert.match(repository, /class JsonMemoryControlPackageRepository/)
  assert.match(repository, /experientialSkills/)
  assert.match(repository, /workingMemorySpec/)
  assert.match(repository, /invocationPolicy/)
  assert.match(repository, /checkers/)
  assert.match(entry, /memory-control-packages\.json/)
  assert.match(host, /memory-control\/v1\/package\/get/)
  assert.match(host, /governingPackage/)
  assert.match(record, /kind: 'memory-control-package'/)
  assert.match(record, /TURN_RECORD_FORMAT_VERSION = 11/)
  assert.match(packageJson.scripts['smoke:pi-host'], /smoke-memory-control-package-lifecycle\.mts/)
})

await test('Ticket 11: Memory-Control candidates are component-local, evaluation-promoted, and rollback-safe', async () => {
  const fs = await import('node:fs')
  const repository = fs.readFileSync(path.join(appRoot, 'electron/memoryControlPackageRepository.ts'), 'utf8')
  const host = fs.readFileSync(path.join(appRoot, 'electron/piHostProtocol.ts'), 'utf8')
  const record = fs.readFileSync(path.join(appRoot, 'src/agent/turnRecord.ts'), 'utf8')
  const entry = fs.readFileSync(path.join(appRoot, 'electron/piHostEntry.ts'), 'utf8')
  const shell = fs.readFileSync(path.join(appRoot, 'electron/shellBridge.ts'), 'utf8')
  const terminal = fs.readFileSync(path.join(appRoot, 'electron/ptyBridge.ts'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  const repositorySmoke = fs.readFileSync(path.join(appRoot, 'scripts/smoke-memory-control-package-repository.mts'), 'utf8')
  assert.match(repository, /createCandidate\(/)
  assert.doesNotMatch(repository, /activateCandidate\(/)
  assert.match(repository, /settleEvaluation\(/)
  assert.match(repository, /rollback\(/)
  assert.match(repository, /changed an undiagnosed component/)
  assert.match(repository, /rollback target was never validated and active/)
  assert.match(repository, /withRepositoryLock/)
  assert.match(repository, /recoverDeadRepositoryLock/)
  assert.match(repository, /STALE_MEMORY_CONTROL_LOCK_MS/)
  assert.match(repository, /validateLifecycleHistory/)
  assert.match(repository, /migrateLegacyLifecycle/)
  assert.match(host, /memoryControlLineage/)
  assert.match(host, /memory-control\/v1\/maintain/)
  assert.match(host, /Memory-Control maintenance requires an active audit Task run/)
  assert.match(host, /pendingMemoryControlAudits/)
  assert.match(host, /memoryControlAuditsClosed/)
  assert.match(record, /Version 10 adds the bounded activation\/rollback event/)
  assert.match(record, /kind: 'memory-control-lifecycle'/)
  assert.match(entry, /delete process\.env\.SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN/)
  assert.match(shell, /delete environment\.SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN/)
  assert.match(terminal, /delete environment\.SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN/)
  assert.match(main, /const memoryControlMaintainerToken = process\.env\.SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN/)
  assert.match(main, /delete process\.env\.SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN/)
  assert.match(main, /SUBAGENTS_MEMORY_CONTROL_MAINTAINER_TOKEN: memoryControlMaintainerToken/)
  assert.match(repositorySmoke, /memory-control-package-candidates\.mts/)
})

console.log(`\n${passed} capability smoke tests passed, ${skipped} skipped`)
if (process.exitCode) {
  console.error('Capability smoke failed')
} else {
  console.log('OK')
}
