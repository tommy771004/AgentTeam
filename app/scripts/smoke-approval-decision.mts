/**
 * Approval Decision pure-module smoke — real import of decide().
 * Replaces hand-copied mirrors of approvalMode / unattended / gate ordering.
 *
 * Run: node --experimental-strip-types scripts/smoke-approval-decision.mts
 */
import assert from 'node:assert/strict'
import {
  decide,
  decideApprovalNeed,
  effectiveApprovalMode,
  type DecideInput,
  type DecisionHookRule,
} from '../src/agent/tools/approvalDecision.ts'

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

function base(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    tool: 'workspace_read',
    args: {},
    subAgentsEnabled: true,
    approvalMode: 'auto',
    ...overrides,
  }
}

console.log('smoke-approval-decision')

// ── thin wrappers still exported ──
test('approvalMode: full skips asks, always asks side-effect tools, auto passes through', () => {
  assert.equal(decideApprovalNeed('full', 'run_code', true), false)
  assert.equal(decideApprovalNeed('full', 'bash', true), false)
  assert.equal(decideApprovalNeed('always', 'workspace_write', false), true)
  assert.equal(decideApprovalNeed('always', 'mcp_srv1_createIssue', false), true)
  assert.equal(decideApprovalNeed('always', 'workspace_read', false), false)
  assert.equal(decideApprovalNeed('always', 'datetime_now', false), false)
  assert.equal(decideApprovalNeed('always', 'jira_search', false, true), true)
  assert.equal(decideApprovalNeed('auto', 'jira_search', false, true), false)
  assert.equal(decideApprovalNeed('auto', 'bash', true), true)
  assert.equal(decideApprovalNeed('auto', 'workspace_write', false), false)
})

test('approvalMode: unattended downgrades full → auto', () => {
  assert.equal(effectiveApprovalMode('full', true), 'auto')
  assert.equal(effectiveApprovalMode('full', false), 'full')
  assert.equal(effectiveApprovalMode('always', true), 'always')
  assert.equal(effectiveApprovalMode(undefined, true), 'auto')
})

// ── decide() priority matrix ──
test('hook deny wins over full-access', () => {
  const rules: DecisionHookRule[] = [
    {
      id: 'deny-write',
      point: 'beforeTool',
      match: { tool: 'workspace_write' },
      action: 'deny',
      reason: 'org policy',
    },
  ]
  const d = decide(
    base({
      tool: 'workspace_write',
      approvalMode: 'full',
      forceAsk: false,
      hookRules: rules,
    }),
  )
  assert.equal(d.verdict, 'deny')
  assert.equal(d.reason, 'hook_deny')
  assert.equal(d.events.length, 1)
  assert.equal(d.events[0]?.kind, 'permissionDenied')
  assert.match(d.events[0]?.reason || '', /hook deny/)
  assert.ok(d.logs.some((l) => l.level === 'WARN' && /hook deny/.test(l.message)))
})

test('capability forceAsk survives full-access', () => {
  const d = decide(
    base({
      tool: 'bash',
      args: { command: 'ls' },
      approvalMode: 'full',
      forceAsk: true,
      resolveBash: () => 'allow',
    }),
  )
  assert.equal(d.verdict, 'ask')
  assert.ok(d.askSpec)
  assert.equal(d.askSpec?.tool, 'bash')
})

test('bash segment allow clears prior policy ask (documented quirk)', () => {
  const d = decide(
    base({
      tool: 'bash',
      args: { command: 'git status' },
      approvalMode: 'auto',
      // policy would ask for edit tools
      permissionPolicy: { edit: 'ask', read: 'allow' },
      resolveBash: (_c, _fb) => 'allow',
      bashRequireAsk: true,
    }),
  )
  // quirk: bash allow clears needAsk → allow without HITL
  assert.equal(d.verdict, 'allow')
  assert.equal(d.reason, 'allow')
})

test('bash segment ask keeps needAsk', () => {
  const d = decide(
    base({
      tool: 'bash',
      args: { command: 'rm -rf /tmp/x' },
      approvalMode: 'auto',
      resolveBash: () => 'ask',
    }),
  )
  assert.equal(d.verdict, 'ask')
  assert.ok(d.logs.some((l) => l.level === 'INFO' && /bash 需核准/.test(l.message)))
})

test('unattended full downgrades; side-effect still asks under auto', () => {
  const d = decide(
    base({
      tool: 'workspace_write',
      args: { path: 'a.ts', content: 'x' },
      approvalMode: 'full',
      unattended: true,
      forceAsk: true, // capability or policy already needs ask
    }),
  )
  assert.equal(d.verdict, 'ask')
  assert.ok(d.logs.some((l) => /無人值守|完整存取權降級/.test(l.message)))
})

