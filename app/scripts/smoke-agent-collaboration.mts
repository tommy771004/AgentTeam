import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { projectAgentWorkTree } from '../src/agent/agentWorkTreeProjection.ts'
import type { TurnRecordEntry } from '../src/agent/turnRecord.ts'

type HostMessage = { id?: number; event?: string; payload?: unknown; result?: Record<string, any>; error?: { code: string; message: string } }
type Harness = {
  process: ChildProcessWithoutNullStreams
  output: Interface
  messages: HostMessage[]
  send: (id: number, method: string, params?: Record<string, unknown>) => void
  waitFor: (id: number) => Promise<HostMessage>
}

const workspace = await mkdtemp(join(tmpdir(), 'agent-collaboration-workspace-'))
const stateDir = await mkdtemp(join(tmpdir(), 'agent-collaboration-state-'))
const statePath = join(stateDir, 'state.json')
const protectedPath = join(workspace, 'protected.txt')
await writeFile(protectedPath, 'protected\n')
execFileSync('git', ['init'], { cwd: workspace })
execFileSync('git', ['config', 'user.email', 'smoke@example.test'], { cwd: workspace })
execFileSync('git', ['config', 'user.name', 'Smoke'], { cwd: workspace })
execFileSync('git', ['add', '.'], { cwd: workspace })
execFileSync('git', ['commit', '-m', 'baseline'], { cwd: workspace })
const protectedHash = createHash('sha256').update(await readFile(protectedPath)).digest('hex')

function startHost(): Harness {
  const childProcess = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath }, stdio: ['pipe', 'pipe', 'inherit'],
  })
  const output = createInterface({ input: childProcess.stdout })
  const messages: HostMessage[] = []
  output.on('line', (line) => messages.push(JSON.parse(line) as HostMessage))
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => childProcess.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  const waitFor = async (id: number) => {
    for (;;) {
      const message = messages.find((candidate) => candidate.id === id)
      if (message) return message
      await once(output, 'line')
    }
  }
  return { process: childProcess, output, messages, send, waitFor }
}

async function stopHost(host: Harness) {
  host.process.stdin.end()
  await once(host.process, 'exit')
  host.output.close()
}

const childParams = (spawnId: string, parentAgentId: string, objective: string, workspaceMode: Record<string, unknown>, depth = 1) => ({
  spawnId, parentAgentId, objective, role: 'worker', depth,
  profile: { activeTools: [] },
  context: { objective, facts: ['bounded fixture'], constraints: ['no credential payloads'] },
  workspace: workspaceMode,
})

