import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  type InstructionRepository,
} from '../electron/instructionRepository.ts'

const request = async (
  host: { handle(input: unknown): Promise<void> },
  messages: PiHostMessage[],
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<PiHostResponse> => {
  await host.handle({ id, method, params })
  const response = messages.find((message): message is PiHostResponse => 'id' in message && message.id === id)
  if (!response) throw new Error(`Pi Host did not answer instruction request ${id}`)
  return response
}

function createTestHost(repository: InstructionRepository, messages: PiHostMessage[]) {
  return createPiHostServer(
    (message) => messages.push(message),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    repository,
  )
}

const initialize = (host: { handle(input: unknown): Promise<void> }, messages: PiHostMessage[]) => request(
  host,
  messages,
  1,
  'initialize',
  { protocolVersion: 5, capabilities: ['instructions-v1', 'memory-store-v1'] },
)

const messages: PiHostMessage[] = []
const repository = new InMemoryInstructionRepository()
const host = createTestHost(repository, messages)
const initialized = await initialize(host, messages)
assert.equal(initialized.result?.protocolVersion, 5)
const memoryAccess = { origin: 'admin', memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false }
const memoryBefore = await request(host, messages, 6, 'memory/v1/list', {
  scope: { kind: 'global' },
  access: memoryAccess,
  limit: 10,
})
assert.equal(memoryBefore.result?.memoryStore?.revision, 0)

const saved = await request(host, messages, 2, 'instructions/v1/save', {
  expectedRevision: 0,
  globalCustomInstructions: 'HOST-CONTRACT-GLOBAL',
})
assert.equal(saved.error, undefined)
assert.equal(saved.result?.instructions?.revision, 1)
assert.equal(messages.filter((message) => 'event' in message && message.event === 'instruction/changed').length, 1)

const read = await request(host, messages, 3, 'instructions/v1/get')
assert.equal(read.result?.instructions?.globalCustomInstructions, 'HOST-CONTRACT-GLOBAL')
assert.equal(read.result?.instructions?.revision, 1)
assert.equal(JSON.stringify(await repository.read()).includes('HOST-CONTRACT-GLOBAL'), true)
const memoryAfter = await request(host, messages, 7, 'memory/v1/list', {
  scope: { kind: 'global' },
  access: memoryAccess,
  limit: 10,
})
assert.equal(memoryAfter.result?.memoryStore?.revision, 0, 'instruction save must not mutate durable memory')

const hierarchyRoot = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-hierarchy-host-'))
const hierarchyRepo = join(hierarchyRoot, 'repo')
const hierarchyProject = join(hierarchyRepo, 'project')
const hierarchyWork = join(hierarchyProject, 'src', 'feature')
try {
  await mkdir(join(hierarchyRepo, '.git'), { recursive: true })
  await mkdir(hierarchyWork, { recursive: true })
  await writeFile(join(hierarchyRepo, 'AGENTS.md'), 'HOST-PARENT-RULE')
  await writeFile(join(hierarchyProject, 'AGENTS.md'), 'HOST-ROOT-RULE')
  await writeFile(join(hierarchyProject, 'CLAUDE.md'), 'HOST-ROOT-SHADOW')
  await writeFile(join(hierarchyWork, 'AGENTS.override.md'), 'HOST-WORK-OVERRIDE')
  const hierarchyResponse = await request(host, messages, 8, 'instructions/v1/resolve', {
    projectRoot: hierarchyProject,
    workPath: hierarchyWork,
    fallbackFilenames: ['CUSTOM.md', '../unsafe.md', 'CUSTOM.md'],
  })
  const hierarchySnapshot = hierarchyResponse.result?.instructionSnapshot
  assert.equal(hierarchySnapshot?.projectIdentity, await realpath(hierarchyProject))
  assert.equal(hierarchySnapshot?.workPath, await realpath(hierarchyWork))
  const appliedKinds = hierarchySnapshot?.sources.filter((source) => source.applied).map((source) => source.kind) || []
  assert.deepEqual(appliedKinds.filter((kind) => ['project-parent', 'project-root', 'project-override'].includes(kind)), [
    'project-parent', 'project-root', 'project-override',
  ])
  const appliedSources = hierarchySnapshot?.sources.filter((source) => source.applied) || []
  const observedOrders = appliedSources.map((source) => source.effectiveOrder)
  assert.equal(new Set(observedOrders).size, observedOrders.length, 'Host effective source orders are unique')
  assert.deepEqual(observedOrders, [...observedOrders].sort((left, right) => (left || 0) - (right || 0)), 'Host effective source order follows projection order')
  assert.equal(appliedSources.filter((source) => source.scope === 'project').length, 3)
  assert.equal(hierarchySnapshot?.sources.find((source) => source.kind === 'project-parent')?.openable, false, 'parent metadata is outside selected project and is not openable')
  const shadowedRoot = hierarchySnapshot?.sources.find((source) => source.path?.endsWith('/CLAUDE.md'))
  assert.equal(shadowedRoot?.applied, false)
  assert.equal(shadowedRoot?.effectiveOrder, null, 'shadowed provenance has no effective order')
  assert.ok(hierarchySnapshot?.effectiveText.indexOf('HOST-PARENT-RULE') < hierarchySnapshot.effectiveText.indexOf('HOST-ROOT-RULE'))
  assert.ok(hierarchySnapshot?.effectiveText.indexOf('HOST-ROOT-RULE') < hierarchySnapshot.effectiveText.indexOf('HOST-WORK-OVERRIDE'))

  const boundedFallbackProject = join(hierarchyRepo, 'bounded-fallback-project')
  await mkdir(boundedFallbackProject, { recursive: true })
  const maxFallbackName = `${'m'.repeat(125)}.md`
  const overlongFallbackName = `${'o'.repeat(126)}.md`
  const c0FallbackName = 'host-bad\u0001.md'
  const c1FallbackName = 'host-bad\u0085.md'
  const lineSeparatorFallbackName = 'host-bad\u2029.md'
  await writeFile(join(boundedFallbackProject, maxFallbackName), 'HOST-MAX-BOUNDARY-FALLBACK')
  await writeFile(join(boundedFallbackProject, overlongFallbackName), 'HOST-OVERLONG-MUST-NOT-APPLY')
  await writeFile(join(boundedFallbackProject, c0FallbackName), 'HOST-C0-MUST-NOT-APPLY')
  await writeFile(join(boundedFallbackProject, c1FallbackName), 'HOST-C1-MUST-NOT-APPLY')
  await writeFile(join(boundedFallbackProject, lineSeparatorFallbackName), 'HOST-LINE-SEPARATOR-MUST-NOT-APPLY')
  const boundedFallbackResponse = await request(host, messages, 9, 'instructions/v1/resolve', {
    projectRoot: boundedFallbackProject,
    workPath: boundedFallbackProject,
    fallbackFilenames: [overlongFallbackName, c0FallbackName, c1FallbackName, lineSeparatorFallbackName, maxFallbackName],
  })
  const boundedFallbackSnapshot = boundedFallbackResponse.result?.instructionSnapshot
  const boundedFallbackSource = boundedFallbackSnapshot?.sources.find((source) => source.kind === 'fallback' && source.applied)
  assert.equal(boundedFallbackSource?.path?.endsWith(maxFallbackName), true, 'public Host accepts exactly-boundary Unicode-safe fallback')
  assert.ok(!boundedFallbackSnapshot?.effectiveText.includes('MUST-NOT-APPLY'), 'public Host rejects control and overlong fallback names')
} finally {
  await rm(hierarchyRoot, { recursive: true, force: true })
}

const eventCountBeforeStale = messages.filter((message) => 'event' in message && message.event === 'instruction/changed').length
const stale = await request(host, messages, 4, 'instructions/v1/save', {
  expectedRevision: 0,
  globalCustomInstructions: 'STALE-MUST-NOT-COMMIT',
})
assert.equal(stale.error?.code, 'conflict')
assert.equal(messages.filter((message) => 'event' in message && message.event === 'instruction/changed').length, eventCountBeforeStale, 'failed save emits no success revision event')
assert.equal((await request(host, messages, 5, 'instructions/v1/get')).result?.instructions?.globalCustomInstructions, 'HOST-CONTRACT-GLOBAL')

const failureCases = [
  'read_only',
  'busy',
  'io_error',
  'unsupported_schema',
] as const
for (const [index, code] of failureCases.entries()) {
  const failureMessages: PiHostMessage[] = []
  const failureHost = createTestHost(
    new UnavailableInstructionRepository(new InstructionRepositoryError(code, `synthetic ${code}`)),
    failureMessages,
  )
  await initialize(failureHost, failureMessages)
  const failed = await request(failureHost, failureMessages, 10 + index, 'instructions/v1/save', {
    expectedRevision: 0,
    globalCustomInstructions: 'MUST-NOT-COMMIT',
  })
  assert.equal(failed.error?.code, code, `public Host contract preserves ${code}`)
  assert.equal(failureMessages.some((message) => 'event' in message && message.event === 'instruction/changed'), false)
}

const root = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-host-contract-'))
const databasePath = join(root, 'instructions.sqlite')
try {
  const firstRepository = await SqliteInstructionRepository.open(databasePath)
  const firstMessages: PiHostMessage[] = []
  const firstHost = createTestHost(firstRepository, firstMessages)
  await initialize(firstHost, firstMessages)
  const firstSave = await request(firstHost, firstMessages, 20, 'instructions/v1/save', {
    expectedRevision: 0,
    globalCustomInstructions: 'RESTART-PERSISTED-GLOBAL',
  })
  assert.equal(firstSave.result?.instructions?.revision, 1)
  await firstRepository.close()

  const restartedRepository = await SqliteInstructionRepository.open(databasePath)
  const restartedMessages: PiHostMessage[] = []
  const restartedHost = createTestHost(restartedRepository, restartedMessages)
  await initialize(restartedHost, restartedMessages)
  const restarted = await request(restartedHost, restartedMessages, 21, 'instructions/v1/get')
  assert.equal(restarted.result?.instructions?.globalCustomInstructions, 'RESTART-PERSISTED-GLOBAL')
  assert.equal(restarted.result?.instructions?.revision, 1)

  // Public authorization grants the canonical file identity, not a mutable
  // symlink pathname. A retargeted link must require a fresh grant.
  const authProject = join(root, 'auth-project')
  const authSibling = join(root, 'auth-sibling.md')
  const authReplacement = join(root, 'auth-replacement.md')
  const authLink = join(authProject, 'linked.md')
  await mkdir(authProject, { recursive: true })
  await writeFile(authSibling, 'AUTHORIZED-OLD-SIBLING')
  await writeFile(authReplacement, 'UNAUTHORIZED-REPLACEMENT')
  await writeFile(join(authProject, 'AGENTS.md'), `@${authLink}\n`)
  await symlink(authSibling, authLink)

  const denied = await request(restartedHost, restartedMessages, 22, 'instructions/v1/resolve', { projectRoot: authProject, workPath: authProject })
  assert.ok(denied.result?.instructionSnapshot?.diagnostics.some((item: { code?: string }) => item.code === 'unauthorized'))
  assert.ok(!denied.result?.instructionSnapshot?.effectiveText.includes('AUTHORIZED-OLD-SIBLING'))
  const deniedSource = denied.result?.instructionSnapshot?.sources.find((source: { path?: string }) => source.path?.endsWith('auth-sibling.md'))
  assert.equal(deniedSource?.applied, false)
  assert.equal(deniedSource?.metadataStatus, 'unauthorized')

  const authorized = await request(restartedHost, restartedMessages, 23, 'instructions/v1/authorize-include', { target: authLink })
  assert.ok(authorized.result?.authorizedIncludeTargets?.includes(await realpath(authSibling)))
  const allowed = await request(restartedHost, restartedMessages, 24, 'instructions/v1/resolve', { projectRoot: authProject, workPath: authProject })
  assert.ok(allowed.result?.instructionSnapshot?.effectiveText.includes('AUTHORIZED-OLD-SIBLING'))
  assert.equal(allowed.result?.instructionSnapshot?.sources.find((source: { path?: string }) => source.path?.endsWith('auth-sibling.md'))?.applied, true)

  await unlink(authLink)
  await symlink(authReplacement, authLink)
  const retargeted = await request(restartedHost, restartedMessages, 25, 'instructions/v1/resolve', { projectRoot: authProject, workPath: authProject })
  assert.ok(retargeted.result?.instructionSnapshot?.diagnostics.some((item: { code?: string }) => item.code === 'unauthorized'))
  assert.ok(!retargeted.result?.instructionSnapshot?.effectiveText.includes('UNAUTHORIZED-REPLACEMENT'))
  assert.ok(!retargeted.result?.instructionSnapshot?.effectiveText.includes('AUTHORIZED-OLD-SIBLING'))
  await restartedRepository.close()

  const persistedRepository = await SqliteInstructionRepository.open(databasePath)
  const persistedMessages: PiHostMessage[] = []
  const persistedHost = createTestHost(persistedRepository, persistedMessages)
  await initialize(persistedHost, persistedMessages)
  const afterRestart = await request(persistedHost, persistedMessages, 26, 'instructions/v1/resolve', { projectRoot: authProject, workPath: authProject })
  assert.ok(afterRestart.result?.instructionSnapshot?.diagnostics.some((item: { code?: string }) => item.code === 'unauthorized'))
  assert.ok(!afterRestart.result?.instructionSnapshot?.effectiveText.includes('UNAUTHORIZED-REPLACEMENT'))
  await persistedRepository.close()
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('instruction Host public contract: save/read/conflict/restart/typed-failures passed')
