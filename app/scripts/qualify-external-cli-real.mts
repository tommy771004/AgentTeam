/**
 * Real-machine External CLI qualification.
 *
 * This is an operator qualification, not an automated smoke: it only runs a
 * provider when its binary and local auth are present. The invocation goes
 * through the same admission and adapter owners as a real external task.
 * Evidence is metadata-only. Prompt/output bodies and credentials never enter
 * the report.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import {
  runLocalCliAgent,
  cancelExternalCliSession,
  type LocalCliKind,
  type LocalCliRunDependencies,
  type LocalCliStreamEvent,
} from '../electron/localCliRunner.ts'
import { runArgv as productionRunArgv } from '../electron/shellBridge.ts'
import { externalCliSupervisor } from '../electron/externalCliSupervisor.ts'
import { JsonExternalCliCheckpointStore } from '../electron/externalCliCheckpointStore.ts'
import { ExternalCliRunSessionRegistry } from '../src/agent/externalCliRunSession.ts'
import { buildExternalCliRecord } from '../src/agent/externalCliRecord.ts'
import { admitExternalInstructions } from '../src/agent/taskRunCoordinator.ts'
import { instructionDeliveryEvidence, type RecordedInstructionSnapshot } from '../src/agent/instructionSnapshot.ts'
import { redactCliDisplayArgs } from '../src/agent/cliCommandTelemetry.ts'
import { parseClaudeAuthStatus, parseCodexLoginStatus } from '../src/agent/externalCliAuth.ts'
import type { RuntimeOverrides } from '../src/agent/types.ts'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '..')
const evidenceRoot = resolve(repoRoot, '.scratch/external-cli-durable-harness/evidence')
const providers: LocalCliKind[] = ['codex', 'claude']
const QUALIFICATION_TIMEOUT_MS = 120_000
const fixtureMode = process.env.SUBAGENTS_EXTERNAL_CLI_QUALIFICATION_FIXTURE === '1'
const fixtureScenario = process.env.SUBAGENTS_EXTERNAL_CLI_QUALIFICATION_FIXTURE_SCENARIO || 'pass'
const reportEvidenceRoot = fixtureMode
  ? await mkdtemp(join(tmpdir(), 'agentteam-cli-qualification-evidence-'))
  : evidenceRoot
const trace = (message: string) => {
  if (process.env.SUBAGENTS_EXTERNAL_CLI_QUALIFICATION_FIXTURE === '1') console.error(`[qualification-fixture] ${message}`)
}

type QualificationStatus = 'qualified' | 'blocked' | 'failed'
type QualificationCode =
  | 'qualified'
  | 'provider_not_installed'
  | 'auth_unavailable'
  | 'native_discovery_unproven'
  | 'active_checkpoint_unobserved'
  | 'adapter_failed'
type QualificationStage = 'detection' | 'auth' | 'dispatch' | 'restart' | 'record' | 'complete'
type StableDiagnostic = 'auth/login' | 'network' | 'quota' | 'argv-usage' | 'provider-error' | 'unknown'

type FixtureRunGate = {
  entered: Promise<void>
  released: Promise<void>
  signalEntered: () => void
  release: () => void
}

function fixtureRunGate(): FixtureRunGate {
  let signalEntered!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => { signalEntered = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  // The gate is consumed by fixtureDependencies; expose only the settled
  // promises through the callbacks so no fixed timing is involved.
  return { entered, released, signalEntered, release }
}

type ProviderEvidence = {
  provider: LocalCliKind
  status: QualificationStatus
  code: QualificationCode
  installed: boolean
  attempted: boolean
  stage: QualificationStage
  authUsable: boolean
  unqualified: boolean
  /** Kept for consumers of the original report schema. */
  qualification: 'pass' | 'blocked-not-installed' | 'blocked-auth' | 'failed'
  version?: string
  ok?: boolean
  exitCode?: number | null
  diagnostic?: StableDiagnostic
  terminalClassification?: string
  eventCount?: number
  eventKinds?: string[]
  outputBytes?: number
  outputSha256?: string
  markerMatched?: boolean
  nativeDiscoveryMatched?: boolean
  markerCounts?: { expected: number; forbidden: number; qualification: number }
  instructionDelivery?: {
    mode: string
    exactSnapshot: boolean
    effectiveHash: string
    hashAvailable: boolean
    sourceSummary: readonly unknown[]
    limitationReason?: string
  }
  cwd?: string
  /** Safe display argv only; prompt and credential values are replaced. */
  argv?: { command: string; args: string[] }
  checkpointCaptured?: boolean
  restartClassification?: string
  automaticRetry?: boolean
  recordKinds?: string[]
  reason?: { code: QualificationCode; stage: QualificationStage }
}