let host = startHost()
let isolatedWorktreePath = ''
try {
  host.send(1, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1', 'agent-collaboration-v1', 'review-v1'] })
  assert.equal((await host.waitFor(1)).error, undefined)
  host.send(2, 'sessions/create', { title: 'Collaboration root', threadId: 'collaboration-thread' })
  const rootId = String((await host.waitFor(2)).result?.sessionId)

  host.send(3, 'agents/spawn', childParams('writer-a', rootId, 'write scope A', { mode: 'shared-leased-write', projectRoot: workspace, scopes: ['protected.txt'] }))
  const writerA = await host.waitFor(3)
  assert.equal(writerA.error, undefined, writerA.error?.message)
  const writerAId = String(writerA.result?.sessionId)
  const writerARun = String(writerA.result?.runId)

  host.send(4, 'agents/spawn', childParams('writer-b', rootId, 'write scope B', { mode: 'shared-leased-write', projectRoot: workspace, scopes: ['protected.txt'] }))
  assert.match((await host.waitFor(4)).error?.message || '', /conflicts with agent/)
  host.send(40, 'agents/spawn', childParams('writer-b', rootId, 'write scope B', { mode: 'shared-leased-write', projectRoot: workspace, scopes: ['protected.txt'] }))
  const duplicateConflict = await host.waitFor(40)
  assert.match(duplicateConflict.error?.message || '', /conflicts with agent/, 'a rejected spawn retry must replay rejection')
  assert.equal(duplicateConflict.result, undefined, 'a rejected spawn retry must not become duplicate success')
  host.send(5, 'sessions/list')
  const sessions = (await host.waitFor(5)).result?.sessions || []
  const writerB = sessions.find((session: Record<string, any>) => session.agentAdmission?.spawnId === 'writer-b')
  assert.ok(writerB)
  host.send(6, 'sessions/record', { sessionId: writerB.id })
  const writerBEntries = (await host.waitFor(6)).result?.page?.entries || []
  const conflict = writerBEntries.find((entry: Record<string, any>) => entry.kind === 'agent-collaboration' && entry.event?.type === 'conflict')?.event?.conflict
  assert.ok(conflict?.conflictId)
  assert.deepEqual(conflict.choices, ['serialize', 'narrow-scope', 'transfer-lease', 'release-lease', 'isolate-worktree', 'cancel'])
  assert.equal(createHash('sha256').update(await readFile(protectedPath)).digest('hex'), protectedHash, 'overlap is rejected before mutation')

  host.send(7, 'agents/lease/resolve', { conflictId: conflict.conflictId, requestedBy: rootId, action: 'isolate-worktree' })
  const isolated = await host.waitFor(7)
  assert.equal(isolated.error, undefined, isolated.error?.message)
  host.send(8, 'sessions/list')
  const isolatedSession = (await host.waitFor(8)).result?.sessions?.find((session: Record<string, any>) => session.id === writerB.id)
  assert.equal(isolatedSession.agentAdmission.workspace.mode, 'isolated-worktree')
  assert.equal(isolatedSession.agentAdmission.workspace.verified, true)
  assert.notEqual(isolatedSession.agentAdmission.workspace.worktreePath, workspace)
  isolatedWorktreePath = isolatedSession.agentAdmission.workspace.worktreePath

  host.send(9, 'agents/send', { messageId: 'queue-only-1', senderAgentId: rootId, receiverAgentId: writerAId, content: 'token=should-redact continue with the bounded contract' })
  const sent = await host.waitFor(9)
  assert.equal(sent.error, undefined)
  assert.match(sent.result?.message.content, /token=\[REDACTED\]/)
  host.send(10, 'agents/mailbox', { agentId: writerAId })
  assert.equal((await host.waitFor(10)).result?.messages?.[0]?.deliveryState, 'queued')
  host.send(11, 'agents/ack', { agentId: writerAId, messageId: 'queue-only-1' })
  assert.equal((await host.waitFor(11)).result?.message?.deliveryState, 'acknowledged')

  host.send(12, 'agents/wait', { agentId: rootId, timeoutMs: 60_000 })
  host.send(13, 'runs/claim', { runId: writerARun }); assert.equal((await host.waitFor(13)).error, undefined)
  host.send(130, 'review/v1/admit', { runId: writerARun, threadId: writerAId, projectRoot: workspace, runnerKind: 'builtin' })
  const childReviewAdmission = await host.waitFor(130)
  const childSnapshotId = childReviewAdmission.result?.reviewAdmission?.snapshotId
  assert.ok(childSnapshotId)
  host.send(131, 'review/v1/finalize', { snapshotId: childSnapshotId, settlementKind: 'completed', activeWorkspaceRuns: 1 })
  assert.equal((await host.waitFor(131)).result?.reviewSnapshotRef?.status, 'ready')
  host.send(140, 'agents/follow-up', { messageId: 'queued-before-settlement', senderAgentId: rootId, receiverAgentId: writerAId, content: 'run after the active child settles' })
  const queuedBeforeSettlement = await host.waitFor(140)
  assert.equal(queuedBeforeSettlement.result?.queued, true)
  assert.equal(queuedBeforeSettlement.result?.started, false)
  host.send(14, 'runs/settle', { runId: writerARun, settlement: 'answered' })
  const firstSettlement = await host.waitFor(14)
  assert.equal(firstSettlement.error, undefined)
  const drainedRun = firstSettlement.result?.queue?.find((run: Record<string, any>) => run.runId === 'queued-before-settlement:run')
  assert.equal(drainedRun?.status, 'queued', 'settlement commits before draining the next durable follow-up')
  const completion = await host.waitFor(12)
  assert.equal(completion.result?.outcome, 'terminal')
  assert.equal(completion.result?.message?.senderAgentId, writerAId)
  host.send(143, 'sessions/record', { sessionId: rootId, limit: 128 })
  const settledEntries = ((await host.waitFor(143)).result?.page?.entries || []) as TurnRecordEntry[]
  const settledRow = projectAgentWorkTree(settledEntries, 1).find((row) => row.agentId === writerAId)
  assert.equal(settledRow?.reviewSnapshotRef?.snapshotId, childSnapshotId, 'Agent Work Tree uses the Host settlement snapshot identity')

  host.send(141, 'runs/claim', { runId: drainedRun.runId }); assert.equal((await host.waitFor(141)).error, undefined)
  host.send(142, 'runs/settle', { runId: drainedRun.runId, settlement: 'answered' }); assert.equal((await host.waitFor(142)).error, undefined)

  host.send(15, 'agents/follow-up', { messageId: 'follow-up-1', senderAgentId: rootId, receiverAgentId: writerAId, content: 'perform the next bounded pass' })
  const followUp = await host.waitFor(15)
  assert.equal(followUp.result?.started, true)
  const followUpRun = String(followUp.result?.runId)
  host.send(16, 'runs/claim', { runId: followUpRun }); await host.waitFor(16)
  host.send(17, 'runs/settle', { runId: followUpRun, settlement: 'failed' }); await host.waitFor(17)

  host.send(18, 'agents/spawn', childParams('restart-child', rootId, 'survive host restart honestly', { mode: 'shared-readonly', projectRoot: workspace, scopes: [] }))
  const restartChild = await host.waitFor(18)
  host.send(19, 'runs/claim', { runId: restartChild.result?.runId }); await host.waitFor(19)
  const restartChildId = String(restartChild.result?.sessionId)
  await stopHost(host)

  host = startHost()
  host.send(20, 'initialize', { protocolVersion: 5, capabilities: ['agent-tree-v1', 'agent-collaboration-v1', 'review-v1'] }); await host.waitFor(20)
  host.send(21, 'agents/list', { rootAgentId: rootId })
  const recovered = await host.waitFor(21)
  assert.equal(recovered.result?.agents?.find((agent: Record<string, any>) => agent.agentId === restartChildId)?.lifecycle, 'interrupted')
  host.send(22, 'agents/mailbox', { agentId: rootId })
  const parentMail = (await host.waitFor(22)).result?.messages || []
  assert.equal(parentMail.filter((message: Record<string, any>) => message.senderAgentId === restartChildId && message.kind === 'completion').length, 1)

  host.send(23, 'sessions/record', { sessionId: rootId, limit: 256 })
  const rootEntries = ((await host.waitFor(23)).result?.page?.entries || []) as TurnRecordEntry[]
  const firstTurnRows = projectAgentWorkTree(rootEntries, 1)
  assert.ok(firstTurnRows.some((row) => row.agentId === restartChildId), 'late recovery completion stays on the originating turn')
  assert.equal(projectAgentWorkTree(rootEntries, 2).some((row) => row.agentId === restartChildId), false, 'late child activity does not bleed into the next active turn')
} finally {
  if (host.process.exitCode === null) await stopHost(host)
  if (isolatedWorktreePath) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', isolatedWorktreePath], { cwd: workspace })
    } catch {
      /* A failed assertion must not hide the original failure behind cleanup. */
    }
  }
  await rm(workspace, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
}

const agentWorkTreeUi = await readFile(new URL('../src/components/AgentWorkTree.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(agentWorkTreeUi, /agent-review:|review\.admit|review\.finalize/, 'Agent Work Tree must not mint a second review lifecycle')
assert.match(agentWorkTreeUi, /row\.reviewSnapshotRef\.snapshotId/, 'Agent Work Tree opens only the Host settlement snapshot')

console.log('Host-owned agent collaboration lifecycle, conflict isolation, recovery, and turn attribution are qualified')
