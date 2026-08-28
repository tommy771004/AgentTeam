import assert from 'node:assert/strict'
import { buildLocalCliArgv, type LocalCliKind } from '../electron/localCliRunner.ts'

const dangerousFlags = [
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-skip-permissions',
  '--always-approve',
  '--force',
]

function argv(kind: LocalCliKind, approvalMode: 'always' | 'auto' | 'full', input: {
  agentMode?: 'build' | 'plan'
  unattended?: boolean
} = {}) {
  return buildLocalCliArgv({
    kind,
    prompt: 'approval smoke',
    approvalMode,
    agentMode: input.agentMode || 'build',
    unattended: input.unattended,
  }).args
}

function assertNoDanger(args: string[], label: string) {
  for (const flag of dangerousFlags) {
    assert.equal(args.includes(flag), false, `${label} must not contain ${flag}`)
  }
}

assert.deepEqual(argv('codex', 'always').slice(5, 9), ['-s', 'workspace-write', '-c', 'approval_policy="untrusted"'])
assert.ok(argv('codex', 'auto').includes('--approve-for-me'))
assert.ok(argv('codex', 'full').includes('--dangerously-bypass-approvals-and-sandbox'))

assert.deepEqual(argv('claude', 'always').slice(4, 6), ['--permission-mode', 'manual'])
assert.deepEqual(argv('claude', 'auto').slice(4, 6), ['--permission-mode', 'auto'])
assert.ok(argv('claude', 'full').includes('--dangerously-skip-permissions'))

assert.ok(argv('grok', 'always').join(' ').includes('--permission-mode default'))
assert.ok(argv('grok', 'auto').join(' ').includes('--permission-mode auto'))
assert.ok(argv('grok', 'full').includes('--always-approve'))

for (const kind of ['codex', 'claude', 'grok', 'cursor'] as const) {
  assertNoDanger(argv(kind, 'always'), `${kind}/always`)
  assertNoDanger(argv(kind, 'auto'), `${kind}/auto`)
  assertNoDanger(argv(kind, 'full', { unattended: true }), `${kind}/full/unattended`)
  assertNoDanger(argv(kind, 'full', { agentMode: 'plan' }), `${kind}/full/plan`)
}

assert.ok(argv('codex', 'full', { agentMode: 'plan' }).join(' ').includes('-s read-only'))
assert.ok(argv('claude', 'full', { agentMode: 'plan' }).join(' ').includes('--permission-mode plan'))
assert.ok(argv('grok', 'full', { agentMode: 'plan' }).join(' ').includes('--permission-mode plan'))
assert.ok(argv('cursor', 'full').includes('--force'))

console.log('CLI approval argv smoke passed')