test('unattended + side-effect tool with base needAsk forces ask', () => {
  const d = decide(
    base({
      tool: 'http_fetch',
      args: { url: 'https://example.com' },
      approvalMode: 'auto',
      unattended: true,
      forceAsk: true,
    }),
  )
  assert.equal(d.verdict, 'ask')
  assert.equal(d.reason, 'hitl_unattended')
})

test('mcpWrite name heuristic forces ask', () => {
  const d = decide(
    base({
      tool: 'mcp_jira_createIssue',
      approvalMode: 'auto',
      forceAsk: false,
    }),
  )
  assert.equal(d.verdict, 'ask')
})

test('mcp read-like name does not force ask under auto', () => {
  const d = decide(
    base({
      tool: 'mcp_jira_search',
      approvalMode: 'auto',
      forceAsk: false,
    }),
  )
  assert.equal(d.verdict, 'allow')
})

// ── observability fix: three gates now emit permissionDenied ──
test('sub-agent gate deny emits permissionDenied event', () => {
  const d = decide(
    base({
      tool: 'delegate_task',
      subAgentsEnabled: false,
    }),
  )
  assert.equal(d.verdict, 'deny')
  assert.equal(d.reason, 'sub_agent_gate')
  assert.equal(d.events.length, 1)
  assert.equal(d.events[0]?.kind, 'permissionDenied')
  assert.match(d.events[0]?.reason || '', /Sub Agent/)
})

test('blockedTools deny emits permissionDenied event', () => {
  const d = decide(
    base({
      tool: 'bash',
      blockedTools: ['bash'],
    }),
  )
  assert.equal(d.verdict, 'deny')
  assert.equal(d.reason, 'blocked_tools')
  assert.equal(d.events.length, 1)
  assert.equal(d.events[0]?.kind, 'permissionDenied')
})

test('SubDesign gate deny emits permissionDenied event', () => {
  const d = decide(
    base({
      tool: 'workspace_write',
      args: { path: 'x.html' },
      subDesign: { selectedDirectionId: null },
    }),
  )
  assert.equal(d.verdict, 'deny')
  assert.equal(d.reason, 'subdesign_gate')
  assert.equal(d.events.length, 1)
  assert.equal(d.events[0]?.kind, 'permissionDenied')
  assert.match(d.events[0]?.reason || '', /SubDesign/)
})

test('plan mode deny emits permissionDenied event', () => {
  const d = decide(
    base({
      tool: 'bash',
      planMode: { active: true, allowed: false, reason: 'Plan mode: bash 禁止' },
    }),
  )
  assert.equal(d.verdict, 'deny')
  assert.equal(d.reason, 'plan_mode')
  assert.equal(d.events.length, 1)
})

test('policy deny emits permissionDenied event', () => {
  const d = decide(
    base({
      tool: 'bash',
      permissionPolicy: { edit: 'deny', read: 'allow' },
    }),
  )
  assert.equal(d.verdict, 'deny')
  assert.equal(d.reason, 'policy_deny')
  assert.equal(d.events.length, 1)
})

test('hook require-approval forces ask even under full', () => {
  const rules: DecisionHookRule[] = [
    {
      id: 'ask-bash',
      point: 'beforeTool',
      match: { tool: 'bash' },
      action: 'require-approval',
    },
  ]
  const d = decide(
    base({
      tool: 'bash',
      args: { command: 'ls' },
      approvalMode: 'full',
      resolveBash: () => 'allow',
      hookRules: rules,
    }),
  )
  assert.equal(d.verdict, 'ask')
})

test('clean read tool under auto allows with no events', () => {
  const d = decide(base({ tool: 'workspace_read', approvalMode: 'auto' }))
  assert.equal(d.verdict, 'allow')
  assert.equal(d.events.length, 0)
  assert.equal(d.askSpec, undefined)
})

// Permission map shared with FC path — every ToolName (+ mcp sample) agrees.
await test('toolPermissionMap matches for built-in tools and mcp samples', async () => {
  const { toolPermissionKey, checkToolPermission } = await import(
    '../src/agent/toolPermissionMap.ts'
  )
  const { TOOL_DEFINITIONS } = await import('../src/agent/tools/toolDefinitions.ts')
  const names = Object.keys(TOOL_DEFINITIONS)
  assert.ok(names.length >= 40)
  for (const name of names) {
    // smoke: map must return a known PermissionKey string (no throw)
    const key = toolPermissionKey(name)
    assert.match(key, /^(read|edit|web|memory|skill|mcp|task|delegate)$/)
  }
  assert.equal(toolPermissionKey('mcp_jira_createIssue'), 'mcp')
  assert.equal(toolPermissionKey('update_plan'), 'read')
  assert.equal(toolPermissionKey('ask_user'), 'read')
  assert.equal(checkToolPermission({ edit: 'deny' }, 'bash'), 'deny')
  assert.equal(checkToolPermission({ edit: 'deny' }, 'workspace_read'), 'allow')
})

console.log(`\n${passed} tests passed`)
