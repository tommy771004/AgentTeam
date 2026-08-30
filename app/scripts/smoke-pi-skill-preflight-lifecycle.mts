import assert from 'node:assert/strict'
import { freezePiRunPolicy } from '../electron/piPolicyEvidence.ts'
import {
  bindPiSessionRun,
  bindPiSessionSkillResourceView,
  disposePiSkillPreflightSession,
  installPiSkillPreflightBatchBarrier,
  piSessionRunBinding,
  setPiPolicyEvidenceBridge,
  setPiSkillPreflightBridge,
  retirePiSkillPreflightSession,
  unbindPiSessionRun,
} from '../electron/piToolHost.ts'

const identity = {
  contractRevision: 7,
  contractDigest: 'b'.repeat(64),
  schemaDigest: 'c'.repeat(64),
  toolSource: 'builtin' as const,
}
const policy = freezePiRunPolicy({ projectRoot: process.cwd(), approvalMode: 'full', outboundMode: 'off' })
const calls = [{
  type: 'toolCall', id: 'lifecycle-write', name: 'write',
  arguments: { path: 'result.txt', content: 'must-not-run\n' },
}]
const context = {
  assistantMessage: { content: calls },
  toolCall: { id: 'lifecycle-write', name: 'write', arguments: calls[0].arguments },
  args: calls[0].arguments,
  context: { tools: [] },
}

function bind(sessionId: string, runId: string): void {
  bindPiSessionRun(sessionId, { runId, approvalMode: 'full', frozenPolicy: policy })
}

function install(sessionId: string, signal?: AbortSignal) {
  const agent: {
    beforeToolCall?: (input: typeof context, nextSignal?: AbortSignal) => Promise<{ block?: boolean; reason?: string } | undefined>
  } = {}
  installPiSkillPreflightBatchBarrier(sessionId, agent)
  return agent.beforeToolCall!(context, signal)
}

function configureBridge(snapshotRun: string, decision: () => Promise<{ kind: 'pass-through' }>): { release: () => void; started: Promise<void> } {
  let release!: () => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  setPiSkillPreflightBridge({
    snapshot: () => ({ runId: snapshotRun, step: 1, workingStateRevision: 1 }),
    preflight: async () => {
      markStarted()
      await new Promise<void>((resolve) => { release = resolve })
      return decision()
    },
    contextInjected: () => undefined,
  })
  return { release: () => release(), started }
}

setPiPolicyEvidenceBridge({
  contractIdentity: () => identity,
  append: () => undefined,
})

const disposedSession = 'preflight-lifecycle-disposed'
bind(disposedSession, 'run-old')
const disposedGate = configureBridge('run-old', async () => ({ kind: 'pass-through' }))
const disposedPending = install(disposedSession)
await disposedGate.started
disposePiSkillPreflightSession(disposedSession)
disposedGate.release()
const disposedResult = await disposedPending
assert.equal(disposedResult?.block, true)
assert.match(disposedResult?.reason || '', /disposed/i)

// Reusing the session and call identity after logical disposal must not inherit
// a late decision from the old generation.
bind(disposedSession, 'run-new')
const freshGate = configureBridge('run-new', async () => ({ kind: 'pass-through' }))
const freshPending = install(disposedSession)
await freshGate.started
freshGate.release()
assert.equal(await freshPending, undefined)
unbindPiSessionRun(disposedSession)

async function assertCancelledBatch(): Promise<void> {
  const sessionId = 'preflight-lifecycle-cancelled'
  bind(sessionId, 'run-cancelled')
  const controller = new AbortController()
  const gate = configureBridge('run-cancelled', async () => ({ kind: 'pass-through' }))
  const pending = install(sessionId, controller.signal)
  await gate.started
  controller.abort()
  gate.release()
  const cancelled = await pending
  assert.equal(cancelled?.block, true)
  assert.match(cancelled?.reason || '', /cancelled/i)
  const replay = await install(sessionId)
  assert.equal(replay?.block, true, 'cancelled batch must remain fail-closed after settlement')
  unbindPiSessionRun(sessionId)
}

async function assertErroredBatch(): Promise<void> {
  const sessionId = 'preflight-lifecycle-error'
  bind(sessionId, 'run-error')
  const gate = configureBridge('run-error', async () => { throw new Error('fixture decision failure') })
  const pending = install(sessionId)
  await gate.started
  gate.release()
  const errored = await pending
  assert.equal(errored?.block, true)
  assert.match(errored?.reason || '', /failed closed/i)
  const replay = await install(sessionId)
  assert.equal(replay?.block, true, 'errored batch must remain fail-closed after settlement')
  unbindPiSessionRun(sessionId)
}

await assertCancelledBatch()
await assertErroredBatch()

const retainedSession = 'preflight-lifecycle-retire'
bind(retainedSession, 'run-retained')
const retainedView = {
  root: '/tmp/pi-retained-resource-view',
  digest: 'd'.repeat(64),
  manifest: ['deploy-checklist/SKILL.md'],
  fileDigests: { 'deploy-checklist/SKILL.md': 'e'.repeat(64) },
}
bindPiSessionSkillResourceView(retainedSession, retainedView)
retirePiSkillPreflightSession(retainedSession)
const retainedBinding = piSessionRunBinding(retainedSession)
assert.equal(retainedBinding?.runId, 'run-retained', 'runtime retirement keeps the logical run binding')
assert.deepEqual(retainedBinding?.frozenPolicy?.resourceView, retainedView, 'runtime retirement keeps the frozen resource view')
unbindPiSessionRun(retainedSession)
setPiSkillPreflightBridge(undefined)
console.log('Pi Skill preflight lifecycle generations, cancellation, and error tombstones are fail-closed')
