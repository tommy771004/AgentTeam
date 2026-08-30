import { strict as assert } from 'node:assert'
import { resolvePiHostStateFile } from '../electron/piHostState.ts'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { readFile as readSource } from 'node:fs/promises'
import { projectConversationRows } from '../src/agent/conversationProjection.ts'
import {
  TURN_RECORD_FORMAT_VERSION,
  derivePiHistory,
  TurnRecordCorruptError,
  TurnRecordVersionError,
  appendTurnRecord,
  parseTurnRecord,
  stepTimings,
  turnRecordEntries,
} from '../src/agent/turnRecord.ts'
import { createInitialWorkingState } from '../src/agent/workingState.ts'
import { BASELINE_MEMORY_CONTROL_PACKAGE, createSkillPreflight, createZeroHitSkillPreflight } from '../electron/piSkillPreflight.ts'

/**
 * The Turn Record is the Host's ordered account of one turn. This asserts the
 * account exists, is ordered by its own sequence, survives a Host restart, and
 * refuses loudly rather than quietly starting from nothing.
 */

// ── The record's own rules (pure) ──────────────────────────────────────────
const seeded = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: '你好', turn: 1, step: 1, at: 2 },
])
assert.deepEqual(seeded.entries.map((entry) => entry.seq), [1, 2])
const continued = appendTurnRecord(seeded, [{ kind: 'turn-end', source: 'host', settlement: 'answered', turn: 1, step: 1, at: 3 }])
assert.deepEqual(continued.entries.map((entry) => entry.seq), [1, 2, 3], 'sequence continues, never restarts')

// Order comes from `seq`, never from position in the array.
const shuffled = { version: TURN_RECORD_FORMAT_VERSION, entries: [continued.entries[2], continued.entries[0], continued.entries[1]] }
assert.deepEqual(turnRecordEntries(shuffled).map((entry) => entry.seq), [1, 2, 3])

// A version this build cannot read is refused, not silently emptied.
assert.throws(() => parseTurnRecord({ version: 99, entries: [] }), TurnRecordVersionError)
// A damaged entry in the middle is refused for the same reason.
assert.throws(
  () => parseTurnRecord({ version: TURN_RECORD_FORMAT_VERSION, entries: [{ kind: 'nope' }, continued.entries[0]] }),
  TurnRecordCorruptError,
)
// A damaged FINAL entry is a torn append: keep the good prefix, report the loss.
const torn = parseTurnRecord({ version: TURN_RECORD_FORMAT_VERSION, entries: [continued.entries[0], { kind: 'turn-en' }] })
assert.equal(torn.tornTail, true)
assert.equal(torn.record.entries.length, 1)
// Absent is not damaged.
assert.deepEqual(parseTurnRecord(undefined), { record: { version: TURN_RECORD_FORMAT_VERSION, entries: [] }, tornTail: false })
assert.equal(TURN_RECORD_FORMAT_VERSION, 13, 'Host-owned agent lifecycle is an explicit Turn Record evolution')
const migratedV1 = parseTurnRecord({ version: 1, entries: continued.entries })
assert.equal(migratedV1.record.version, TURN_RECORD_FORMAT_VERSION)
assert.deepEqual(migratedV1.record.entries, continued.entries, 'v1 records migrate without losing their ordered history')
const migratedV2 = parseTurnRecord({ version: 2, entries: continued.entries })
assert.equal(migratedV2.record.version, TURN_RECORD_FORMAT_VERSION)
assert.deepEqual(migratedV2.record.entries, continued.entries, 'v2 records migrate without losing their ordered history')

const lifecycle = appendTurnRecord(undefined, [{
  kind: 'agent-lifecycle',
  source: 'host',
  event: { agentId: 'child-1', rootAgentId: 'root-1', parentAgentId: 'root-1', taskPath: '/root/analyzer-child1', state: 'waiting-approval', runId: 'run-1' },
  turn: 1,
  step: 0,
  at: 1,
}])
assert.equal(parseTurnRecord(lifecycle).record.entries[0]?.kind, 'agent-lifecycle')
assert.throws(() => parseTurnRecord({ version: 12, entries: lifecycle.entries }), TurnRecordCorruptError, 'v12 cannot smuggle a v13 lifecycle entry')
assert.throws(() => parseTurnRecord({
  version: TURN_RECORD_FORMAT_VERSION,
  entries: [{ ...lifecycle.entries[0], event: { ...lifecycle.entries[0].event, reason: 'x'.repeat(2_049) } }, continued.entries[0]],
}), TurnRecordCorruptError, 'lifecycle metadata remains bounded')

