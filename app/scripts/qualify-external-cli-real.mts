/**
 * Real-machine External CLI qualification.
 *
 * Runs every installed shipped adapter through runLocalCliAgent, captures an
 * active durable checkpoint before completion, reloads that exact checkpoint
 * into a fresh registry, and verifies the external Turn Record contract.
 * Evidence stores metadata only: never prompt/output bodies or credentials.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { runLocalCliAgent, type LocalCliKind, type LocalCliStreamEvent } from '../electron/localCliRunner.ts'
import { externalCliSupervisor } from '../electron/externalCliSupervisor.ts'
import { JsonExternalCliCheckpointStore } from '../electron/externalCliCheckpointStore.ts'
import { ExternalCliRunSessionRegistry } from '../src/agent/externalCliRunSession.ts'
import { buildExternalCliRecord } from '../src/agent/externalCliRecord.ts'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '..')
const evidenceRoot = resolve(repoRoot, '.scratch/external-cli-durable-harness/evidence')
const providers: LocalCliKind[] = ['codex', 'claude', 'grok', 'gemini', 'cursor']

function binaryFor(provider: LocalCliKind): string | null {
  const command = provider === 'cursor' ? 'cursor-agent' : provider
  try {
    return execFileSync('/usr/bin/which', [command], { encoding: 'utf8' }).trim() || null
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

async function waitForActiveCheckpoint(store: JsonExternalCliCheckpointStore, runId: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const record = store.list().find((item) => item.runId === runId && item.active)
    if (record) return record
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error('active checkpoint was not observed before deadline')
}

type ProviderEvidence = {
  provider: LocalCliKind
  installed: boolean
  qualification?: 'pass' | 'blocked-auth' | 'failed'
  version?: string
  ok?: boolean
  terminalClassification?: string
  eventCount?: number
  eventKinds?: string[]
  outputBytes?: number
  outputSha256?: string
  markerMatched?: boolean
  checkpointCaptured?: boolean
  restartClassification?: string
  automaticRetry?: boolean
  recordKinds?: string[]
  error?: string
}

async function qualify(provider: LocalCliKind, binary: string): Promise<ProviderEvidence> {
  const version = versionFor(binary)
  const stateRoot = await mkdtemp(join(tmpdir(), `agentteam-real-${provider}-`))
  const liveStore = new JsonExternalCliCheckpointStore(join(stateRoot, 'live-checkpoints.json'))
  externalCliSupervisor.configurePersistence(liveStore)
  const runId = `real-${provider}-${Date.now().toString(36)}`
  const conversationId = `qualification-${provider}`
  const events: LocalCliStreamEvent[] = []
  const marker = `QUALIFIED_${provider.toUpperCase().replaceAll('-', '_')}`
  const run = runLocalCliAgent({
    kind: provider,
    binary,
    prompt: `Reply with exactly ${marker}. Do not use tools and do not modify files.`,
    cwd: repoRoot,
    depth: 'fast',
    agentMode: 'build',
    approvalMode: 'always',
    unattended: true,
    runId,
    conversationId,
    externalCliPolicy: { idleMs: 60_000, absoluteMs: 120_000, operationMs: 60_000 },
    onStream: (event) => events.push(event),
  })

  const active = await waitForActiveCheckpoint(liveStore, runId)
  const restartStore = new JsonExternalCliCheckpointStore(join(stateRoot, 'restart-checkpoints.json'))
  restartStore.save(active)
  const result = await run
  const restarted = new ExternalCliRunSessionRegistry({ checkpointStore: restartStore })
  const recovery = restarted.recoverPersistedSessions('qualification Host restart')
  const recovered = recovery.find((item) => item.runId === runId)
  assert.ok(recovered?.recovery, 'fresh registry must project the captured live checkpoint as interrupted')
  assert.equal(recovered.recovery.automaticRetry, false, 'external CLI restart never retries without replay-safe evidence')

  const record = buildExternalCliRecord({
    runner: provider,
    prompt: `qualification:${provider}`,
    events,
    answer: result.output,
    settlement: result.ok ? 'success' : 'failed',
  })
  const recordKinds = [...new Set(record.entries.map((entry) => entry.kind))]
  assert.ok(recordKinds.includes('turn-start') && recordKinds.includes('turn-end'))
  assert.equal(record.entries.find((entry) => entry.kind === 'turn-start')?.source, 'host')
  assert.equal(record.entries.find((entry) => entry.kind === 'user-text')?.source, 'user')

  const output = Buffer.from(result.output, 'utf8')
  const markerMatched = result.output.trim().includes(marker)
  const authBlocked = !result.ok && /not signed in|auth(?:entication)? credentials|re-authentication|required.*login/i.test(`${result.output}\n${result.error || ''}`)
  const passed = result.ok && markerMatched
  return {
    provider,
    installed: true,
    version,
    ok: result.ok,
    qualification: passed ? 'pass' : authBlocked ? 'blocked-auth' : 'failed',
    terminalClassification: result.terminalClassification,
    eventCount: events.length,
    eventKinds: [...new Set(events.map((event) => event.kind))],
    outputBytes: output.length,
    outputSha256: createHash('sha256').update(output).digest('hex'),
    markerMatched,
    checkpointCaptured: true,
    restartClassification: recovered.terminal?.classification,
    automaticRetry: recovered.recovery.automaticRetry,
    recordKinds,
    ...(passed ? {} : {
      error: authBlocked
        ? 'Provider CLI authentication is unavailable on this machine.'
        : markerMatched
          ? result.error || `exit ${result.code}`
          : 'Provider completed without returning the qualification marker.',
    }),
  }
}

const evidence: ProviderEvidence[] = []
for (const provider of providers) {
  const binary = binaryFor(provider)
  if (!binary) {
    evidence.push({ provider, installed: false })
    continue
  }
  try {
    evidence.push(await qualify(provider, binary))
  } catch (error) {
    evidence.push({
      provider,
      installed: true,
      version: versionFor(binary),
      ok: false,
      qualification: 'failed',
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    })
  }
}

const qualifiedAt = new Date().toISOString()
const report = {
  schemaVersion: 1,
  qualifiedAt,
  platform: process.platform,
  architecture: process.arch,
  providers: evidence,
}
await mkdir(evidenceRoot, { recursive: true })
await writeFile(join(evidenceRoot, 'real-cli-qualification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const lines = [
  '# External CLI real-machine qualification',
  '',
  `Qualified: ${qualifiedAt}`,
  `Machine: ${process.platform}/${process.arch}`,
  '',
  '| Provider | Installed | Execution | Terminal | Active checkpoint | Restart projection | Record |',
  '|---|---:|---|---|---:|---|---|',
  ...evidence.map((item) => `| ${item.provider} | ${item.installed ? 'yes' : 'no'} | ${item.installed ? (item.qualification || 'failed') : 'not installed'} | ${item.terminalClassification || '-'} | ${item.checkpointCaptured ? 'yes' : '-'} | ${item.restartClassification || '-'} | ${item.recordKinds?.join(', ') || '-'} |`),
  '',
  'The report stores only version, lifecycle classifications, event kinds, byte counts, and output hashes. Prompt/output bodies and credentials are excluded.',
  '',
  ...evidence.filter((item) => item.error).map((item) => `- ${item.provider}: ${item.error}`),
]
await writeFile(join(evidenceRoot, 'real-cli-qualification.md'), `${lines.join('\n')}\n`, 'utf8')

const failedInstalled = evidence.filter((item) => item.installed && item.qualification === 'failed')
console.log(JSON.stringify(report, null, 2))
if (failedInstalled.length) process.exitCode = 1
