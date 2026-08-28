import assert from 'node:assert/strict'
import { capabilitiesFromCliHelp } from '../src/agent/cliProviderCapabilities.ts'
import { buildLocalCliArgv } from '../electron/localCliRunner.ts'
import {
  bindPiSessionRun,
  piSessionRunBinding,
  tightenPiSessionApprovalMode,
  tightenPiSessionUnattended,
  unbindPiSessionRun,
} from '../electron/piToolHost.ts'
import { freezePiRunPolicy } from '../electron/piPolicyEvidence.ts'

const common = {
  binaryPath: '/test/provider',
  version: '1.2.3',
  revision: 'b'.repeat(64),
  detectedAt: '2026-08-28T00:00:00.000Z',
}
const codex = capabilitiesFromCliHelp({
  ...common,
  provider: 'codex',
  help: '--config --approve-for-me --dangerously-bypass-approvals-and-sandbox --sandbox read-only workspace-write --service-tier',
})
assert.equal(codex.approval.auto, 'native')
assert.equal(codex.approval.full, 'native')
assert.equal(codex.agentMode.plan, 'native')
assert.deepEqual(codex.serviceTiers, ['standard', 'priority', 'flex'])
assert.deepEqual(buildLocalCliArgv({
  kind: 'codex',
  prompt: 'tier',
  serviceTier: 'priority',
  capabilitySnapshot: codex,
}).args.filter((arg) => arg === '--service-tier' || arg === 'priority'), ['--service-tier', 'priority'])

const oldCursor = capabilitiesFromCliHelp({ ...common, provider: 'cursor', help: '--model' })
assert.equal(oldCursor.approval.full, 'unsupported')
const safeCursorArgs = buildLocalCliArgv({
  kind: 'cursor',
  prompt: 'safe fallback',
  approvalMode: 'full',
  agentMode: 'build',
  capabilitySnapshot: oldCursor,
}).args
assert.equal(safeCursorArgs.includes('--force'), false, 'removed provider flags must fail closed')
assert.equal(buildLocalCliArgv({
  kind: 'cursor',
  prompt: 'unsupported tier',
  serviceTier: 'priority',
  capabilitySnapshot: oldCursor,
}).args.includes('--service-tier'), false, 'unsupported service tier must fall back without fabricating argv')

const policy = freezePiRunPolicy({ agentMode: 'build', approvalMode: 'full', projectRoot: process.cwd() })
bindPiSessionRun('settings-session', { runId: 'settings-run', approvalMode: 'full', frozenPolicy: policy })
assert.equal(tightenPiSessionApprovalMode('settings-session', 'settings-run', 'auto'), true)
assert.equal(piSessionRunBinding('settings-session')?.frozenPolicy?.approvalMode, 'auto')
assert.equal(tightenPiSessionApprovalMode('settings-session', 'settings-run', 'full'), false, 'mid-run authority expansion waits for new admission')
assert.equal(tightenPiSessionUnattended('settings-session', 'settings-run'), true)
assert.equal(piSessionRunBinding('settings-session')?.frozenPolicy?.unattended, true)
unbindPiSessionRun('settings-session')

console.log('CLI capability lifecycle smoke passed')