const recalled = appendTurnRecord(undefined, [{
  kind: 'memory-recall', source: 'host', revision: 7,
  items: [{ id: 'entry-1', logicalKey: 'profile:user', scope: 'global', memoryKind: 'profile', revision: 3 }],
  turn: 1, step: 1, at: 1,
}])
assert.throws(() => parseTurnRecord({
  version: 1,
  entries: [recalled.entries[0], continued.entries[0]],
}), TurnRecordCorruptError, 'v1 cannot smuggle a v2 memory-recall entry')
assert.throws(() => parseTurnRecord({
  version: 1,
  entries: [recalled.entries[0]],
}), TurnRecordCorruptError, 'a final v2 entry in v1 is incompatible, not a recoverable torn append')
assert.equal(parseTurnRecord(recalled).record.entries[0]?.kind, 'memory-recall')
assert.equal(parseTurnRecord({ version: 2, entries: recalled.entries }).record.entries[0]?.kind, 'memory-recall')
assert.equal(projectConversationRows(recalled)[0]?.kind, 'notice')
assert.equal(projectConversationRows(recalled)[0]?.kind === 'notice' ? projectConversationRows(recalled)[0]?.content : '', '已召回 1 則長期記憶（revision 7）')
assert.throws(() => parseTurnRecord({
  version: TURN_RECORD_FORMAT_VERSION,
  entries: [
    { ...recalled.entries[0], text: 'private memory must not fit the provenance schema' },
    continued.entries[0],
  ],
}), TurnRecordCorruptError, 'memory provenance rejects copied private text')
for (const invalid of [
  { ...recalled.entries[0], source: 'model' },
  { ...recalled.entries[0], privateMemory: 'must not survive replay' },
  { ...recalled.entries[0], items: [{ ...recalled.entries[0].items[0], logicalKey: 'x'.repeat(257) }] },
]) {
  assert.throws(() => parseTurnRecord({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: [invalid, continued.entries[0]],
  }), TurnRecordCorruptError, 'memory provenance is Host-owned, exact-shape, and bounded')
}

