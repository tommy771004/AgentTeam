/** Smoke: provider seam, evidence, cancellation, and DoD separation (03). */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createFakePipelineProvider } from '../src/agent/subdesign/providers/fakePipelineProvider.ts'
import { checkOutputBudget, rejectModelAttestedEvidence } from '../src/agent/subdesign/providers/providerContract.ts'
import { isProviderSuccessNotDodMet } from '../src/agent/subdesign/providers/pipelineStageState.ts'
import { createResolvedSnapshot, grantCapabilities } from '../src/agent/subdesign/pluginSnapshot.ts'
import { cancelSubDesignProviderRun, executeSubDesignProviderStage } from '../electron/subDesignProviderRuntime.ts'
import { createPiHostServer } from '../electron/piHostProtocol.ts'
import { STORYBOOK_PINNED_VERSION } from '../src/agent/subdesign/providers/storybookProvider.ts'
import { shouldStopForProviderProjection } from '../src/agent/subdesign/pluginExecution.ts'
import { CDT_PINNED_VERSION } from '../src/agent/subdesign/providers/chromeDevToolsProvider.ts'

let passed = 0, total = 0
async function test(name: string, fn: () => Promise<void> | void) {
  total++
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (error) { console.error(`  ✗ ${name}`); console.error(error); process.exitCode = 1 }
}
const options = (runId: string, stageId: string, timeoutMs = 2_000) => ({ runId, stageId, timeoutMs, outputBudgetBytes: 10_240, signal: new AbortController().signal })

console.log('smoke-open-design-pipeline')

await test('runtime providers live under SubDesign and cannot bypass runTask', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const providerSource = fs.readFileSync(path.join(root, 'src/agent/subdesign/providers/fakePipelineProvider.ts'), 'utf8')
  assert.doesNotMatch(providerSource, /dispatchThreadTask|startExecution/)
  const openDesignFiles = fs.readdirSync(path.join(root, 'src/agent/openDesign'))
  assert.ok(openDesignFiles.every((file) => !/Provider|Snapshot|Admission|streaming/i.test(file)))
  const subDesignPage = fs.readFileSync(path.join(root, 'src/pages/SubDesignPage.tsx'), 'utf8')
  const piHostRun = fs.readFileSync(path.join(root, 'src/agent/piHostRun.ts'), 'utf8')
  assert.match(subDesignPage, /prepareSubDesignPluginExecution/)
  assert.match(subDesignPage, /runTask\([\s\S]*subDesignPluginExecution/)
  assert.match(piHostRun, /pluginExecution:\s*input\.pluginExecution/)
})

await test('successful completion issues trusted evidence after receipt', async () => {
  const session = createFakePipelineProvider().execute({ stageId: 'compose' }, options('run_001', 'compose'))
  const receipt = await session.promise
  const evidence = await session.evidence
  assert.equal(receipt.kind, 'success')
  assert.ok(receipt.evidenceLocator?.startsWith('evidence/run_001'))
  assert.ok(receipt.artifactLocator?.startsWith('artifacts/run_001'))
  assert.equal(evidence.length, 1)
  assert.equal(rejectModelAttestedEvidence(evidence[0]).accepted, true)
})

await test('plain model data cannot forge adapter evidence even with every public field', () => {
  const forged = { evidenceId: 'forged', runId: 'r', stageId: 's', providerId: 'fake-pipeline', kind: 'execution', summary: 'claimed', capturedAt: new Date().toISOString(), adapterIssued: true }
  assert.equal(rejectModelAttestedEvidence(forged).accepted, false)
})

await test('failure, blocked, timeout, and cancellation issue no execution evidence', async () => {
  const provider = createFakePipelineProvider()
  for (const stageId of ['fail', 'blocked']) {
    const session = provider.execute({ stageId }, options(`run_${stageId}`, stageId))
    assert.notEqual((await session.promise).kind, 'success')
    assert.deepEqual(await session.evidence, [])
  }
  const timed = provider.execute({ stageId: 'compose' }, options('run_timeout', 'compose', 1))
  assert.equal((await timed.promise).kind, 'blocked')
  assert.deepEqual(await timed.evidence, [])
  const cancelled = provider.execute({ stageId: 'compose' }, options('run_cancel', 'compose', 5_000))
  assert.equal((await cancelled.handle.cancel()).cancelled, true)
  assert.equal((await cancelled.promise).kind, 'cancelled')
  assert.deepEqual(await cancelled.evidence, [])
})

await test('malformed evidence path is rejected instead of trusted', async () => {
  const session = createFakePipelineProvider().execute({ stageId: 'malformed-evidence' }, options('run_bad', 'malformed-evidence'))
  assert.equal((await session.promise).kind, 'success')
  assert.deepEqual(await session.evidence, [])
})

