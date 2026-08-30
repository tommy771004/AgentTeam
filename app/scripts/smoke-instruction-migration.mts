import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  createPiHostServer,
  type PiHostMessage,
  type PiHostResponse,
} from '../electron/piHostProtocol.ts'
import {
  InMemoryInstructionRepository,
  InstructionRepositoryError,
  SqliteInstructionRepository,
  UnavailableInstructionRepository,
} from '../electron/instructionRepository.ts'
import { LEGACY_DEFAULT_AGENTS, LEGACY_DEFAULT_SOUL } from '../src/agent/legacyInstructionDefaults.ts'

const migrationInput = {
  personality: 'candid',
  aboutUser: 'MIGRATED_ABOUT_USER',
  responseStyle: 'MIGRATED_RESPONSE_STYLE',
  soul: 'MIGRATED_SOUL_INSTRUCTIONS',
  agents: 'MIGRATED_INTERNAL_AGENTS_INSTRUCTIONS',
} as const

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

async function publicRequest(
  host: { handle(input: unknown): Promise<void> },
  messages: PiHostMessage[],
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<PiHostResponse> {
  await host.handle({ id, method, params })
  const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
  if (!response) throw new Error(`Host did not answer ${method}`)
  return response
}

async function assertPresenceSemantics(): Promise<void> {
  const absent = new InMemoryInstructionRepository()
  const absentResult = await absent.migrateLegacy({})
  assert.equal(hasOwn(absentResult.report.backup, 'soul'), false)
  assert.equal(hasOwn(absentResult.report.backup, 'agents'), false)
  assert.equal(hasOwn(absentResult.report.backup, 'personality'), false)
  assert.equal(absentResult.instructions.globalCustomInstructions, '')
  assert.equal(absentResult.instructions.advancedPersonalityInstructions, '')
  assert.equal(absentResult.instructions.globalCustomInstructionsPresence, 'unset')
  assert.equal(absentResult.instructions.advancedPersonalityInstructionsPresence, 'unset')
  assert.deepEqual(absentResult.report.presence, { soul: 'unset', agents: 'unset' })

  const blank = new InMemoryInstructionRepository()
  const blankResult = await blank.migrateLegacy({ soul: '', agents: '', personality: '', aboutUser: '', responseStyle: '' })
  for (const field of ['soul', 'agents', 'personality', 'aboutUser', 'responseStyle']) {
    assert.equal(hasOwn(blankResult.report.backup, field), true, `explicit blank ${field} remains present in backup`)
  }
  assert.equal(blankResult.instructions.advancedPersonalityInstructions, '')
  assert.equal(blankResult.instructions.globalCustomInstructions, '')
  assert.equal(blankResult.instructions.personality, '')
  assert.equal(blankResult.instructions.aboutUser, '')
  assert.equal(blankResult.instructions.responseStyle, '')
  assert.equal(blankResult.instructions.globalCustomInstructionsPresence, 'blank')
  assert.equal(blankResult.instructions.advancedPersonalityInstructionsPresence, 'blank')
  assert.deepEqual(blankResult.report.presence, { soul: 'blank', agents: 'blank' })
  assert.notDeepEqual(
    {
      global: absentResult.instructions.globalCustomInstructionsPresence,
      advanced: absentResult.instructions.advancedPersonalityInstructionsPresence,
    },
    {
      global: blankResult.instructions.globalCustomInstructionsPresence,
      advanced: blankResult.instructions.advancedPersonalityInstructionsPresence,
    },
    'unset and explicit blank remain distinct in the live migration snapshot',
  )
  assert.notEqual(absentResult.report.sourceHash, blankResult.report.sourceHash)

  const nonblank = new InMemoryInstructionRepository()
  const nonblankResult = await nonblank.migrateLegacy(migrationInput)
  assert.equal(nonblankResult.instructions.advancedPersonalityInstructions, migrationInput.soul)
  assert.equal(nonblankResult.instructions.globalCustomInstructions, migrationInput.agents)
  assert.equal(nonblankResult.instructions.personality, migrationInput.personality)
  assert.equal(nonblankResult.instructions.aboutUser, migrationInput.aboutUser)
  assert.equal(nonblankResult.instructions.responseStyle, migrationInput.responseStyle)
  assert.equal(nonblankResult.report.backup.soul, migrationInput.soul)
  assert.equal(nonblankResult.report.backup.agents, migrationInput.agents)
  assert.equal(nonblankResult.instructions.globalCustomInstructionsPresence, 'value')
  assert.equal(nonblankResult.instructions.advancedPersonalityInstructionsPresence, 'value')
  assert.deepEqual(nonblankResult.report.presence, { soul: 'value', agents: 'value' })
}

async function assertAdmissionReadiness(): Promise<void> {
  const { admitLegacyInstructionMigration } = await import('../src/agent/taskRunCoordinator.ts')
  let retries = 0
  let migrations = 0
  const outcome = await admitLegacyInstructionMigration({
    currentRevision: 0,
    readiness: { status: 'failed', error: 'synthetic Hermes read failure' },
    retry: async () => { retries += 1; return { status: 'ready' as const } },
    getMigrationInput: () => ({}),
    migrate: async (input) => { migrations += 1; assert.deepEqual(input, {}) },
  })
  assert.equal(outcome, 'migrated')
  assert.equal(retries, 1)
  assert.equal(migrations, 1)

  let blockedMigrations = 0
  await assert.rejects(
    admitLegacyInstructionMigration({
      currentRevision: 0,
      readiness: { status: 'failed', error: 'still unavailable' },
      retry: async () => ({ status: 'failed' as const, error: 'still unavailable' }),
      getMigrationInput: () => ({}),
      migrate: async () => { blockedMigrations += 1 },
    }),
    /保留 pending/,
  )
  assert.equal(blockedMigrations, 0, 'failed admission must not publish an empty migration marker')
  const knownAbsent = await admitLegacyInstructionMigration({
    currentRevision: 0,
    readiness: { status: 'ready' as const },
    retry: async () => ({ status: 'ready' as const }),
    getMigrationInput: () => ({}),
    migrate: async () => { migrations += 1 },
  })
  assert.equal(knownAbsent, 'migrated')
  assert.equal(migrations, 2, 'known-absent authoritative hydration may commit exactly once')
}

async function assertHostSkipsLegacyWhenNewerStateExists(): Promise<void> {
  const newerMessages: PiHostMessage[] = []
  const newerRepo = new InMemoryInstructionRepository()
  const newerHost = createPiHostServer((message) => newerMessages.push(message), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, newerRepo)
  await publicRequest(newerHost, newerMessages, 1, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })
  const newerSave = await publicRequest(newerHost, newerMessages, 2, 'instructions/v1/save', { expectedRevision: 0, globalCustomInstructions: 'HOST_NEWER_REVISION' })
  assert.equal(newerSave.result?.instructions?.revision, 1)
  const skipped = await publicRequest(newerHost, newerMessages, 3, 'instructions/v1/migrate-legacy', migrationInput)
  assert.equal(skipped.result?.instructionMigrationReport?.status, 'skipped_existing')
  assert.equal(skipped.result?.instructions?.globalCustomInstructions, 'HOST_NEWER_REVISION')
  assert.equal(newerMessages.some((message) => 'event' in message && message.event === 'instruction/changed' && message.payload?.operation === 'migration'), false)
}

