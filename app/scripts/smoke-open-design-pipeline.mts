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
import { shouldStopForProviderProjection } from '../src/agent/subdesign/pluginExecution.ts'
import { prepareSubDesignRun } from '../src/agent/subdesign/pluginExecutionPreparation.ts'
import { pluginInputsMessage, resolvePluginInputs } from '../src/agent/subdesign/pluginInputs.ts'
import { parseOpenDesignPluginManifest } from '../src/agent/openDesign/pluginContract.ts'
import { adoptPluginSnapshot, requestCapabilityGrants, revokePluginGrants } from '../src/agent/subdesign/pluginTrust.ts'
import { usePermissionAskStore } from '../src/store/permissionAskStore.ts'
import { createPiHostServer } from '../electron/piHostProtocol.ts'
import { STORYBOOK_PINNED_VERSION } from '../src/agent/subdesign/providers/storybookProvider.ts'
import { CDT_PINNED_VERSION } from '../src/agent/subdesign/providers/chromeDevToolsProvider.ts'
import {
  canRender,
  createStreamingEnvelope,
  mergeStreamingUpdate,
  reconcileUpdates,
} from '../src/agent/subdesign/streamingEnvelope.ts'
import {
  ARTIFACT_RENDERER_CAPABILITIES,
  isArtifactExportEligible,
  withPreviewCsp,
} from '../src/agent/subdesign/artifactRendererCapabilities.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
  // Every SubDesign run start goes through the preparation seam and hands the
  // result to runTask; the renderer never dispatches or starts execution itself.
  assert.match(subDesignPage, /prepareSubDesignRun/)
  assert.match(subDesignPage, /runTask\([\s\S]*overrides: mergeModelOverrides\(pluginExecution\.overrides\)/)
  assert.doesNotMatch(subDesignPage, /dispatchThreadTask|startExecution/)
  const critiqueTheater = fs.readFileSync(path.join(root, 'src/components/subdesign/CritiqueTheater.tsx'), 'utf8')
  assert.match(critiqueTheater, /prepareSubDesignRun/)
  assert.doesNotMatch(critiqueTheater, /dispatchThreadTask|startExecution/)
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

await test('stream replay reconciles duplicate and out-of-order events deterministically', () => {
  const initial = createStreamingEnvelope({ artifactId: 'artifact_replay', artifactKind: 'html', runId: 'run_replay' })
  const doneFirst = mergeStreamingUpdate(initial, { seq: 2, kind: 'done', text: '完成' }).envelope
  assert.equal(doneFirst.status, 'streaming')
  assert.deepEqual(reconcileUpdates(doneFirst.updates), [])

  const completed = mergeStreamingUpdate(doneFirst, { seq: 1, kind: 'text-delta', content: '<main>ready</main>' }).envelope
  assert.equal(completed.status, 'complete')
  assert.deepEqual(completed.updates.map((update) => update.seq), [1, 2])
  assert.equal(reconcileUpdates(completed.updates).map((update) => update.content || '').join(''), '<main>ready</main>')

  const replayed = mergeStreamingUpdate(completed, { seq: 1, kind: 'text-delta', content: '<main>ready</main>' })
  assert.equal(replayed.envelope, completed)
  const late = mergeStreamingUpdate(completed, { seq: 3, kind: 'text-delta', content: 'late' })
  assert.match(late.rejected || '', /已終止/)
  assert.equal(late.envelope, completed)
})

await test('error, blocked, and cancel remain distinct terminal streams', () => {
  const terminal = (kind: 'error' | 'blocked' | 'cancelled') => mergeStreamingUpdate(
    createStreamingEnvelope({ artifactId: `artifact_${kind}`, artifactKind: 'html', runId: `run_${kind}` }),
    { seq: 1, kind, text: kind },
  ).envelope
  assert.equal(terminal('error').status, 'error')
  assert.equal(terminal('blocked').status, 'blocked')
  const cancelled = terminal('cancelled')
  assert.equal(cancelled.status, 'cancelled')
  assert.match(mergeStreamingUpdate(cancelled, { seq: 2, kind: 'done' }).rejected || '', /已終止/)
})

await test('renderer capabilities fail closed for streaming, sandbox, and export', () => {
  const svgStream = createStreamingEnvelope({ artifactId: 'artifact_svg', artifactKind: 'svg', runId: 'run_svg' })
  assert.equal(canRender(ARTIFACT_RENDERER_CAPABILITIES.svg, svgStream).ok, false)
  const document = withPreviewCsp('<script>fetch("https://example.com")</script>', 'html')
  assert.match(document, /default-src 'none'/)
  assert.match(document, /connect-src 'none'/)
  assert.match(document, /form-action 'none'/)
  assert.equal(isArtifactExportEligible('html', 'html'), true)
  assert.equal(isArtifactExportEligible('html', 'svg'), false)
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
    assert.equal(result.stream?.status, 'cancelled')
    assert.equal(result.stream?.updates.at(-1)?.kind, 'cancelled')
    assert.ok(!result.stream?.updates.some((update) => update.kind === 'done'))
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


await test('required plugin inputs are enforced on both sides and cannot be skipped',async()=>{
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-inputs-'))
  try {
    const manifest = {
      specVersion: '1.0.0',
      od: {
        kind: 'scenario',
        capabilities: [],
        inputs: [
          { name: 'headline', label: 'Headline', type: 'string', required: true },
          { name: 'aspect', label: 'Aspect', type: 'select', options: ['16:9', '9:16'], default: '16:9' },
          { name: 'seconds', label: 'Seconds', type: 'number', default: 15 },
        ],
        pipeline: { stages: [{ id: 'compose', atoms: ['live-artifact'] }] },
      },
    }
    const declared = (parseOpenDesignPluginManifest(manifest) as { manifest: { inputs: unknown[] } }).manifest.inputs

    // Defaults fill themselves in; a required input with no default blocks.
    const empty = resolvePluginInputs(declared, {})
    assert.equal(empty.ok, false)
    assert.deepEqual(empty.ok === false ? empty.missing : [], ['headline'])
    // The form is handed every declared input (so defaults stay editable), and
    // the block names exactly what is missing.
    assert.match(pluginInputsMessage(empty as Extract<typeof empty, { ok: false }>), /headline/)

    // Supplying it resolves, with declared defaults applied and types coerced.
    const filled = resolvePluginInputs(declared, { headline: '  Launch  ' })
    assert.ok(filled.ok)
    assert.deepEqual(filled.values, { headline: 'Launch', aspect: '16:9', seconds: 15 })

    // A select value outside its options is rejected, not silently accepted.
    const badSelect = resolvePluginInputs(declared, { headline: 'x', aspect: '4:3' })
    assert.equal(badSelect.ok, false)
    assert.match(pluginInputsMessage(badSelect as Extract<typeof badSelect, { ok: false }>), /aspect/)

    // Undeclared fields never reach the provider.
    const smuggled = resolvePluginInputs(declared, { headline: 'x', evil: 'rm -rf' })
    assert.ok(smuggled.ok)
    assert.ok(!('evil' in smuggled.values))

    const snapshot = await createResolvedSnapshot({
      pluginId: 'test:inputs', source: { sourcePath: 'plugins/test/open-design.json' },
      rawManifest: manifest, projectRoot,
    })
    assert.ok(!('error' in snapshot))
    const baseRequest = {
      schemaVersion: 1, briefId: 'brief_inputs', pluginId: snapshot.pluginId,
      providerId: 'fake-pipeline', stageId: 'compose', manifest, snapshot,
    }

    // The Host refuses a request that omits the required input — this is the
    // "surface failure does not skip a required input" guarantee: even if the
    // form crashed and the renderer were bypassed, execution fails closed.
    const skipped = await executeSubDesignProviderStage({
      request: baseRequest, runId: 'run_inputs_missing', threadId: 't', projectRoot,
    })
    assert.equal(skipped.state, 'blocked')
    assert.match(skipped.summary, /Plugin input rejected/)
    assert.match(skipped.summary, /headline/)

    // ...and a forged out-of-options value is refused the same way.
    const forged = await executeSubDesignProviderStage({
      request: { ...baseRequest, inputs: { headline: 'x', aspect: '4:3' } },
      runId: 'run_inputs_forged', threadId: 't', projectRoot,
    })
    assert.equal(forged.state, 'blocked')
    assert.match(forged.summary, /Plugin input rejected/)

    // With the input supplied, the same request runs.
    const ok = await executeSubDesignProviderStage({
      request: { ...baseRequest, inputs: { headline: 'Launch' } },
      runId: 'run_inputs_ok', threadId: 't', projectRoot,
    })
    assert.equal(ok.state, 'completed')
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('the plugin input form is mounted and drafts survive a reload',()=>{
  const form = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/PluginInputForm.tsx'), 'utf8')
  // Collected through the sandboxed surface, with a real native fallback.
  assert.match(form, /<McpAppSurface/)
  assert.match(form, /fallback=/)
  // Validation is the shared authority, not a second inline implementation.
  assert.match(form, /resolvePluginInputs/)
  // Draft save/restore, so leaving and returning keeps what was typed.
  assert.match(form, /saveDraft/)
  assert.match(form, /loadDraft/)
  assert.match(form, /clearDraft/)
  const studio = fs.readFileSync(path.join(appRoot, 'src/components/subdesign/SubDesignProjectStudio.tsx'), 'utf8')
  assert.match(studio, /<PluginInputForm/)
  const page = fs.readFileSync(path.join(appRoot, 'src/pages/SubDesignPage.tsx'), 'utf8')
  assert.match(page, /pluginInputs/)
  assert.match(page, /setPluginDeclaredInputs/)
})

// ── Top-level seam: a SubDesign action, end to end ──────────────────────
// Issue 03 names this the highest test seam: start where the user starts
// (prepareSubDesignRun on a real brief + real vendor manifest), walk the real
// trust path, and hand the produced request to the Host stage. Nothing here
// re-implements the pipeline or substitutes renderer local state.

const VENDOR_PLUGIN = 'plugins/_official/video-templates/frame-bold-poster'

/** Fake only the host bridges — never the logic under test. */
async function withSubDesignHost<T>(
  projectRoot: string,
  fn: (store: { snapshots: unknown[] }) => Promise<T>,
): Promise<T> {
  const host = globalThis as unknown as { window?: unknown; fetch?: typeof fetch }
  const priorWindow = host.window
  const priorFetch = host.fetch
  const store = { snapshots: [] as unknown[] }
  const vendorRoot = path.join(appRoot, 'public/open-design')

  host.fetch = (async (url: string) => {
    const relative = String(url).replace(/^\/open-design\//, '')
    const target = path.join(vendorRoot, relative)
    if (!target.startsWith(vendorRoot) || !fs.existsSync(target)) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(target, 'utf8')) }
  }) as unknown as typeof fetch

  host.window = { subagents: { subdesign: {
    writeMetadata: async (input: { kind: string; payload: { pluginId?: string } }) => {
      if (input.kind === 'open-design-snapshot') {
        const at = store.snapshots.findIndex((item) => (item as { pluginId: string }).pluginId === input.payload.pluginId)
        if (at >= 0) store.snapshots[at] = input.payload
        else store.snapshots.push(input.payload)
      }
      return { ok: true }
    },
    readMetadata: async () => ({
      ok: true, briefs: [], artifacts: [], critiques: [], exports: [],
      openDesignPacks: [], openDesignSnapshots: [...store.snapshots],
      openDesignProviderSettings: [], openDesignProviderRuns: [],
    }),
  } } }
  try { return await fn(store) } finally { host.window = priorWindow; host.fetch = priorFetch }
}

await test('SubDesign action drives the whole lifecycle: admission → trust → Host stage → settlement', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-e2e-'))
  try {
    await withSubDesignHost(projectRoot, async () => {
      const runId = 'run_e2e_1'
      const threadId = 'thread_e2e'
      const brief = {
        id: 'brief_e2e',
        threadId,
        surface: 'video' as const,
        objective: '產出一支開場影片。',
        stage: 'build' as const,
        directions: [],
        provenance: [{
          source: 'open-design' as const,
          recordId: VENDOR_PLUGIN.replaceAll('/', ':'),
          sourcePath: VENDOR_PLUGIN,
          sourceUrl: 'https://open-design.ai/zh/plugins/',
          upstreamCommit: 'b032abed00ab4fde9bc6691b27206728c929597e',
          digest: 'd'.repeat(64),
          licensePaths: [],
          indexedAt: new Date().toISOString(),
        }],
      } as unknown as Parameters<typeof prepareSubDesignRun>[0]['brief']

      // 1. Never adopted: the run is blocked and no snapshot is written.
      const first = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.equal(first.overrides, undefined)
      assert.equal(first.trust?.state, 'adopt-required')

      // 2. Adopting is the user's explicit act; sensitive capabilities stay denied.
      assert.ok(first.trust?.state === 'adopt-required')
      await adoptPluginSnapshot(first.trust.candidate, projectRoot)
      const second = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.equal(second.overrides, undefined)
      assert.equal(second.trust?.state, 'grant-required')
      assert.ok(second.trust?.state === 'grant-required' && second.trust.denied.includes('fs:write'))

      // 3. Grant through the real HITL ask, at thread scope.
      assert.ok(second.trust?.state === 'grant-required')
      const drain = setInterval(() => {
        const current = usePermissionAskStore.getState().current
        if (current) usePermissionAskStore.getState().resolve(current.id, 'allow')
      }, 5)
      try {
        const outcome = await requestCapabilityGrants({
          snapshot: second.trust.snapshot, scope: { threadId }, projectRoot,
        })
        assert.deepEqual(outcome.denied, [])
      } finally { clearInterval(drain) }

      // 4. Now the SubDesign action produces a request for runTask.
      const ready = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.ok(ready.overrides, ready.blockedReason)
      assert.equal(ready.trust?.state, 'trusted')
      const request = ready.overrides.subDesignPluginExecution
      assert.equal(request.schemaVersion, 1)
      assert.equal(request.briefId, 'brief_e2e')
      assert.equal(request.providerId, 'fake-pipeline')
      assert.equal(request.stageId, 'compose')

      // 5. That exact request — not a hand-built one — runs on the Host.
      const states: string[] = []
      const projection = await executeSubDesignProviderStage({
        request, runId, threadId, projectRoot, onEvent: (event) => states.push(event.state),
      })
      assert.equal(projection.state, 'completed')
      assert.deepEqual(states, ['queued', 'running', 'completed'])
      assert.ok(projection.evidenceLocator && fs.existsSync(path.join(projectRoot, projection.evidenceLocator)))
      assert.ok(projection.artifactLocator && fs.existsSync(path.join(projectRoot, projection.artifactLocator)))
      assert.equal(projection.artifact?.briefId, 'brief_e2e')

      // 6. The preview can be rebuilt from the Host projection alone.
      assert.equal(projection.stream?.status, 'complete')
      assert.equal(projection.stream?.artifactKind, 'html')
      assert.equal(projection.stream?.artifactId, projection.artifact?.id)
      const previewContent = reconcileUpdates(projection.stream?.updates ?? [])
        .map((update) => update.content || '')
        .join('')
      assert.match(previewContent, /<!doctype html>/i)

      // 7. Provider success is not DoD met.
      assert.equal(shouldStopForProviderProjection(projection), false)
      assert.ok(!('dodMet' in projection))
    })
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

await test('a revoked grant blocks the next SubDesign action, and the Host refuses a stale request', async () => {
  const projectRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'subdesign-e2e-revoke-'))
  try {
    await withSubDesignHost(projectRoot, async () => {
      const runId = 'run_e2e_2'
      const threadId = 'thread_e2e_2'
      const brief = {
        id: 'brief_e2e_2', threadId, surface: 'video' as const, objective: 'x', stage: 'build' as const, directions: [],
        provenance: [{
          source: 'open-design' as const, recordId: VENDOR_PLUGIN.replaceAll('/', ':'), sourcePath: VENDOR_PLUGIN,
          sourceUrl: '', upstreamCommit: '', digest: 'd'.repeat(64), licensePaths: [], indexedAt: new Date().toISOString(),
        }],
      } as unknown as Parameters<typeof prepareSubDesignRun>[0]['brief']

      const first = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.ok(first.trust?.state === 'adopt-required')
      await adoptPluginSnapshot(first.trust.candidate, projectRoot)
      const blocked = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.ok(blocked.trust?.state === 'grant-required')

      const drain = setInterval(() => {
        const current = usePermissionAskStore.getState().current
        if (current) usePermissionAskStore.getState().resolve(current.id, 'allow')
      }, 5)
      let granted
      try {
        granted = await requestCapabilityGrants({ snapshot: blocked.trust.snapshot, scope: { threadId }, projectRoot })
      } finally { clearInterval(drain) }
      const ready = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.ok(ready.overrides)
      const staleRequest = ready.overrides.subDesignPluginExecution

      // Revoke, then try again: the renderer blocks...
      await revokePluginGrants(granted.snapshot, projectRoot)
      const afterRevoke = await prepareSubDesignRun({ brief, runId, projectRoot })
      assert.equal(afterRevoke.overrides, undefined)
      assert.equal(afterRevoke.trust?.state, 'grant-required')

      // ...and the Host independently refuses the request captured before the
      // revoke, so a stale snapshot cannot be replayed past the gate.
      const stale = { ...staleRequest, snapshot: { ...staleRequest.snapshot, grantedCapabilities: [], grantScope: undefined } }
      const projection = await executeSubDesignProviderStage({ request: stale, runId, threadId, projectRoot })
      assert.equal(projection.state, 'blocked')
      assert.match(projection.summary, /Capability denied/)
    })
  } finally {
    await fsPromises.rm(projectRoot, { recursive: true, force: true })
  }
})

console.log(`\n${passed}/${total} tests passed`)
if (process.exitCode) console.error('Smoke failed'); else console.log('OK')