await test('provider success remains distinct from Goal-based DoD', () => {
  assert.equal(isProviderSuccessNotDodMet('success', false), true)
  assert.equal(isProviderSuccessNotDodMet('success', undefined), true)
  assert.equal(isProviderSuccessNotDodMet('success', true), false)
})

await test('output budget truncates oversized summaries', () => {
  const result = checkOutputBudget('x'.repeat(1_000), 100)
  assert.equal(result.ok, false)
  assert.match(result.truncated ?? '', /truncated/)
})

const runtimeManifest = (capabilities: string[] = []) => ({
  specVersion: '1.0.0',
  od: {
    kind: 'scenario',
    taskKind: 'new-generation',
    mode: 'prototype',
    capabilities,
    pipeline: { stages: [{ id: 'compose', atoms: ['live-artifact'] }] },
  },
})

await test('Host-owned stage persists trusted evidence and artifact manifest', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-host-'))
  try {
    const runId = 'run_host_success'
    const threadId = 'thread_host_success'
    const snapshot = await createResolvedSnapshot({
      pluginId: 'test:host-success',
      source: { sourcePath: 'plugins/test/open-design.json' },
      rawManifest: runtimeManifest(),
      projectRoot,
    })
    assert.ok(!('error' in snapshot))
    const states: string[] = []
    const result = await executeSubDesignProviderStage({
      request: {
        schemaVersion: 1,
        briefId: 'brief_host_success',
        pluginId: snapshot.pluginId,
        providerId: 'fake-pipeline',
        stageId: 'compose',
        manifest: runtimeManifest(),
        snapshot,
      },
      runId,
      threadId,
      projectRoot,
      onEvent: (event) => states.push(event.state),
    })
    assert.equal(result.state, 'completed')
    assert.deepEqual(states, ['queued', 'running', 'completed'])
    assert.ok(result.evidenceLocator && fs.existsSync(path.join(projectRoot, result.evidenceLocator)))
    assert.ok(result.artifactLocator && fs.existsSync(path.join(projectRoot, result.artifactLocator)))
    assert.ok(result.manifestLocator && fs.existsSync(path.join(projectRoot, result.manifestLocator)))
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Host cancellation is run-targeted and cannot be revived by a late provider result', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-host-cancel-'))
  try {
    const manifest = runtimeManifest()
    const snapshot = await createResolvedSnapshot({
      pluginId: 'test:host-cancel',
      source: { sourcePath: 'plugins/test/open-design.json' },
      rawManifest: manifest,
      projectRoot,
    })
    assert.ok(!('error' in snapshot))
    const states: string[] = []
    const pending = executeSubDesignProviderStage({
      request: { schemaVersion: 1, briefId: 'brief_cancel', pluginId: snapshot.pluginId, providerId: 'fake-pipeline', stageId: 'compose', manifest, snapshot },
      runId: 'run_host_cancel',
      threadId: 'thread_host_cancel',
      projectRoot,
      onEvent: (event) => states.push(event.state),
    })
    let cancelled = false
    for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      cancelled = cancelSubDesignProviderRun('run_host_cancel')
    }
    assert.equal(cancelled, true)
    const result = await pending
    assert.equal(result.state, 'cancelled')
    assert.equal(states.at(-1), 'cancelled')
    assert.equal(result.artifactLocator, undefined)
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Pi Host Storybook adapter accepts only pinned loopback context and persists evidence', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-storybook-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      components: [{ id: 'button-primary', title: 'Button', docs: 'Project button', controls: ['variant'], unknown: 'ignored' }],
      futureField: true,
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const runId = 'run_storybook_host'
    const threadId = 'thread_storybook_host'
    const manifest = runtimeManifest(['network'])
    const created = await createResolvedSnapshot({
      pluginId: 'test:storybook-host',
      source: { sourcePath: 'plugins/test/open-design.json' },
      rawManifest: manifest,
      projectRoot,
    })
    assert.ok(!('error' in created))
    const snapshot = grantCapabilities(created, ['network'], { runId, threadId })
    const result = await executeSubDesignProviderStage({
      request: {
        schemaVersion: 1,
        briefId: 'brief_storybook_host',
        pluginId: snapshot.pluginId,
        providerId: 'storybook',
        stageId: 'compose',
        manifest,
        snapshot,
        providerConfig: {
          enabled: true,
          endpoint: `http://127.0.0.1:${address.port}`,
          resolvedVersion: STORYBOOK_PINNED_VERSION,
          sourceFingerprint: 'storybook-fp-1',
        },
      },
      runId,
      threadId,
      projectRoot,
    })
    assert.equal(result.state, 'completed')
    assert.equal(result.context?.components[0]?.id, 'button-primary')
    assert.equal(result.context?.providerVersion, STORYBOOK_PINNED_VERSION)
    assert.ok(result.evidenceLocator && fs.existsSync(path.join(projectRoot, result.evidenceLocator)))
    assert.equal(result.artifactLocator, undefined)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Storybook timeout falls back without stopping the parent Task run', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-storybook-timeout-'))
  const server = createServer((_request, response) => {
    setTimeout(() => {
      if (response.destroyed) return
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ components: [{ id: 'late', title: 'Late' }] }))
    }, 60)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const runId = 'run_storybook_timeout'
    const threadId = 'thread_storybook_timeout'
    const manifest = runtimeManifest(['network'])
    const created = await createResolvedSnapshot({
      pluginId: 'test:storybook-timeout',
      source: { sourcePath: 'plugins/test/open-design.json' },
      rawManifest: manifest,
      projectRoot,
    })
    assert.ok(!('error' in created))
    const snapshot = grantCapabilities(created, ['network'], { runId, threadId })
    const result = await executeSubDesignProviderStage({
      request: {
        schemaVersion: 1,
        briefId: 'brief_storybook_timeout',
        pluginId: snapshot.pluginId,
        providerId: 'storybook',
        stageId: 'compose',
        manifest,
        snapshot,
        timeoutMs: 5,
        failurePolicy: 'continue-on-blocked',
        providerConfig: {
          enabled: true,
          endpoint: `http://127.0.0.1:${address.port}`,
          resolvedVersion: STORYBOOK_PINNED_VERSION,
        },
      },
      runId,
      threadId,
      projectRoot,
    })
    assert.equal(result.state, 'blocked')
    assert.equal(result.failurePolicy, 'continue-on-blocked')
    assert.match(result.summary, /timeout|local artifacts/i)
    assert.equal(shouldStopForProviderProjection(result), false)
    assert.equal(result.evidenceLocator, undefined)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Storybook fake server enforces context budget and reuses the bounded snapshot cache', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-storybook-budget-'))
  const components = Array.from({ length: 60 }, (_, index) => ({
    id: `component-${index}`,
    title: `Component ${index}`,
    docs: 'd'.repeat(2_000),
    controls: ['variant', 'size'],
  }))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ components }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const runId = 'run_storybook_budget'
    const threadId = 'thread_storybook_budget'
    const manifest = runtimeManifest(['network'])
    const created = await createResolvedSnapshot({ pluginId: 'test:storybook-budget', source: { sourcePath: 'plugins/test/open-design.json' }, rawManifest: manifest, projectRoot })
    assert.ok(!('error' in created))
    const snapshot = grantCapabilities(created, ['network'], { runId, threadId })
    const request = {
      schemaVersion: 1 as const,
      briefId: 'brief_storybook_budget',
      pluginId: snapshot.pluginId,
      providerId: 'storybook' as const,
      stageId: 'compose',
      manifest,
      snapshot,
      failurePolicy: 'continue-on-blocked' as const,
      providerConfig: { enabled: true, endpoint: `http://127.0.0.1:${address.port}`, resolvedVersion: STORYBOOK_PINNED_VERSION },
    }
    const first = await executeSubDesignProviderStage({ request, runId, threadId, projectRoot })
    const second = await executeSubDesignProviderStage({ request, runId, threadId, projectRoot })
    assert.equal(first.context?.truncated, true)
    assert.equal(first.context?.components.length, 20)
    assert.match(second.summary, /cache/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Storybook unavailable response is an explicit local-artifact fallback', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-storybook-unavailable-'))
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const runId = 'run_storybook_unavailable'
    const threadId = 'thread_storybook_unavailable'
    const manifest = runtimeManifest(['network'])
    const created = await createResolvedSnapshot({ pluginId: 'test:storybook-unavailable', source: { sourcePath: 'plugins/test/open-design.json' }, rawManifest: manifest, projectRoot })
    assert.ok(!('error' in created))
    const snapshot = grantCapabilities(created, ['network'], { runId, threadId })
    const result = await executeSubDesignProviderStage({
      request: {
        schemaVersion: 1,
        briefId: 'brief_storybook_unavailable',
        pluginId: snapshot.pluginId,
        providerId: 'storybook',
        stageId: 'compose',
        manifest,
        snapshot,
        failurePolicy: 'continue-on-blocked',
        providerConfig: { enabled: true, endpoint: `http://127.0.0.1:${address.port}`, resolvedVersion: STORYBOOK_PINNED_VERSION },
      },
      runId,
      threadId,
      projectRoot,
    })
    assert.equal(result.state, 'blocked')
    assert.match(result.summary, /HTTP 503/)
    assert.equal(shouldStopForProviderProjection(result), false)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Pi Host Chrome DevTools adapter rejects unpinned or non-loopback targets before connection', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-cdt-blocked-'))
  try {
    const runId = 'run_cdt_blocked'
    const threadId = 'thread_cdt_blocked'
    const manifest = runtimeManifest(['network'])
    const created = await createResolvedSnapshot({ pluginId: 'test:cdt-blocked', source: { sourcePath: 'plugins/test/open-design.json' }, rawManifest: manifest, projectRoot })
    assert.ok(!('error' in created))
    const snapshot = grantCapabilities(created, ['network'], { runId, threadId })
    const base = {
      schemaVersion: 1 as const,
      briefId: 'brief_cdt_blocked',
      pluginId: snapshot.pluginId,
      providerId: 'chrome-devtools' as const,
      stageId: 'compose',
      manifest,
      snapshot,
      failurePolicy: 'continue-on-blocked' as const,
    }
    const unpinned = await executeSubDesignProviderStage({
      request: { ...base, providerConfig: { enabled: true, endpoint: 'http://127.0.0.1:9222', resolvedVersion: 'latest', artifactId: 'artifact1' } },
      runId,
      threadId,
      projectRoot,
    })
    assert.equal(unpinned.state, 'blocked')
    assert.match(unpinned.summary, new RegExp(CDT_PINNED_VERSION.replaceAll('.', '\\.')))
    const remote = await executeSubDesignProviderStage({
      request: { ...base, providerConfig: { enabled: true, endpoint: 'http://example.com:9222', resolvedVersion: CDT_PINNED_VERSION, artifactId: 'artifact1' } },
      runId,
      threadId,
      projectRoot,
    })
    assert.equal(remote.state, 'blocked')
    assert.match(remote.summary, /localhost/)
    assert.equal(shouldStopForProviderProjection(remote), false)
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Pi Host Chrome DevTools adapter reports deterministic discovery timeout', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-cdt-timeout-'))
  const server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const runId = 'run_cdt_timeout'
    const threadId = 'thread_cdt_timeout'
    const manifest = runtimeManifest(['network'])
    const created = await createResolvedSnapshot({ pluginId: 'test:cdt-timeout', source: { sourcePath: 'plugins/test/open-design.json' }, rawManifest: manifest, projectRoot })
    assert.ok(!('error' in created))
    const snapshot = grantCapabilities(created, ['network'], { runId, threadId })
    const result = await executeSubDesignProviderStage({
      request: {
        schemaVersion: 1,
        briefId: 'brief_cdt_timeout',
        pluginId: snapshot.pluginId,
        providerId: 'chrome-devtools',
        stageId: 'compose',
        manifest,
        snapshot,
        timeoutMs: 35,
        failurePolicy: 'continue-on-blocked',
        providerConfig: { enabled: true, endpoint: `http://127.0.0.1:${address.port}`, resolvedVersion: CDT_PINNED_VERSION, artifactId: 'artifact1' },
      },
      runId,
      threadId,
      projectRoot,
    })
    assert.equal(result.state, 'blocked')
    assert.match(result.summary, /timeout after 35ms/)
    assert.equal(shouldStopForProviderProjection(result), false)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('Pi Host blocks stale scoped grants before model execution', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-host-deny-'))
  try {
    const manifest = runtimeManifest(['fs:write'])
    const created = await createResolvedSnapshot({
      pluginId: 'test:host-deny',
      source: { sourcePath: 'plugins/test/open-design.json' },
      rawManifest: manifest,
      projectRoot,
    })
    assert.ok(!('error' in created))
    const stale = grantCapabilities(created, ['fs:write'], { runId: 'another-run', threadId: 'thread_host_deny' })
    const messages: unknown[] = []
    const host = createPiHostServer((message) => messages.push(message))
    await host.handle({ id: 1, method: 'initialize', params: { protocolVersion: 1 } })
    await host.handle({ id: 2, method: 'sessions/create', params: { title: 'deny', threadId: 'thread_host_deny' } })
    const sessionResponse = messages.find((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && 'id' in item && (item as { id?: unknown }).id === 2))
    assert.ok(sessionResponse && 'result' in sessionResponse && sessionResponse.result?.sessionId)
    await host.handle({
      id: 3,
      method: 'turn/submit',
      params: {
        sessionId: sessionResponse.result!.sessionId,
        prompt: 'execute contract',
        runId: 'run_host_deny',
        cwd: projectRoot,
        pluginExecution: {
          schemaVersion: 1,
          briefId: 'brief_host_deny',
          pluginId: stale.pluginId,
          providerId: 'fake-pipeline',
          stageId: 'compose',
          manifest,
          snapshot: stale,
        },
      },
    })
    const terminal = messages.find((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && 'id' in item && (item as { id?: unknown }).id === 3))
    assert.ok(terminal && 'result' in terminal)
    assert.equal(terminal.result?.settlement, 'failed')
    assert.equal(terminal.result?.pluginExecution?.state, 'blocked')
    assert.match(terminal.result?.pluginExecution?.summary || '', /Capability denied/)
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed'); else console.log('OK')