async function assertHostMigrationFailureStaysUnpublished(): Promise<void> {
  const failureMessages: PiHostMessage[] = []
  const failureHost = createPiHostServer(
    (message) => failureMessages.push(message),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new UnavailableInstructionRepository(new InstructionRepositoryError('io_error', 'synthetic migration failure')),
  )
  await publicRequest(failureHost, failureMessages, 10, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })
  const failure = await publicRequest(failureHost, failureMessages, 11, 'instructions/v1/migrate-legacy', migrationInput)
  assert.equal(failure.error?.code, 'io_error')
  assert.equal(failureMessages.some((message) => 'event' in message && message.event === 'instruction/changed'), false)
}

async function assertHostUnsetProjection(host: ReturnType<typeof createPiHostServer>, messages: PiHostMessage[]): Promise<void> {
  const unsetProjection = await publicRequest(host, messages, 13, 'instructions/v1/resolve')
  assert.equal(unsetProjection.result?.instructionSnapshot?.presence?.advancedPersonalityInstructions, 'unset')
  assert.equal(unsetProjection.result?.instructionSnapshot?.presence?.globalCustomInstructions, 'unset')
  const unsetText = unsetProjection.result?.instructionSnapshot?.effectiveText || ''
  assert.equal(unsetText.includes(LEGACY_DEFAULT_SOUL), false)
  assert.equal(unsetText.includes(LEGACY_DEFAULT_AGENTS), false)
}