const working = appendTurnRecord(undefined, [{
  kind: 'working-state', source: 'host',
  state: {
    schemaVersion: 1,
    runId: 'run-1',
    revision: 1,
    objective: '完成一件事',
    constraints: [],
    goals: [{ id: 'run-1:goal:1', description: '完成一件事', status: 'pending', evidence: [] }],
  },
  turn: 1, step: 1, at: 1,
}])
assert.equal(parseTurnRecord(working).record.entries[0]?.kind, 'working-state')
for (const legacyVersion of [1, 2]) {
  assert.throws(() => parseTurnRecord({
    version: legacyVersion,
    entries: [working.entries[0]],
  }), TurnRecordCorruptError, `v${legacyVersion} cannot smuggle a v3 Working State entry`)
}
const delegated = appendTurnRecord(undefined, [{
  kind: 'delegation-assignment', source: 'host',
  assignment: {
    schemaVersion: 1,
    delegationId: 'parent-run:delegation:1',
    parentRunId: 'parent-run',
    parentSessionId: 'parent-session',
    childSessionId: 'child-session',
    baseRevision: 1,
    constraints: [],
    goal: {
      id: 'parent-run:goal:1',
      description: 'delegated goal',
      completionPredicate: { kind: 'file-content', path: 'delegated.txt', sha256: 'a'.repeat(64) },
    },
  },
  turn: 1, step: 1, at: 1,
}])
assert.equal(parseTurnRecord({ version: 4, entries: continued.entries }).record.entries.length, 3, 'valid v4 history migrates intact')
for (const legacyVersion of [1, 2, 3, 4]) {
  assert.throws(() => parseTurnRecord({
    version: legacyVersion,
    entries: [delegated.entries[0]],
  }), TurnRecordCorruptError, `v${legacyVersion} cannot smuggle a v5 delegation audit entry`)
}
const skillInvocation = appendTurnRecord(undefined, [{
  kind: 'skill-invocation', source: 'host',
  invocation: createZeroHitSkillPreflight({
    state: createInitialWorkingState({ runId: 'preflight-run', objective: 'write result' }),
    step: 1,
    batchId: 'legacy-v6-batch',
    tool: 'write',
    callId: 'write-1',
    identity: {
      contractRevision: 1,
      contractDigest: 'b'.repeat(64),
      schemaDigest: 'c'.repeat(64),
      toolSource: 'builtin',
    },
    args: { path: 'result.txt' },
  }),
  turn: 1, step: 1, at: 1,
}])
assert.equal(parseTurnRecord(skillInvocation).record.entries[0]?.kind, 'skill-invocation')
assert.equal(parseTurnRecord({ version: 5, entries: continued.entries }).record.entries.length, 3, 'valid v5 history migrates intact')
for (const legacyVersion of [1, 2, 3, 4, 5, 6, 7]) {
  assert.throws(() => parseTurnRecord({
    version: legacyVersion,
    entries: [skillInvocation.entries[0]],
  }), TurnRecordCorruptError, `v${legacyVersion} cannot smuggle a v8 batch Skill invocation entry`)
}
const legacySkillInvocation = appendTurnRecord(undefined, [{
  ...skillInvocation.entries[0],
  invocation: {
    ...skillInvocation.entries[0].invocation,
    schemaVersion: 1 as const,
    batchId: undefined,
    identityDigest: undefined,
  },
}])
assert.equal(parseTurnRecord({ version: 6, entries: legacySkillInvocation.entries }).record.entries[0]?.kind, 'skill-invocation')
assert.equal(parseTurnRecord({ version: 7, entries: legacySkillInvocation.entries }).record.entries[0]?.kind, 'skill-invocation')
const governingPackage = appendTurnRecord(undefined, [{
  kind: 'memory-control-package', source: 'host', packageIdentity: BASELINE_MEMORY_CONTROL_PACKAGE,
  turn: 1, step: 1, at: 1,
}])
assert.equal(parseTurnRecord(governingPackage).record.entries[0]?.kind, 'memory-control-package')
for (const legacyVersion of [1, 2, 3, 4, 5, 6, 7, 8]) {
  assert.throws(() => parseTurnRecord({
    version: legacyVersion,
    entries: governingPackage.entries,
  }), TurnRecordCorruptError, `v${legacyVersion} cannot smuggle a v9 governing package entry`)
}
const promotedPackage = appendTurnRecord(undefined, [{
  kind: 'memory-control-package', source: 'host', packageIdentity: BASELINE_MEMORY_CONTROL_PACKAGE,
  lifecycleEvent: {
    sequence: 2, kind: 'candidate-activated', revision: 1, fromRevision: 2,
    diagnosisComponent: 'checkers', reason: 'bounded evaluation passed',
  },
  turn: 1, step: 1, at: 1,
}])
assert.equal(parseTurnRecord(promotedPackage).record.entries[0]?.kind, 'memory-control-package')
assert.throws(() => parseTurnRecord({ version: 9, entries: promotedPackage.entries }), TurnRecordCorruptError,
  'v9 cannot smuggle a v10 package lifecycle event')
for (const lifecycleEvent of [
  { sequence: 3, kind: 'candidate-rejected', revision: 1, reason: 'not governing' },
  { sequence: 4, kind: 'candidate-activated', revision: 2, fromRevision: 1, reason: 'wrong revision' },
]) {
  assert.throws(() => parseTurnRecord({
    version: TURN_RECORD_FORMAT_VERSION,
    entries: [{ ...promotedPackage.entries[0], lifecycleEvent }, continued.entries[0]],
  }), TurnRecordCorruptError, 'governing lifecycle audit must be an activation/rollback for the same package revision')
}
const rejectedLifecycle = appendTurnRecord(undefined, [{
  kind: 'memory-control-lifecycle', source: 'host',
  event: { sequence: 5, kind: 'candidate-rejected', revision: 3, fromRevision: 1, diagnosisComponent: 'checkers', reason: 'held-out regression' },
  turn: 1, step: 1, at: 1,
}])
assert.equal(parseTurnRecord(rejectedLifecycle).record.entries[0]?.kind, 'memory-control-lifecycle')
assert.throws(() => parseTurnRecord({ version: 9, entries: rejectedLifecycle.entries }), TurnRecordCorruptError,
  'v9 cannot smuggle a v10 lifecycle audit entry')