function binaryFor(provider: LocalCliKind): string | null {
  try {
    return execFileSync('/usr/bin/which', [provider], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

function versionFor(binary: string): string {
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim().split(/\r?\n/, 1)[0].slice(0, 160)
  } catch {
    return 'unknown'
  }
}

/** Presence-only auth probe; secrets never enter qualification evidence. */
function authDetected(provider: LocalCliKind, binary: string): boolean {
  // Use each installed CLI's read-only status command. Presence of a config
  // directory is not proof of a usable login and must not trigger a model run.
  try {
    const args = provider === 'codex' ? ['login', 'status'] : ['auth', 'status']
    const probe = spawnSync(binary, args, {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const statusProbe = {
      status: probe.status,
      stdout: typeof probe.stdout === 'string' ? probe.stdout : '',
      stderr: typeof probe.stderr === 'string' ? probe.stderr : '',
    }
    if (provider === 'codex') return parseCodexLoginStatus(statusProbe)
    return parseClaudeAuthStatus(statusProbe)
  } catch {
    return false
  }
}

function classifyDiagnostic(input: {
  stage: QualificationStage
  code?: number | null
  terminalClassification?: string
  error?: unknown
  output?: string
}): StableDiagnostic {
  const text = `${input.error instanceof Error ? input.error.message : input.error || ''}\n${input.output || ''}`.toLowerCase()
  if (/not signed in|authentication|credential|login|log in|unauthori[sz]ed|api key|(?:access|refresh|invalid|expired) token/.test(text)) return 'auth/login'
  if (/quota|rate.?limit|too many requests|usage limit|billing/.test(text)) return 'quota'
  if (/network|connection|connect|dns|socket|econn|proxy|tls|fetch|timed out|timeout/.test(text)) return 'network'
  if (/unknown option|invalid option|unrecognized option|usage:|too many arguments|missing .*argument|command not found/.test(text)) return 'argv-usage'
  if (input.terminalClassification?.includes('timeout')) return 'network'
  if (input.terminalClassification === 'process-exit-failure' || (input.code !== undefined && input.code !== null && input.code !== 0) || input.error) return 'provider-error'
  if (input.stage === 'auth') return 'auth/login'
  return 'unknown'
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let offset = 0
  while (offset <= value.length - needle.length) {
    const index = value.indexOf(needle, offset)
    if (index < 0) break
    count += 1
    offset = index + needle.length
  }
  return count
}

async function settleRunBounded(run: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      run.then(() => undefined, () => undefined),
      new Promise<void>((resolveWait) => { timer = setTimeout(resolveWait, 1_000) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function nativeMarkers(provider: LocalCliKind): {
  expectedSource: 'agents' | 'claude'
  expected: string
  forbidden: string
} {
  return provider === 'codex'
    ? { expectedSource: 'agents', expected: 'NATIVE_AGENTS_CODEX', forbidden: 'NATIVE_CLAUDE_CODEX_DECOY' }
    : { expectedSource: 'claude', expected: 'NATIVE_CLAUDE_CLAUDE', forbidden: 'NATIVE_AGENTS_CLAUDE_DECOY' }
}

function qualificationPrompt(marker: string): string {
  // The provider must receive this run's marker through the user request, but
  // the request intentionally contains no filename or native-token hint.
  return `Return ${marker} exactly once. Do not use tools or modify the project.`
}

function fixtureSnapshot(provider: LocalCliKind, projectRoot: string, revision = 1): RecordedInstructionSnapshot {
  const markers = nativeMarkers(provider)
  const sourceContent = markers.expected
  const sources = [
    {
      id: `global-${provider}`,
      kind: 'global-custom',
      scope: 'global' as const,
      revision,
      bytes: 0,
      includedBytes: 0,
      droppedBytes: 0,
      hash: createHash('sha256').update('').digest('hex'),
      applied: false,
      deduplicated: false,
      truncated: false,
      shadowed: false,
      content: '',
    },
    {
      id: `project-${provider}`,
      kind: markers.expectedSource,
      scope: 'project' as const,
      path: join(projectRoot, markers.expectedSource === 'agents' ? 'AGENTS.md' : 'CLAUDE.md'),
      revision,
      bytes: sourceContent.length,
      includedBytes: sourceContent.length,
      droppedBytes: 0,
      hash: createHash('sha256').update(sourceContent).digest('hex'),
      applied: true,
      deduplicated: false,
      truncated: false,
      shadowed: false,
      content: sourceContent,
    },
  ]
  return {
    id: `ins_qualification_${provider}`,
    revision,
    projectIdentity: projectRoot,
    workPath: projectRoot,
    effectiveHash: createHash('sha256').update(sourceContent).digest('hex'),
    effectiveText: sourceContent,
    globalEffectiveText: '',
    sources,
    diagnostics: [],
    usage: { personalizationBytes: 0, projectInstructionBytes: sourceContent.length, totalBytes: sourceContent.length, budgetBytes: 4096 },
    deliveryMode: 'native',
    exactSnapshot: false,
  }
}

/** Use the production admission owner, with a shipped Host-shaped bridge. */
async function admitFixtureInstructions(provider: LocalCliKind, projectRoot: string): Promise<{
  overrides: RuntimeOverrides
  restore: () => void
}> {
  const previousWindow = (globalThis as { window?: unknown }).window
  const snapshot = fixtureSnapshot(provider, projectRoot)
  ;(globalThis as { window?: unknown }).window = {
    subagents: {
      piHost: {
        instructions: {
          resolve: async () => ({ instructionSnapshot: snapshot }),
        },
      },
    },
  }
  const overrides = {} as RuntimeOverrides
  await admitExternalInstructions({ runner: provider, projectRoot, overrides, notice: () => {} })
  return {
    overrides,
    restore: () => {
      if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = previousWindow
    },
  }
}

async function waitForActiveCheckpoint(store: JsonExternalCliCheckpointStore, runId: string, signal: AbortSignal) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('checkpoint wait cancelled')
    const record = store.list().find((item) => item.runId === runId && item.active)
    if (record) return record
    await new Promise<void>((resolveWait, rejectWait) => {
      let timer: ReturnType<typeof setTimeout>
      const abort = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        rejectWait(new Error('checkpoint wait cancelled'))
      }
      const finish = () => {
        signal.removeEventListener('abort', abort)
        resolveWait()
      }
      timer = setTimeout(finish, 25)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  throw new Error('active checkpoint was not observed before deadline')
}

function safeRecordEvidence(record: ReturnType<typeof buildExternalCliRecord>) {
  const snapshot = record.entries.find((entry) => entry.kind === 'instruction-snapshot')
  const deliveryEntry = record.entries.find((entry) => entry.kind === 'turn-start')
  if (snapshot?.kind !== 'instruction-snapshot') throw new Error('Turn Record omitted the admitted instruction snapshot')
  const evidence = instructionDeliveryEvidence(snapshot.snapshot)
  assert.equal(evidence.mode, 'native')
  assert.equal(evidence.exactSnapshot, false)
  return {
    mode: evidence.mode,
    exactSnapshot: evidence.exactSnapshot,
    effectiveHash: snapshot.snapshot.effectiveHash,
    hashAvailable: evidence.hashAvailable,
    sourceSummary: evidence.sourceSummary,
    limitationReason: evidence.limitationReason,
    declaredDeliveryMode: deliveryEntry?.kind === 'turn-start' ? deliveryEntry.instructionDelivery?.mode : undefined,
  }
}

type QualificationRun = {
  provider: LocalCliKind
  version: string
  stateRoot: string
  liveStore: JsonExternalCliCheckpointStore
  runId: string
  events: LocalCliStreamEvent[]
  marker: string
  markers: ReturnType<typeof nativeMarkers>
  projectRoot: string
  admitted: Awaited<ReturnType<typeof admitFixtureInstructions>>
  snapshot: NonNullable<RuntimeOverrides['instructionSnapshot']>
  deliveredPrompt: string
  getArgvMeta: () => { command: string; args: string[] } | undefined
  run: ReturnType<typeof runLocalCliAgent>
  fixtureGate?: FixtureRunGate
}

async function startQualificationRun(
  provider: LocalCliKind,
  binary: string,
  dependencies: LocalCliRunDependencies,
  fixtureGate: FixtureRunGate | undefined,
  captureCheckpoint: boolean,
): Promise<QualificationRun> {
  const version = versionFor(binary)
  const stateRoot = await mkdtemp(join(tmpdir(), `agentteam-real-${provider}-`))
  const liveStore = new JsonExternalCliCheckpointStore(join(stateRoot, 'live-checkpoints.json'))
  if (captureCheckpoint) externalCliSupervisor.configurePersistence(liveStore)
  const runId = `real-${provider}-${process.pid}-${randomUUID()}`
  const events: LocalCliStreamEvent[] = []
  const marker = `QUALIFIED_${provider.toUpperCase()}`
  const markers = nativeMarkers(provider)
  const projectRoot = await mkdtemp(join(stateRoot, 'project-'))
  await writeFile(join(projectRoot, 'AGENTS.md'), `Qualification token: ${provider === 'codex' ? markers.expected : markers.forbidden}\n`, 'utf8')
  await writeFile(join(projectRoot, 'CLAUDE.md'), `Qualification token: ${provider === 'claude' ? markers.expected : markers.forbidden}\n`, 'utf8')
  const admitted = await admitFixtureInstructions(provider, projectRoot)
  const snapshot = admitted.overrides.instructionSnapshot
  if (!snapshot) throw new Error('external instruction admission did not freeze a snapshot')
  const deliveredPrompt = [admitted.overrides.extraSystemContext, qualificationPrompt(marker)].filter(Boolean).join('\n\n')
  assert.doesNotMatch(deliveredPrompt, /AGENTS\.md|CLAUDE\.md|read|inspect files/i)
  assert.equal(deliveredPrompt.includes(markers.expected), false, 'delivered prompt must not contain the native expected token')
  assert.equal(deliveredPrompt.includes(markers.forbidden), false, 'delivered prompt must not contain the forbidden native token')
  let argvMeta: { command: string; args: string[] } | undefined
  const run = runLocalCliAgent({
    kind: provider,
    binary,
    prompt: deliveredPrompt,
    cwd: projectRoot,
    depth: 'fast',
    agentMode: dependencies.runArgv ? 'build' : 'plan',
    approvalMode: 'always',
    unattended: true,
    runId,
    conversationId: `qualification-${provider}`,
    externalCliPolicy: { idleMs: 60_000, absoluteMs: QUALIFICATION_TIMEOUT_MS, operationMs: 60_000 },
    onStream: (event) => events.push(event),
  }, {
    ...dependencies,
    runArgv: async (input) => {
      argvMeta = { command: input.file, args: redactCliDisplayArgs(input.args, deliveredPrompt) }
      return dependencies.runArgv ? dependencies.runArgv(input) : productionRunArgv(input)
    },
  })
  return { provider, version, stateRoot, liveStore, runId, events, marker, markers, projectRoot, admitted, snapshot, deliveredPrompt, getArgvMeta: () => argvMeta, run, fixtureGate }
}

type QualificationOutcome =
  | { kind: 'active'; record: ReturnType<JsonExternalCliCheckpointStore['list']>[number] }
  | { kind: 'settled'; result: Awaited<ReturnType<typeof runLocalCliAgent>> }
  | { kind: 'run-error'; error: unknown }
  | { kind: 'checkpoint-error'; error: unknown }

async function waitForQualificationOutcome(execution: QualificationRun): Promise<QualificationOutcome> {
  const controller = new AbortController()
  const checkpoint = waitForActiveCheckpoint(execution.liveStore, execution.runId, controller.signal)
    .then((record) => ({ kind: 'active' as const, record }))
    .catch((error) => ({ kind: 'checkpoint-error' as const, error }))
  const settled = execution.run
    .then((result) => ({ kind: 'settled' as const, result }))
    .catch((error) => ({ kind: 'run-error' as const, error }))
  const first = await Promise.race([checkpoint, settled])
  controller.abort()
  return first
}

async function failedQualification(execution: QualificationRun, first: Exclude<QualificationOutcome, { kind: 'active' }>): Promise<ProviderEvidence> {
  execution.fixtureGate?.release()
  try { await cancelExternalCliSession(execution.runId) } catch { /* best effort */ }
  await settleRunBounded(execution.run)
  const lastCheckpoint = execution.liveStore.list().find((item) => item.runId === execution.runId)
  const diagnostic = first.kind === 'settled'
    ? classifyDiagnostic({ stage: 'dispatch', code: first.result.code, terminalClassification: first.result.terminalClassification, error: first.result.error, output: first.result.output })
    : classifyDiagnostic({ stage: 'dispatch', error: first.error })
  const authBlocked = diagnostic === 'auth/login'
  const code: QualificationCode = authBlocked ? 'auth_unavailable' : 'active_checkpoint_unobserved'
  return {
    provider: execution.provider,
    status: authBlocked ? 'blocked' : 'failed',
    code,
    installed: true,
    attempted: true,
    stage: 'dispatch',
    authUsable: !authBlocked,
    unqualified: true,
    qualification: authBlocked ? 'blocked-auth' : 'failed',
    exitCode: first.kind === 'settled' ? first.result.code : null,
    diagnostic,
    version: execution.version,
    checkpointCaptured: lastCheckpoint?.active === true,
    restartClassification: lastCheckpoint?.terminal?.classification,
    reason: { code, stage: 'dispatch' },
  }
}

async function completedQualification(execution: QualificationRun, active: QualificationOutcome & { kind: 'active' }): Promise<ProviderEvidence> {
  trace(`${execution.runId}: checkpoint:active`)
  execution.fixtureGate?.release()
  const restartStore = new JsonExternalCliCheckpointStore(join(execution.stateRoot, 'restart-checkpoints.json'))
  restartStore.save(active.record)
  const result = await execution.run
  const restarted = new ExternalCliRunSessionRegistry({ checkpointStore: restartStore })
  const recovery = restarted.recoverPersistedSessions('qualification Host restart')
  const recovered = recovery.find((item) => item.runId === execution.runId)
  assert.ok(recovered?.recovery, 'fresh registry must project the captured live checkpoint as interrupted')
  assert.equal(recovered.recovery.automaticRetry, false, 'external CLI restart never retries without replay-safe evidence')
  const record = buildExternalCliRecord({
    runner: execution.provider,
    prompt: execution.deliveredPrompt,
    events: execution.events,
    answer: result.output,
    settlement: result.ok ? 'success' : 'failed',
    instructionSnapshot: execution.snapshot,
  })
  const recordKinds = [...new Set(record.entries.map((entry) => entry.kind))]
  assert.ok(recordKinds.includes('turn-start') && recordKinds.includes('turn-end'))
  assert.equal(record.entries.find((entry) => entry.kind === 'turn-start')?.source, 'host')
  assert.equal(record.entries.find((entry) => entry.kind === 'user-text')?.source, 'user')
  const instructionDelivery = safeRecordEvidence(record)
  return buildQualificationEvidence(execution, result, instructionDelivery, recovered, recordKinds)
}

function buildQualificationEvidence(
  execution: QualificationRun,
  result: Awaited<ReturnType<typeof runLocalCliAgent>>,
  instructionDelivery: NonNullable<ProviderEvidence['instructionDelivery']>,
  recovered: { terminal?: { classification?: string }; recovery: { automaticRetry: boolean } },
  recordKinds: string[],
): ProviderEvidence {
  const output = Buffer.from(result.output, 'utf8')
  const markers = execution.markers
  const expectedCount = countOccurrences(result.output, markers.expected)
  const forbiddenCount = countOccurrences(result.output, markers.forbidden)
  const qualificationCount = countOccurrences(result.output, execution.marker)
  const markerMatched = qualificationCount === 1
  const nativeDiscoveryMatched = expectedCount === 1 && forbiddenCount === 0
  const diagnostic = classifyDiagnostic({ stage: 'complete', code: result.code, terminalClassification: result.terminalClassification, error: result.error, output: result.output })
  const authBlocked = diagnostic === 'auth/login'
  const passed = result.ok && markerMatched && nativeDiscoveryMatched
  const failedForNative = result.ok && !nativeDiscoveryMatched
  const runner = execution.provider
  return {
    provider: runner,
    status: passed ? 'qualified' : authBlocked ? 'blocked' : 'failed',
    code: passed ? 'qualified' : authBlocked ? 'auth_unavailable' : failedForNative ? 'native_discovery_unproven' : 'adapter_failed',
    installed: true,
    attempted: true,
    stage: 'complete',
    authUsable: !authBlocked,
    unqualified: !passed,
    qualification: passed ? 'pass' : authBlocked ? 'blocked-auth' : 'failed',
    version: execution.version,
    ok: result.ok,
    exitCode: result.code,
    diagnostic,
    terminalClassification: result.terminalClassification,
    eventCount: execution.events.length,
    eventKinds: [...new Set(execution.events.map((event) => event.kind))],
    outputBytes: output.length,
    outputSha256: createHash('sha256').update(output).digest('hex'),
    markerMatched,
    nativeDiscoveryMatched,
    markerCounts: { expected: expectedCount, forbidden: forbiddenCount, qualification: qualificationCount },
    instructionDelivery,
    cwd: execution.projectRoot,
    argv: execution.getArgvMeta(),
    checkpointCaptured: true,
    restartClassification: recovered.terminal?.classification,
    automaticRetry: recovered.recovery.automaticRetry,
    recordKinds,
    ...(passed ? {} : { reason: { code: authBlocked ? 'auth_unavailable' : failedForNative ? 'native_discovery_unproven' : 'adapter_failed', stage: 'record' as const } }),
  }
}

async function qualify(
  provider: LocalCliKind,
  binary: string,
  dependencies: LocalCliRunDependencies = {},
  fixtureGate?: FixtureRunGate,
  captureCheckpoint = true,
): Promise<ProviderEvidence> {
  trace(`${provider}: qualify:start`)
  const execution = await startQualificationRun(provider, binary, dependencies, fixtureGate, captureCheckpoint)
  trace(`${provider}: adapter:started`)
  try {
    const outcome = await waitForQualificationOutcome(execution)
    if (outcome.kind !== 'active') return await failedQualification(execution, outcome)
    return await completedQualification(execution, outcome)
  } finally {
    execution.admitted.restore()
    await rm(execution.stateRoot, { recursive: true, force: true })
  }
}

function fixtureDependencies(provider: LocalCliKind, scenario: string, gate?: FixtureRunGate): LocalCliRunDependencies {
  return {
    runArgv: async (input) => {
      assert.equal(input.cwd && existsSync(input.cwd), true)
      const prompt = input.args.at(-1) || ''
      assert.doesNotMatch(prompt, /AGENTS\.md|CLAUDE\.md|read|inspect files/i)
      const nativeFile = join(input.cwd!, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md')
      const nativeBody = readFileSync(nativeFile, 'utf8')
      const expected = nativeBody.match(/Qualification token:\s*(\S+)/)?.[1]
      const qualification = prompt.match(/\bQUALIFIED_[A-Z]+\b/)?.[0]
      assert.ok(expected, 'fixture native source contains an expected token')
      assert.ok(qualification, 'fixture prompt contains the qualification marker')
      assert.equal(prompt.includes(expected), false, 'delivered prompt must not contain the native expected token')
      assert.equal(prompt.includes(provider === 'codex' ? 'NATIVE_CLAUDE_CODEX_DECOY' : 'NATIVE_AGENTS_CLAUDE_DECOY'), false, 'delivered prompt must not contain the forbidden native token')
      if (scenario === 'reject-runargv') throw new Error('fixture runArgv rejected')
      input.onStarted?.('fixture-process')
      const output = scenario === 'native-failure'
        ? `${qualification}\n`
        : `${expected}\n${qualification}\n`
      input.onStdout?.(output)
      gate?.signalEntered()
      if (gate) await gate.released
      return { ok: true, code: 0, stdout: output, stderr: '' }
    },
  }
}

const evidence: ProviderEvidence[] = []
for (const provider of providers) {
  const binary = fixtureMode
    ? fixtureScenario === 'blocked-not-installed' ? null : '/usr/bin/true'
    : binaryFor(provider)
  if (!binary) {
    evidence.push({ provider, status: 'blocked', code: 'provider_not_installed', installed: false, attempted: false, stage: 'detection', authUsable: false, unqualified: true, qualification: 'blocked-not-installed', exitCode: null, diagnostic: 'unknown', reason: { code: 'provider_not_installed', stage: 'detection' } })
    continue
  }
  const authUsable = fixtureMode ? fixtureScenario !== 'blocked-auth' : authDetected(provider, binary)
  if (!authUsable) {
    evidence.push({ provider, status: 'blocked', code: 'auth_unavailable', installed: true, attempted: false, stage: 'auth', authUsable: false, unqualified: true, qualification: 'blocked-auth', version: versionFor(binary), exitCode: null, diagnostic: 'auth/login', reason: { code: 'auth_unavailable', stage: 'auth' } })
    continue
  }
  try {
    const gate = fixtureMode && !['fast-settle', 'reject-runargv'].includes(fixtureScenario) ? fixtureRunGate() : undefined
    const dependencies = fixtureMode ? fixtureDependencies(provider, fixtureScenario, gate) : {}
    const qualification = qualify(provider, binary, dependencies, gate, !['fast-settle', 'reject-runargv'].includes(fixtureScenario))
    if (gate) {
      await Promise.race([
        gate.entered,
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 10_000)),
      ])
    }
    evidence.push(await qualification)
  } catch (error) {
    const diagnostic = classifyDiagnostic({ stage: 'dispatch', error })
    const authBlocked = diagnostic === 'auth/login'
    const code: QualificationCode = authBlocked ? 'auth_unavailable' : 'adapter_failed'
    evidence.push({ provider, status: authBlocked ? 'blocked' : 'failed', code, installed: true, attempted: true, stage: 'dispatch', authUsable: !authBlocked, unqualified: true, qualification: authBlocked ? 'blocked-auth' : 'failed', version: versionFor(binary), exitCode: null, diagnostic, reason: { code, stage: 'dispatch' } })
  }
}

const qualifiedAt = new Date().toISOString()
const report = { schemaVersion: 2, qualificationMode: fixtureMode ? 'fixture' : 'real', evidenceRoot: reportEvidenceRoot, qualifiedAt, platform: process.platform, architecture: process.arch, providers: evidence }
await mkdir(reportEvidenceRoot, { recursive: true })
await writeFile(join(reportEvidenceRoot, 'real-cli-qualification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const lines = [
  '# External CLI real-machine qualification',
  '',
  `Qualified: ${qualifiedAt}`,
  `Machine: ${process.platform}/${process.arch}`,
  '',
  '| Provider | Status | Code | Installed | Attempted | Auth usable | Diagnostic | Exit code | Native proof | Checkpoint | Restart | Record |',
  '|---|---|---|---:|---:|---:|---|---:|---|---:|---|---|',
  ...evidence.map((item) => `| ${item.provider} | ${item.status} | ${item.code} | ${item.installed ? 'yes' : 'no'} | ${item.attempted ? 'yes' : 'no'} | ${item.authUsable ? 'yes' : 'no'} | ${item.diagnostic || '-'} | ${item.exitCode ?? '-'} | ${item.nativeDiscoveryMatched ? 'yes' : 'no'} | ${item.checkpointCaptured ? 'yes' : '-'} | ${item.restartClassification || '-'} | ${item.recordKinds?.join(', ') || '-'} |`),
  '',
  'The report stores only status/code, provider metadata, safe argv display values, cwd, lifecycle classifications, record metadata, byte counts, hashes, and source summaries. Prompt/output bodies and credentials are excluded.',
  '',
  ...evidence.filter((item) => item.reason).map((item) => `- ${item.provider}: ${item.reason?.code} (${item.reason?.stage})`),
]
await writeFile(join(reportEvidenceRoot, 'real-cli-qualification.md'), `${lines.join('\n')}\n`, 'utf8')

console.log(JSON.stringify(report, null, 2))
const failedInstalled = evidence.filter((item) => item.installed && item.authUsable && item.status === 'failed')
if (failedInstalled.length) process.exitCode = 1