async function assertHostBlankPresenceSemantics(): Promise<void> {
  const blankMessages: PiHostMessage[] = []
  const blankHost = createPiHostServer((message) => blankMessages.push(message), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new InMemoryInstructionRepository())
  await publicRequest(blankHost, blankMessages, 12, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })
  await assertHostUnsetProjection(blankHost, blankMessages)
  const blankHostMigration = await publicRequest(blankHost, blankMessages, 14, 'instructions/v1/migrate-legacy', { soul: '', agents: '' })
  assert.equal(blankHostMigration.result?.instructions?.advancedPersonalityInstructionsPresence, 'blank')
  assert.equal(blankHostMigration.result?.instructions?.globalCustomInstructionsPresence, 'blank')
  const blankProjection = await publicRequest(blankHost, blankMessages, 15, 'instructions/v1/resolve')
  assert.equal(blankProjection.result?.instructionSnapshot?.presence?.advancedPersonalityInstructions, 'blank')
  assert.equal(blankProjection.result?.instructionSnapshot?.presence?.globalCustomInstructions, 'blank')
  const blankText = blankProjection.result?.instructionSnapshot?.effectiveText || ''
  assert.equal(blankText.includes(LEGACY_DEFAULT_SOUL), true)
  assert.equal(blankText.includes(LEGACY_DEFAULT_AGENTS), true)
}

async function assertSqliteMigrationRollback(): Promise<void> {
  const faultDir = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-migration-fault-'))
  const faultPath = join(faultDir, 'instructions.sqlite')
  const faultRepo = await SqliteInstructionRepository.open(faultPath)
  const faultDb = new DatabaseSync(faultPath)
  faultDb.exec(`CREATE TRIGGER migration_fault BEFORE INSERT ON instruction_migrations
    BEGIN SELECT RAISE(ABORT, 'synthetic migration transaction fault'); END`)
  await assert.rejects(
    faultRepo.migrateLegacy(migrationInput),
    (error: unknown) => error instanceof InstructionRepositoryError && error.code === 'migration_failed',
  )
  const rolledBack = await faultRepo.read()
  assert.equal(rolledBack.revision, 0, 'migration fault must roll back live instruction state')
  faultDb.close()
  await faultRepo.close()
  const faultRestart = await SqliteInstructionRepository.open(faultPath)
  assert.equal((await faultRestart.read()).revision, 0, 'restart must not observe partial migration state')
  const faultCheck = new DatabaseSync(faultPath)
  assert.equal((faultCheck.prepare('SELECT COUNT(*) AS count FROM instruction_migrations').get() as { count: number }).count, 0)
  faultCheck.close()
  await faultRestart.close()
  await rm(faultDir, { recursive: true, force: true })
}

async function assertHostBoundaries(): Promise<void> {
  await assertHostSkipsLegacyWhenNewerStateExists()
  await assertHostMigrationFailureStaysUnpublished()
  await assertHostBlankPresenceSemantics()
  await assertSqliteMigrationRollback()
}

type ModelRequest = { messages?: Array<{ role?: string; content?: unknown }> }
type HostProcess = {
  child: ChildProcess
  messages: Array<Record<string, any>>
  send: (id: number, method: string, params?: Record<string, unknown>) => void
  waitFor: (predicate: (message: Record<string, any>) => boolean) => Promise<Record<string, any>>
}

const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))