const skillContext = appendTurnRecord(undefined, [{
  kind: 'skill-context', source: 'host',
  injection: {
    schemaVersion: 1,
    runId: 'preflight-run',
    originalCallId: 'write-1',
    tool: 'write',
    skills: [{ id: 'safe-write', version: 1, digest: 'd'.repeat(64), bodyBytes: 20 }],
    contextBytes: 200,
    contextDigest: 'e'.repeat(64),
    freshCallRequired: true,
  },
  turn: 1, step: 1, at: 2,
}])
const reconstructibleContext = structuredClone(skillContext)
const contextEntry = reconstructibleContext.entries[0]
assert.equal(contextEntry.kind, 'skill-context')
if (contextEntry.kind === 'skill-context') {
  contextEntry.injection = { ...contextEntry.injection, schemaVersion: 2, context: 'exact Skill input', contextBytes: 17 }
}
assert.deepEqual(parseTurnRecord(reconstructibleContext).record.entries, reconstructibleContext.entries)
assert.throws(() => parseTurnRecord({ version: 10, entries: reconstructibleContext.entries }), TurnRecordCorruptError,
  'v10 cannot smuggle a v11 reconstructible Skill context')
const malformedContext = structuredClone(reconstructibleContext)
if (malformedContext.entries[0].kind === 'skill-context') malformedContext.entries[0].injection.contextBytes += 1
assert.equal(parseTurnRecord(malformedContext).tornTail, true, 'mismatched context bytes must not be accepted as a valid final entry')
assert.equal(parseTurnRecord(malformedContext).record.entries.length, 0)
assert.equal(parseTurnRecord({ version: 10, entries: skillContext.entries }).record.entries.length, 1,
  'legacy metadata-only Skill context remains readable')
const redraftSkillInvocation = appendTurnRecord(undefined, [{
  kind: 'skill-invocation', source: 'host',
  invocation: createSkillPreflight({
    state: createInitialWorkingState({ runId: 'preflight-run', objective: 'write result' }),
    step: 1,
    batchId: 'v7-redraft-batch',
    tool: 'write',
    callId: 'write-redraft-1',
    identity: {
      contractRevision: 1,
      contractDigest: 'b'.repeat(64),
      schemaDigest: 'c'.repeat(64),
      toolSource: 'builtin',
    },
    args: { path: 'result.txt' },
    selectedSkills: [{ id: 'safe-write', version: 1, digest: 'd'.repeat(64), bodyBytes: 20 }],
  }),
  turn: 1, step: 1, at: 2,
}])
const notExecutedResult = appendTurnRecord(undefined, [{
  kind: 'tool-result', source: 'host', tool: 'write', callId: 'write-redraft-1',
  settlement: 'not-executed', detail: 'Skill preflight requires a fresh call identity.',
  turn: 1, step: 1, at: 3,
}])
assert.equal(parseTurnRecord({ version: 6, entries: continued.entries }).record.entries.length, 3, 'valid v6 history migrates intact')
assert.equal(parseTurnRecord({ version: 7, entries: continued.entries }).record.entries.length, 3, 'valid v7 history migrates intact')
assert.throws(() => parseTurnRecord({
  version: 6,
  entries: [redraftSkillInvocation.entries[0]],
}), TurnRecordCorruptError, 'v6 cannot smuggle a v7 Skill redraft decision')
assert.throws(() => parseTurnRecord({
  version: 6,
  entries: [notExecutedResult.entries[0]],
}), TurnRecordCorruptError, 'v6 cannot smuggle a v7 not-executed settlement')
for (const legacyVersion of [1, 2, 3, 4, 5, 6]) {
  assert.throws(() => parseTurnRecord({
    version: legacyVersion,
    entries: [skillContext.entries[0]],
  }), TurnRecordCorruptError, `v${legacyVersion} cannot smuggle a v7 Skill context entry`)
}
assert.throws(() => parseTurnRecord({
  version: TURN_RECORD_FORMAT_VERSION,
  entries: [{ ...working.entries[0], source: 'model' }, continued.entries[0]],
}), TurnRecordCorruptError, 'Working State is Host-owned')

// ── Usage fields are ADDITIONS, at the same format version ────────────────
// The cache split and the cost are optional fields on an existing shape, so a
// record carrying them parses under the same version — and a record written
// before they existed parses and projects EXACTLY as it did then. Both halves
// are asserted here, because «向後相容» is only worth the claim if the old
// shape is checked, not just the new one.
const priced = appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
  {
    kind: 'step-end',
    source: 'host',
    turn: 1,
    step: 1,
    at: 9,
    timing: {
      requestAt: 2,
      firstTokenAt: 4,
      completedAt: 9,
      usage: { input: 900, output: 100, total: 1_000, cachedRead: 700, cachedWrite: 50, costUsd: 0.004 },
    },
  },
])
const pricedParsed = parseTurnRecord(priced)
assert.equal(pricedParsed.tornTail, false, 'the new fields do not read as a torn append')
assert.equal(pricedParsed.record.version, TURN_RECORD_FORMAT_VERSION, 'they are not a format change')
const pricedTimings = stepTimings(pricedParsed.record)
assert.equal(pricedTimings.length, 1)
assert.deepEqual(
  pricedTimings[0].usage,
  { input: 900, output: 100, total: 1_000, cachedRead: 700, cachedWrite: 50, costUsd: 0.004 },
  'the step-timing view passes every recorded usage field through untouched',
)
assert.equal(pricedTimings[0].running, false)

// The same run as an older build wrote it: three fields, no cache, no cost.
const legacy = parseTurnRecord({
  version: TURN_RECORD_FORMAT_VERSION,
  entries: priced.entries.map((entry) => (entry.kind === 'step-end' && entry.timing?.usage
    ? { ...entry, timing: { ...entry.timing, usage: { input: 900, output: 100, total: 1_000 } } }
    : entry)),
})
assert.equal(legacy.tornTail, false, 'a record from before these fields still parses whole')
const legacyTimings = stepTimings(legacy.record)
assert.deepEqual(legacyTimings[0].usage, { input: 900, output: 100, total: 1_000 })
assert.equal(legacyTimings[0].usage?.cachedRead, undefined, 'an unreported field stays absent, never 0')
assert.equal(legacyTimings[0].usage?.costUsd, undefined)
// Everything the old build could produce is unchanged, field for field.
assert.equal(legacyTimings[0].waitingMs, pricedTimings[0].waitingMs)
assert.equal(legacyTimings[0].generatingMs, pricedTimings[0].generatingMs)
assert.equal(legacyTimings[0].totalMs, pricedTimings[0].totalMs)
assert.equal(legacyTimings[0].running, pricedTimings[0].running)

// A step still running reports no usage at all — there is nothing measured yet.
const midFlight = stepTimings(appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'step-start', source: 'host', turn: 1, step: 1, at: 2 },
]))
assert.equal(midFlight[0].running, true)
assert.equal(midFlight[0].usage, undefined, 'an unfinished step measures nothing')

// Derived history keeps the agent's actions, in order, and replays a
// compaction as the drop it performed rather than re-growing the context.
const derived = derivePiHistory(appendTurnRecord(undefined, [
  { kind: 'turn-start', source: 'host', turn: 1, step: 1, at: 1 },
  { kind: 'user-text', source: 'user', content: '第一題', turn: 1, step: 1, at: 2 },
  { kind: 'tool-call', source: 'model', tool: 'grep', callId: 'c1', turn: 1, step: 1, at: 3 },
  { kind: 'tool-result', source: 'host', tool: 'grep', callId: 'c1', settlement: 'success', turn: 1, step: 1, at: 4 },
  { kind: 'assistant-text', source: 'model', content: '第一答', turn: 1, step: 1, at: 5 },
  { kind: 'compaction', source: 'host', replaced: 2, turn: 2, step: 1, at: 6 },
  { kind: 'user-text', source: 'user', content: '第二題', turn: 2, step: 1, at: 7 },
]))
assert.deepEqual(derived, [
  { role: 'tool', content: '← grep(c1) success' },
  { role: 'assistant', content: '第一答' },
  { role: 'user', content: '第二題' },
])