async function assertRealHostRun(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-migration-'))
  const agentDir = join(root, 'agent')
  const stateDir = join(root, 'state')
  const projectDir = join(root, 'project')
  const requests: ModelRequest[] = []
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(stateDir, { recursive: true }), mkdir(projectDir, { recursive: true })])
  const modelServer = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') { response.writeHead(404).end(); return }
    let body = ''
    for await (const chunk of request) body += String(chunk)
    requests.push(JSON.parse(body) as ModelRequest)
    const answer = 'migration-run-answer'
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
    response.write(`data: ${JSON.stringify({ id: answer, model: 'migration-model', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id: answer, model: 'migration-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
  const address = modelServer.address()
  if (!address || typeof address === 'string') throw new Error('migration model server did not bind')
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'migration-key',
    models: [{ id: 'migration-model', name: 'Migration Model', reasoning: false, input: ['text'], contextWindow: 4096, maxTokens: 256 }],
  } } }))
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'migration-key' } }))
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'migration-model', defaultThinkingLevel: 'off' }))
  await writeFile(join(projectDir, 'AGENTS.md'), 'PROJECT_MIGRATION_CONTEXT')

  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir, SUBAGENTS_INSTRUCTION_DB_PATH: join(stateDir, 'instructions.sqlite') },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const output = createInterface({ input: child.stdout })
  const messages: Array<Record<string, any>> = []
  output.on('line', (line) => { try { messages.push(JSON.parse(line) as Record<string, any>) } catch { /* diagnostics stay on stderr */ } })
  const host: HostProcess = {
    child,
    messages,
    send: (id, method, params = {}) => child.stdin.write(`${JSON.stringify({ id, method, params })}\n`),
    waitFor: async (predicate) => {
      const deadline = Date.now() + 20_000
      for (;;) {
        const current = messages.find(predicate)
        if (current) return current
        if (child.exitCode !== null) throw new Error(`Pi Host exited before response: ${child.exitCode}`)
        if (Date.now() >= deadline) throw new Error('timed out waiting for migration Host response')
        await delay(25)
      }
    },
  }
  const close = async () => {
    if (child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([once(child, 'exit'), delay(3_000)])
    if (child.exitCode === null) child.kill('SIGTERM')
    if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(1_000)])
  }
  try {
    host.send(20, 'initialize', { protocolVersion: 5, capabilities: ['instructions-v1'] })
    await host.waitFor((message) => message.id === 20)
    host.send(21, 'sessions/create', { title: 'Migrated instruction run' })
    const session = await host.waitFor((message) => message.id === 21)
    const sessionId = String(session.result.sessionId)
    host.send(22, 'instructions/v1/migrate-legacy', migrationInput)
    const migrated = await host.waitFor((message) => message.id === 22)
    assert.equal(migrated.error, undefined)
    assert.equal(migrated.result.instructionMigrationReport.status, 'migrated')
    assert.equal(migrated.result.instructions.advancedPersonalityInstructions, migrationInput.soul)
    assert.equal(migrated.result.instructions.globalCustomInstructions, migrationInput.agents)
    const migrationEvent = await host.waitFor((message) => message.event === 'instruction/changed' && message.payload?.operation === 'migration')
    assert.ok(migrationEvent.payload.revision >= migrated.result.instructions.revision)
    host.send(24, 'instructions/v1/resolve', { projectRoot: projectDir, workPath: projectDir })
    const projection = await host.waitFor((message) => message.id === 24)
    assert.ok(projection.result.instructionSnapshot.effectiveText.includes(migrationInput.soul))
    assert.ok(projection.result.instructionSnapshot.effectiveText.includes(migrationInput.agents))
    assert.ok(projection.result.instructionSnapshot.sources.some((source: { kind?: string; content?: string }) => source.kind === 'global-custom' && source.content === migrationInput.agents))
    assert.ok(projection.result.instructionSnapshot.sources.some((source: { kind?: string; content?: string }) => source.kind === 'personality' && source.content === migrationInput.soul))

    host.send(23, 'turn/submit', {
      sessionId,
      runId: 'migrated-instruction-run',
      cwd: projectDir,
      prompt: 'MIGRATED_RUN_REQUEST',
      contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: true, temporary: false, outboundShellMode: 'off' },
      profile: { provider: 'loopback', model: 'migration-model', thinkingLevel: 'off', activeTools: ['read'], compaction: 'auto', approvalMode: 'full', unattended: false },
    })
    const turn = await host.waitFor((message) => message.id === 23)
    assert.equal(turn.result.settlement, 'answered')
    const record = turn.result.record
    const snapshot = record.entries.find((entry: { kind?: string }) => entry.kind === 'instruction-snapshot')?.snapshot
    assert.ok(snapshot)
    assert.ok(snapshot.effectiveText.includes(migrationInput.soul))
    assert.ok(snapshot.effectiveText.includes(migrationInput.agents))
    const providerPrompt = record.entries.find((entry: { kind?: string }) => entry.kind === 'provider-prompt')?.content as string
    assert.ok(providerPrompt.includes(migrationInput.soul))
    assert.ok(providerPrompt.includes(migrationInput.agents))
    assert.ok(providerPrompt.indexOf(migrationInput.soul) < providerPrompt.indexOf('MIGRATED_RUN_REQUEST'))
    assert.ok(providerPrompt.indexOf(migrationInput.agents) < providerPrompt.indexOf('MIGRATED_RUN_REQUEST'))
    const requestBody = JSON.stringify(requests[0]?.messages || [])
    assert.ok(requestBody.includes(migrationInput.soul))
    assert.ok(requestBody.includes(migrationInput.agents))

    await close()
    const restarted = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
      env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir, SUBAGENTS_INSTRUCTION_DB_PATH: join(stateDir, 'instructions.sqlite') },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const restartedOutput = createInterface({ input: restarted.stdout })
    const restartedMessages: Array<Record<string, any>> = []
    restartedOutput.on('line', (line) => { try { restartedMessages.push(JSON.parse(line) as Record<string, any>) } catch { /* diagnostics stay on stderr */ } })
    restarted.stdin.write(`${JSON.stringify({ id: 30, method: 'initialize', params: { protocolVersion: 5, capabilities: ['instructions-v1'] } })}\n`)
    const waitRestart = async (id: number) => {
      const deadline = Date.now() + 20_000
      for (;;) {
        const current = restartedMessages.find((message) => message.id === id)
        if (current) return current
        if (restarted.exitCode !== null) throw new Error(`restarted Pi Host exited: ${restarted.exitCode}`)
        if (Date.now() >= deadline) throw new Error('timed out waiting for restarted Host')
        await delay(25)
      }
    }
    await waitRestart(30)
    restarted.stdin.write(`${JSON.stringify({ id: 31, method: 'instructions/v1/get', params: {} })}\n`)
    const persisted = await waitRestart(31)
    assert.equal(persisted.result.instructions.revision, 1)
    assert.equal(persisted.result.instructions.globalCustomInstructions, migrationInput.agents)
    assert.equal(persisted.result.instructions.advancedPersonalityInstructions, migrationInput.soul)
    restarted.stdin.write(`${JSON.stringify({ id: 33, method: 'sessions/record', params: { sessionId } })}\n`)
    const replayed = await waitRestart(33)
    const replayedSnapshot = replayed.result?.page?.entries?.find((entry: { kind?: string }) => entry.kind === 'instruction-snapshot')?.snapshot
    assert.ok(replayedSnapshot, 'restart record replay must expose the migrated instruction snapshot')
    assert.equal(replayedSnapshot.effectiveHash, snapshot.effectiveHash)
    assert.equal(replayedSnapshot.effectiveText, snapshot.effectiveText)
    restarted.stdin.write(`${JSON.stringify({ id: 32, method: 'instructions/v1/migrate-legacy', params: { soul: 'MUST_NOT_REPLACE', agents: 'MUST_NOT_REPLACE' } })}\n`)
    const repeated = await waitRestart(32)
    assert.equal(repeated.result.instructionMigrationReport.status, 'already_migrated')
    assert.equal(repeated.result.instructions.globalCustomInstructions, migrationInput.agents)
    restarted.stdin.end()
    await Promise.race([once(restarted, 'exit'), delay(3_000)])
    if (restarted.exitCode === null) restarted.kill('SIGTERM')
  } finally {
    await close()
    modelServer.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function assertRendererContraction(): Promise<void> {
  const component = await readFile(resolve(import.meta.dirname, '../src/components/settings/PersonalizationInstructionsSection.tsx'), 'utf8')
  const settings = await readFile(resolve(import.meta.dirname, '../src/pages/SettingsPage.tsx'), 'utf8')
  const learning = await readFile(resolve(import.meta.dirname, '../src/pages/LearningPage.tsx'), 'utf8')
  const learningStore = await readFile(resolve(import.meta.dirname, '../src/store/learningStore.ts'), 'utf8')
  const coordinator = await readFile(resolve(import.meta.dirname, '../src/agent/taskRunCoordinator.ts'), 'utf8')
  const settingsStore = await readFile(resolve(import.meta.dirname, '../src/store/settingsStore.ts'), 'utf8')
  const preload = await readFile(resolve(import.meta.dirname, '../electron/preload.ts'), 'utf8')
  const main = await readFile(resolve(import.meta.dirname, '../electron/main.ts'), 'utf8')
  const instructionSourceOpen = await readFile(resolve(import.meta.dirname, '../electron/instructionSourceOpen.ts'), 'utf8')
  assert.match(settings, /PersonalizationInstructionsSection/)
  assert.match(component, /title="全域指令"/)
  assert.match(component, /title="目前專案指令"/)
  assert.match(component, /全域自訂指令/)
  assert.doesNotMatch(component, /global.*project AGENTS|project AGENTS.*global/i)
  assert.doesNotMatch(learning, /setSoul|setAgents|SOUL\.md|internal AGENTS/i)
  assert.match(component, /browser compatibility 模式/)
  assert.match(component, /window\.subagents\?\.piHost/)
  assert.match(learningStore, /beginLegacyInstructionHydration\(\)/)
  assert.match(learningStore, /failLegacyInstructionHydration\(error\)/)
  assert.match(coordinator, /migration 保留 pending/)
  assert.match(coordinator, /reloadLegacyInstructionSource/)
  assert.doesNotMatch(coordinator, /await\s+bridge\.migrateLegacy\(\{\}\)/)
  const hermesBlock = preload.match(/hermes:\s*\{([\s\S]*?)\n\s*\},\n\s*mcp:/)?.[1] || ''
  assert.match(hermesBlock, /get:/)
  assert.doesNotMatch(hermesBlock, /set:/)
  assert.doesNotMatch(main, /['"]hermes:set['"]|ipcMain\.handle\(\s*['"]hermes:set/)
  assert.match(main, /pi-host:instructions:open-source/)
  assert.match(instructionSourceOpen, /snapshot\.sources\.find\(\(candidate\) => candidate\.scope === 'project' && candidate\.path === canonicalTarget\)/, 'open-source membership must stay in the canonical Host helper')
  assert.match(main, /shellOpen: \(canonicalPath\) => shell\.openPath\(canonicalPath\)/, 'main must pass the safe shell opener into the canonical Host helper')
  assert.match(main, /hermes:get[\s\S]*ENOENT/)
  assert.match(main, /new InstructionRepositoryError\('io_error'/)
  assert.match(main, /new InstructionRepositoryError\('corrupt'/)
  assert.doesNotMatch(settingsStore, /window\.subagents\?\.hermes\??\.set/)
  assert.doesNotMatch(settingsStore, /const\s+bridge\s*=\s*window\.subagents\?\.hermes[\s\S]*?bridge\.set/)
  assert.match(settingsStore, /stripLegacyPersonalization/)
}

await assertPresenceSemantics()
await assertAdmissionReadiness()
await assertHostBoundaries()
await assertRendererContraction()
await assertRealHostRun()

console.log('Instruction migration preserves absent/blank/nonblank legacy fields, Host authority, restart replay, and Personalization contraction')