// ── No consumer outside the derivation module picks the answer itself ──────
// The defect that started this effort was one `.find()` over a turn's items.
for (const path of ['../electron/piHostProtocol.ts', '../src/store/agentStore.ts', '../electron/piCoreRuntime.ts']) {
  const source = await readSource(resolve(import.meta.dirname, path), 'utf8')
  assert.doesNotMatch(source, /turn\.items\s*\.\s*(find|at)/, `${path} must derive the answer, never pick it out of the turn items`)
  assert.doesNotMatch(source, /turn\.items\[/, `${path} must not index a turn's items`)
}

// ── The Host writes one for a real, tool-using turn ────────────────────────
const agentDir = await mkdtemp(join(tmpdir(), 'pi-record-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-record-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-record-cwd-'))
await writeFile(join(workspace, 'notes.md'), '# Notes\nPi Core is active\n')
const statePath = join(stateDir, 'state.json')

let completions = 0
const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
  id: 'record-completion',
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  for await (const part of request) void part
  completions += 1
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (completions === 1) {
    response.write(chunk({ role: 'assistant', content: '先看看檔案。' }, null))
    response.write(chunk({
      tool_calls: [{ index: 0, id: 'call_grep_1', type: 'function', function: { name: 'grep', arguments: JSON.stringify({ pattern: 'Pi Core', path: '.' }) } }],
    }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: `結論 ${completions}` }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      apiKey: 'test-key',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const env = { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: agentDir }
const hostPath = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const profile = {
  provider: 'loopback',
  model: 'smoke-model',
  thinkingLevel: 'off',
  activeTools: ['grep'],
  compaction: 'manual',
  approvalMode: 'full',
  unattended: true,
}
const stopHosts: Array<() => Promise<void>> = []

async function startHost() {
  const host = spawn(process.execPath, [hostPath], { env, stdio: ['pipe', 'pipe', 'inherit'] })
  const output = createInterface({ input: host.stdout })
  const messages: Array<Record<string, any>> = []
  output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
  const waitFor = async (predicate: (message: Record<string, any>) => boolean, label = 'message') => {
    for (;;) {
      const current = messages.find(predicate)
      if (current) return current
      await Promise.race([
        once(output, 'line'),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 20_000)),
      ])
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    if (host.exitCode === null && host.signalCode === null) {
      host.stdin.end()
      await once(host, 'exit')
    }
  }
  stopHosts.push(stop)
  return { host, waitFor, send, stop }
}

let sessionId = ''
try {
  const first = await startHost()
  first.send(1, 'initialize', { protocolVersion: 2 })
  await first.waitFor((message) => message.id === 1, 'initialize')
  first.send(2, 'sessions/create', { title: 'Turn record smoke' })
  sessionId = String((await first.waitFor((message) => message.id === 2, 'session')).result.sessionId)
  first.send(3, 'settings/update', { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['grep'] })
  await first.waitFor((message) => message.id === 3, 'settings')
  first.send(4, 'turn/submit', { sessionId, runId: 'record-run-1', cwd: workspace, prompt: '分析這個專案', profile })
  const settled = await first.waitFor((message) => message.id === 4, 'settlement')
  assert.equal(settled.result?.settlement, 'answered')
  const expectedWorkingState = {
    schemaVersion: 1,
    runId: 'record-run-1',
    revision: 1,
    objective: '分析這個專案',
    constraints: [],
    goals: [{
      id: 'record-run-1:goal:1',
      description: '分析這個專案',
      status: 'pending',
      evidence: [],
    }],
  }
  assert.deepEqual(
    settled.result?.workingState,
    expectedWorkingState,
    'the Host returns the canonical revision-1 Working State for the admitted run',
  )
  const liveWorkingState = settled.result?.record?.entries.find((entry: { kind?: string }) => entry.kind === 'working-state')
  assert.deepEqual(liveWorkingState?.state, expectedWorkingState, 'the live turn slice carries the same Host state')

  first.send(5, 'sessions/list')
  const listed = await first.waitFor((message) => message.id === 5, 'sessions')
  const projected = listed.result.sessions.find((candidate: { id: string }) => candidate.id === sessionId)
  // Listing sessions reports that a record exists; reading it is paged, so a
  // long history cannot ride along with every list.
  assert.equal(projected.record, undefined)
  assert.equal(projected.recordSummary.version, TURN_RECORD_FORMAT_VERSION)
  assert.ok(projected.recordSummary.entries > 0)
  assert.deepEqual(projected.workingState, expectedWorkingState, 'session projection comes from the Host record')
  first.send(6, 'sessions/record', { sessionId })
  const paged = await first.waitFor((message) => message.id === 6, 'record page')
  const entries = turnRecordEntries({ version: TURN_RECORD_FORMAT_VERSION, entries: paged.result.page.entries })
  assert.equal(paged.result.page.hasOlder, false, 'this run fits in one page')
  const replayedWorkingState = entries.find((entry) => entry.kind === 'working-state')
  assert.deepEqual(replayedWorkingState && 'state' in replayedWorkingState ? replayedWorkingState.state : undefined, expectedWorkingState)
  assert.deepEqual(replayedWorkingState, liveWorkingState, 'live and replay use the exact same sequenced state entry')

  const kinds = entries.map((entry) => entry.kind)
  assert.equal(kinds[0], 'agent-lifecycle', 'the record opens with Host admission before the first turn')
  assert.equal(entries[0]?.kind === 'agent-lifecycle' ? entries[0].event.state : undefined, 'admitted')
  assert.ok(kinds.indexOf('turn-start') < kinds.indexOf('user-text'), 'the turn still opens before model-visible work')
  assert.equal(kinds[kinds.length - 1], 'turn-end', 'and closes with it')
  assert.ok(kinds.includes('user-text'), 'the prompt is on the record')
  assert.ok(kinds.includes('assistant-text'), 'so is the answer')
  assert.ok(kinds.includes('tool-call'), 'so is the tool the model asked for')

  // Sequence is monotonic, and every entry knows where it sits.
  assert.deepEqual(entries.map((entry) => entry.seq), entries.map((_, index) => index + 1))
  assert.ok(entries.every((entry) => entry.turn === 1), 'one turn, all entries')
  assert.ok(entries.every((entry) => entry.step >= 0))
  assert.ok(entries.every((entry) => typeof entry.at === 'number' && entry.at > 0))

  // ADR-0048: who is accountable is part of the record.
  const toolCall = entries.find((entry) => entry.kind === 'tool-call')
  assert.equal(toolCall?.source, 'model', 'a tool call is the model asking')
  const answer = entries.find((entry) => entry.kind === 'assistant-text')
  assert.equal(answer?.source, 'model')
  assert.equal(entries.find((entry) => entry.kind === 'turn-end')?.source, 'host')
  const closing = entries.find((entry) => entry.kind === 'turn-end')
  assert.equal(closing && 'settlement' in closing ? closing.settlement : undefined, 'answered')

  // History is derived from the record, so it carries the agent's actions as
  // well as its prose, in the order they happened.
  assert.deepEqual(projected.messages, [
    { role: 'user', content: '分析這個專案' },
    { role: 'assistant', content: '先看看檔案。' },
    { role: 'tool', content: '→ grep(call_grep_1)' },
    { role: 'tool', content: '← grep(call_grep_1) success' },
    { role: 'assistant', content: '結論 2' },
  ])
  assert.deepEqual(
    derivePiHistory({ version: TURN_RECORD_FORMAT_VERSION, entries: paged.result.page.entries }),
    projected.messages,
    'the stored history IS the derivation',
  )
  await first.stop()

  // ── The record survives a Host restart and keeps counting ────────────────
  const persisted = JSON.parse(await readFile(await resolvePiHostStateFile(statePath), 'utf8'))
  assert.ok(persisted.sessions.find((candidate: { id: string }) => candidate.id === sessionId)?.record?.entries?.length > 0)

  const second = await startHost()
  second.send(1, 'initialize', { protocolVersion: 2 })
  await second.waitFor((message) => message.id === 1, 'initialize (restarted)')
  second.send(2, 'turn/submit', { sessionId, runId: 'record-run-2', cwd: workspace, prompt: '再一次', profile })
  assert.equal((await second.waitFor((message) => message.id === 2, 'second settlement')).result?.settlement, 'answered')
  second.send(3, 'sessions/record', { sessionId })
  const relisted = await second.waitFor((message) => message.id === 3, 'record page (restarted)')
  const after = turnRecordEntries({ version: TURN_RECORD_FORMAT_VERSION, entries: relisted.result.page.entries })

  assert.ok(after.length > entries.length, 'the second turn appended rather than replaced')
  assert.deepEqual(after.slice(0, entries.length).map((entry) => entry.seq), entries.map((entry) => entry.seq))
  assert.deepEqual(after.map((entry) => entry.seq), after.map((_, index) => index + 1), 'no gap and no restart across the boundary')
  assert.deepEqual([...new Set(after.map((entry) => entry.turn))], [1, 2], 'the second turn is turn 2')
  await second.stop()
} finally {
  await Promise.all(stopHosts.map((stop) => stop()))
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
console.log('The Pi Host writes an ordered Turn Record that survives a restart')
