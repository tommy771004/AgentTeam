import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExecutable = path.join(
  appRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron',
)
if (!fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) {
  throw new Error('Run npm run build before the Pi Electron Host E2E')
}

const { _electron: electron } = await import('playwright')
const userDataDir = path.join(os.tmpdir(), `subagents-ai-pi-host-e2e-${process.pid}`)
fs.rmSync(userDataDir, { recursive: true, force: true })
// Electron's `--user-data-dir` is a Chromium profile switch and does not
// reliably change app.getPath('userData') on every platform. Launch through a
// tiny disposable package that sets the app path before importing the real
// production main module, so the E2E cannot observe or mutate a developer's
// profile and every run starts with an empty Host journal.
const launcherDir = path.join(os.tmpdir(), `subagents-ai-pi-host-e2e-launcher-${process.pid}`)
fs.rmSync(launcherDir, { recursive: true, force: true })
fs.mkdirSync(launcherDir, { recursive: true })
const finalizeGatePath = path.join(launcherDir, 'finalize-claim-gate.json')
const finalizeGateMarkerPath = path.join(launcherDir, 'finalize-claim-gate-consumed.json')
const replacementFinalizeGateMarkerPath = path.join(launcherDir, 'finalize-claim-gate-replacement-consumed.json')
const finalizeGateReleasePath = path.join(launcherDir, 'finalize-claim-gate-release.json')
fs.writeFileSync(path.join(launcherDir, 'package.json'), JSON.stringify({
  name: 'subagents-ai-pi-host-e2e-launcher',
  private: true,
  type: 'module',
  main: 'launcher.mjs',
}))
fs.writeFileSync(path.join(launcherDir, 'launcher.mjs'), [
  "import { app, ipcMain } from 'electron'",
  "import fs from 'node:fs'",
  `const finalizeClaimChannel = 'pi-host:runs:finalize-claim'`,
  `const finalizeGatePath = ${JSON.stringify(finalizeGatePath)}`,
  `const finalizeGateMarkerPath = ${JSON.stringify(finalizeGateMarkerPath)}`,
  `const replacementFinalizeGateMarkerPath = ${JSON.stringify(replacementFinalizeGateMarkerPath)}`,
  `const finalizeGateReleasePath = ${JSON.stringify(finalizeGateReleasePath)}`,
  'const realIpcMainHandle = ipcMain.handle.bind(ipcMain)',
  'let activeGateId = null',
  'let gatePhase = 0',
  'ipcMain.handle = (channel, handler) => {',
  '  if (channel !== finalizeClaimChannel) return realIpcMainHandle(channel, handler)',
  '  return realIpcMainHandle(channel, async (event, runId, claimantId, leaseMs) => {',
  '    let gate',
  '    try { gate = JSON.parse(fs.readFileSync(finalizeGatePath, \'utf8\')) } catch {}',
    '    if (gate?.gateId !== activeGateId) {',
  '      activeGateId = gate?.gateId || null',
  '      gatePhase = 0',
  '    }',
  '    if (gate?.armed && gatePhase === 0 && gate.runId === runId) {',
  '      gatePhase = 1',
  '      fs.writeFileSync(finalizeGateMarkerPath, JSON.stringify({',
  '        gateId: gate.gateId, runId, claimantId, leaseMs, consumedAt: Date.now(),',
  '      }))',
  '      await new Promise(() => {})',
  '    }',
  '    if (gate?.armed && gatePhase === 1 && gate.runId === runId) {',
  '      gatePhase = 2',
  '      fs.writeFileSync(replacementFinalizeGateMarkerPath, JSON.stringify({',
  '        gateId: gate.gateId, runId, claimantId, leaseMs, consumedAt: Date.now(),',
  '      }))',
  '      while (!fs.existsSync(finalizeGateReleasePath)) await new Promise((resolve) => setTimeout(resolve, 25))',
  '    }',
  '    return handler(event, runId, claimantId, leaseMs)',
  '  })',
  '}',
  `app.setPath('userData', ${JSON.stringify(userDataDir)})`,
  `await import(${JSON.stringify(pathToFileURL(path.join(appRoot, 'dist-electron', 'main.js')).href)})`,
  '',
].join('\n'))
fs.rmSync(finalizeGatePath, { force: true })
fs.rmSync(finalizeGateMarkerPath, { force: true })
fs.rmSync(replacementFinalizeGateMarkerPath, { force: true })
fs.rmSync(finalizeGateReleasePath, { force: true })

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`
const modelTurns = new Map()
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  const body = await new Promise((resolve) => {
    let raw = ''
    request.on('data', (part) => { raw += part })
    request.on('end', () => resolve(raw))
  })
  let parsed
  try { parsed = JSON.parse(body) } catch { parsed = {} }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  // The Host sends the full session on every turn. Always key the fixture by
  // the latest user message; using the first one reuses an earlier scenario's
  // token and skips the tool boundary on the second run.
  const lastUserIndex = messages.findLastIndex((item) => item?.role === 'user')
  const promptContent = lastUserIndex >= 0 ? messages[lastUserIndex]?.content || '' : ''
  const prompt = typeof promptContent === 'string' ? promptContent : JSON.stringify(promptContent)
  const tokenMatches = String(prompt).match(/reattach-token-[a-z0-9-]+/g) || []
  const token = tokenMatches.at(-1) || 'unknown'
  const callCount = modelTurns.get(token) || 0
  modelTurns.set(token, callCount + 1)
  // Prior turns remain in the session context. Only a tool result after this
  // turn's user message means the current request has crossed its tool boundary.
  const hasToolResult = messages.slice(lastUserIndex + 1).some((item) => item?.role === 'tool' || item?.tool_call_id)
  const id = `reattach-${token}-${callCount}`
  const chunk = (delta, finish = null) => sse({
    id,
    object: 'chat.completion.chunk',
    model: 'reattach-smoke-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    connection: 'keep-alive',
    'cache-control': 'no-cache',
  })
  if (!hasToolResult && callCount === 0) {
    // Bash is a real Host-owned builtin and deliberately remains in-flight
    // until the scenario observes the attachment and chooses its transition.
    // Both scenarios use a real Host-owned long-running tool. The active case
    // cancels after reattachment; the terminal case cancels while the original
    // renderer is still attached so the terminal-before-finalization boundary
    // can be observed and claimed deterministically.
    // Keep the active reattach case alive longer than the bounded E2E timeout;
    // otherwise a missed projection can turn into a natural terminal answer
    // at exactly the same moment the diagnostic wait expires.
    const command = 'sleep 600'
    response.write(chunk({ role: 'assistant', content: '我先執行一個可觀測的工具。' }))
    response.write(chunk({ tool_calls: [{
      index: 0,
      id: `call_${token}`,
      type: 'function',
      function: { name: 'bash', arguments: JSON.stringify({ command }) },
    }] }))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: `reattach result ${token}` }))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve))
const modelAddress = modelServer.address()
if (!modelAddress || typeof modelAddress === 'string') throw new Error('Loopback model server did not bind')

// Pi Host resolves its app-owned agent directory from Electron userData. This
// is a real model endpoint, not a mocked Host or renderer bridge.
const piAgentDir = path.join(userDataDir, 'pi-agent')
fs.mkdirSync(piAgentDir, { recursive: true })
fs.writeFileSync(path.join(piAgentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
      api: 'openai-completions',
      apiKey: 'reattach-test-key',
      models: [{ id: 'reattach-smoke-model', name: 'Reattach Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
fs.writeFileSync(path.join(piAgentDir, 'settings.json'), JSON.stringify({
  defaultProvider: 'loopback',
  defaultModel: 'reattach-smoke-model',
  defaultThinkingLevel: 'off',
}))

const app = await electron.launch({
  executablePath: electronExecutable,
  args: [launcherDir, '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, SUBAGENTS_PI_HOST_E2E_USER_DATA_DIR: userDataDir },
  timeout: 30_000,
})
app.process().on('exit', (code, signal) => console.error(`electron exited code=${code} signal=${signal}`))
app.process().stderr?.on('data', (chunk) => console.error(`electron stderr: ${chunk}`))

const configuredTimeout = Number(process.env.PI_HOST_E2E_TIMEOUT_MS)
const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? Math.max(1_000, configuredTimeout)
  : 120_000

const armFinalizeClaimGate = (runId, gateId) => {
  fs.rmSync(finalizeGateMarkerPath, { force: true })
  fs.rmSync(replacementFinalizeGateMarkerPath, { force: true })
  fs.rmSync(finalizeGateReleasePath, { force: true })
  fs.writeFileSync(finalizeGatePath, JSON.stringify({
    armed: true,
    gateId,
    runId,
    armedAt: Date.now(),
  }))
}

const waitForFinalizeClaimGate = async (runId, gateId, markerPath = finalizeGateMarkerPath) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
      if (marker?.gateId === gateId && marker?.runId === runId) return marker
    } catch {
      // The launcher writes this marker synchronously immediately before it
      // parks the old renderer's request; polling keeps that boundary explicit.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`finalizeClaim launcher gate was not consumed for ${runId}`)
}

const releaseFinalizeClaimGate = (runId, gateId) => {
  fs.writeFileSync(finalizeGateReleasePath, JSON.stringify({ gateId, runId, releasedAt: Date.now() }))
}

const waitForRun = async (page, knownRunIds, description) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = await page.evaluate(async (known) => {
      try {
        const snapshot = await window.subagents?.piHost?.runs?.active?.()
        const all = [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])]
        return all.find((item) => item?.runId && !known.includes(item.runId)) || null
      } catch {
        return null
      }
    }, [...knownRunIds])
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${description}: timed out after ${timeout}ms`)
}

const waitForHostStatus = async (page, runId, status, description) => {
  await page.waitForFunction(async ({ id, wanted }) => {
    try {
      const snapshot = await window.subagents?.piHost?.runs?.active?.()
      const all = [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])]
      return all.find((item) => item?.runId === id && item?.status === wanted) || null
    } catch {
      return false
    }
  }, { id: runId, wanted: status }, { timeout, polling: 200 }).catch((error) => {
    throw new Error(`${description}: ${error.message}`)
  })
  return page.evaluate(async (id) => {
    const snapshot = await window.subagents?.piHost?.runs?.active?.()
    const all = [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])]
    return all.find((item) => item?.runId === id) || null
  }, runId)
}

const waitForRecoveredTimeline = async (page, runId, kind, description) => {
  const deadline = Date.now() + timeout
  let lastState = null
  while (Date.now() < deadline) {
    lastState = await page.evaluate(async (id) => ({
      feed: document.querySelectorAll('.agent-process-feed').length,
      projectedRecordEntries: Number(
        [...document.querySelectorAll('.agent-process-feed')]
          .find((element) => element.getAttribute('data-run-id') === id)
          ?.getAttribute('data-record-count') || 0,
      ),
      recordTimeline: document.querySelectorAll('[data-run-timeline="record"]').length,
      stop: document.querySelectorAll('[aria-label="停止執行"]').length,
      host: await window.subagents?.piHost?.runs?.active?.(),
    }), runId)
    // The feed proves the restored same-thread run is projected. Active runs
    // additionally retain stop control. A terminal turn cancelled before its
    // first assistant/tool row can have a valid Host record whose visible
    // timeline is empty, so terminal recovery is proven by the renderer's
    // run-scoped record projection rather than by a row container.
    const timelineReady = kind === 'active'
      ? lastState.feed && lastState.stop
      : lastState.projectedRecordEntries > 0
    if (timelineReady) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  lastState.attached = await page.evaluate(async (id) => (
    window.subagents?.piHost?.runs?.attach?.(id, undefined, 200).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }))
  ), runId)
  throw new Error(`${description}: timed out after ${timeout}ms; last state=${JSON.stringify(lastState)}`)
}

const startScenario = async (page, kind, iteration) => {
  const token = `reattach-token-${kind}-${iteration}-${Date.now().toString(36)}`
  const objective = `Run ${kind} renderer reattach ${token}`
  const before = await page.evaluate(async () => {
    const snapshot = await window.subagents?.piHost?.runs?.active?.()
    return [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])].map((item) => item.runId)
  })
  if (before.length) throw new Error(`previous attachments remain before ${kind}: ${before.join(', ')}`)
  await page.locator('textarea.composer-field').first().fill(objective)
  await page.locator('.agent-composer-send').first().click()
  const attachment = await waitForRun(page, before, `${kind} run admission`)
  if (!attachment) throw new Error(`${kind} run admission returned no attachment`)
  return { attachment, token }
}

const readRecoveredRun = async ({ id, sessionId }) => {
  const runs = window.subagents.piHost.runs
  const { activeRuns = [], terminalRuns = [] } = await runs.active()
  const attachment = [...activeRuns, ...terminalRuns].find((item) => item.runId === id)
  const { page: attachedPage } = await runs.attach(id, undefined, 200)
  let page = attachedPage
  if (!attachment) {
    const recordResult = await window.subagents.piHost.sessions.record(sessionId, undefined, 200)
    page = recordResult.page
  }
  const entries = page?.entries ?? []
  const entryMaxSeq = entries.reduce((max, entry) => Math.max(max, entry.seq || 0), 0)
  return {
    attachment,
    attachedPageLatestSeq: attachedPage?.latestSeq || 0,
    attachmentLatestSeq: attachment?.latestSeq || 0,
    entryMaxSeq,
    latestSeq: Math.max(page?.latestSeq || 0, attachment?.latestSeq || 0, entryMaxSeq),
    entries: entries.length,
    hasGapField: Object.prototype.hasOwnProperty.call(page || {}, 'gap'),
  }
}

const runScenario = async (page, kind, iteration) => {
  const { attachment, token } = await startScenario(page, kind, iteration)
  assert.equal(attachment.status, 'active', `${kind} starts as Host active`)
  const runId = attachment.runId
  const threadId = attachment.threadId
  assert.ok(threadId, `${kind} attachment carries its owning thread`)
  let terminalGateId
  let oldGateMarker

  if (kind === 'active') {
    const initial = await waitForHostStatus(page, runId, 'active', 'active tool boundary')
    assert.ok(initial.latestSeq > 0, 'active scenario reached a recorded tool boundary')
  } else {
    await waitForHostStatus(page, runId, 'active', 'terminal scenario tool boundary')
    // The disposable launcher wraps the real main-process registration before
    // production main.js is imported. Arm it only for this terminal run: the
    // first matching old-renderer claim is parked forever, while every later
    // claim reaches the real Host CAS in the replacement renderer.
    const gateId = `${kind}-${iteration}-${token}`
    terminalGateId = gateId
    armFinalizeClaimGate(runId, gateId)
    // The Host publishes the turn-end record before the attachment settles.
    // Observe that event while cancellation is still an in-flight IPC request.
    // The launcher marker below then makes the renderer-destruction boundary
    // deterministic, leaving the Host terminal record for the replacement
    // renderer's RecoveryBootstrap.
    console.log('[e2e] terminal gateState start');
    const gateState = await page.evaluate((id) => {
      const onEvent = window.subagents?.piHost?.onEvent
      if (!onEvent) throw new Error('Pi Host event bridge unavailable for terminal race')
      const gate = { status: 'waiting', runId: id }
      window.__reattachTerminalGate = gate
      let unsubscribe
      unsubscribe = onEvent((event) => {
        if (event?.event !== 'host/record-append') return
        const payload = event.payload
        if (!payload || payload.runId !== id || !Array.isArray(payload.entries)) return
        if (!payload.entries.some((entry) => entry?.kind === 'turn-end')) return
        unsubscribe?.()
        // The Node side waits for this boundary and the launcher consumption
        // marker before reloading, so the old claim is observably parked.
        gate.status = 'turn-end'
      })
      return { status: gate.status, runId: gate.runId }
    }, runId)
    assert.equal(gateState.status, 'waiting', 'terminal turn-end listener is installed before cancellation')
    // Do not await cancellation before observing the terminal append: the
    // cancellation response is downstream of the record event and would
    // otherwise let the original renderer finalize first.
    console.log('[e2e] terminalCancel start', runId);
    const terminalCancel = page.evaluate(async (id) => {
      try {
        return { result: await window.subagents?.piHost?.turn?.cancel?.(id) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }, runId)
    console.log('[e2e] waitFor turn-end start');
    await page.waitForFunction(
      () => window.__reattachTerminalGate?.status === 'turn-end',
      undefined,
      { timeout, polling: 100 },
    )
    console.log('[e2e] waitFor old gate start');
    const gateMarker = await waitForFinalizeClaimGate(runId, gateId)
    oldGateMarker = gateMarker
    assert.equal(gateMarker?.runId, runId, 'launcher gate consumed this terminal run')
    console.log('[e2e] waitFor terminal status start');
    const terminalAttachment = await waitForHostStatus(page, runId, 'terminal', 'terminal append before renderer reload')
    assert.equal(terminalAttachment?.settlement, 'cancelled', `Host terminal append is cancellation: ${JSON.stringify(terminalAttachment)}`)
    // The turn-end listener established the renderer-destruction boundary;
    // reload only after the launcher proves the old claim is parked.
    console.log('[e2e] terminal reload start');
    await page.reload({ waitUntil: 'domcontentloaded', timeout })
    console.log('[e2e] terminal reload done');
    console.log('[e2e] waitForSelector after terminal reload start');
    await page.waitForSelector('textarea.composer-field', { timeout })
    console.log('[e2e] waitForSelector after terminal reload done');
    console.log('[e2e] awaiting terminalCancel');
    const cancelOutcome = await terminalCancel
    console.log('[e2e] terminalCancel outcome', cancelOutcome)
    if (cancelOutcome.error && !/context|target|closed|navigation/i.test(cancelOutcome.error)) {
      throw new Error(`terminal Host cancellation transport failed: ${cancelOutcome.error}`)
    }
  }

  if (kind === 'active') {
    console.log('[e2e] active reload start');
    await page.reload({ waitUntil: 'domcontentloaded', timeout })
    console.log('[e2e] active reload done');
    await page.waitForSelector('textarea.composer-field', { timeout })
    console.log('[e2e] active waitForSelector done');
  }
  console.log(`[e2e] waitForRecoveredTimeline ${kind} start`, runId);
  await waitForRecoveredTimeline(page, runId, kind, `${kind} renderer reattach projection`)
  console.log(`[e2e] waitForRecoveredTimeline ${kind} done`)

  if (kind === 'terminal') {
    // RecoveryBootstrap restores the Host record and renderer timeline before
    // awaiting its finalization claim. The launcher parks that replacement
    // claim too, making the proof observable instead of racing an immediate
    // finalize → ack → prune sequence.
    console.log('[e2e] waitFor replacement gate start');
    const replacementGateMarker = await waitForFinalizeClaimGate(
      runId,
      terminalGateId,
      replacementFinalizeGateMarkerPath,
    )
    assert.equal(replacementGateMarker?.runId, runId, 'replacement launcher gate consumed this terminal run')
    assert.notEqual(
      replacementGateMarker?.claimantId,
      oldGateMarker?.claimantId,
      'replacement RecoveryBootstrap uses a new finalization claimant',
    )
    releaseFinalizeClaimGate(runId, terminalGateId)
  }

  // RecoveryBootstrap may already have completed the replacement claim and
  // acked the terminal attachment by the time the page is ready. The Host
  // Turn Record remains durable, so read it directly for the record proof.
  const recovered = await page.evaluate(readRecoveredRun, { id: runId, sessionId: attachment.sessionId })
  assert.ok(kind === 'terminal' || recovered.attachment, `${kind} run remains retained through renderer destruction`)
  // A live Pi turn can have a journal high-watermark before its session page
  // is materialized; the terminal case below proves bounded entry replay.
  if (kind === 'terminal') assert.ok(recovered.entries > 0, 'terminal timeline was replayed from Host Turn Record')
  if (recovered.entries > 0) assert.ok(recovered.entryMaxSeq > 0, `${kind} Turn Record entries carry sequence numbers`)
  assert.ok(recovered.latestSeq > 0, `${kind} reattach carries a Turn Record high-watermark`)
  assert.equal(typeof recovered.hasGapField, 'boolean', `${kind} attach response has an explicit gap shape`)

  if (kind === 'active') {
    assert.equal(recovered.attachment.status, 'active', 'active run remains active after renderer reload')
    const stop = page.locator('[aria-label="停止執行"]')
    assert.equal(await stop.count(), 1, 'reattached run restores stop control')
    const cancel = await page.evaluate((id) => window.subagents?.piHost?.turn?.cancel?.(id), runId)
    assert.equal(cancel?.settlement, 'cancelled', 'cancel request reaches the real Pi Host')
    const cancelled = await waitForHostStatus(page, runId, 'terminal', 'cancel terminal')
    assert.equal(cancelled.settlement, 'cancelled', 'Host keeps cancellation terminal')
    const afterCancel = await page.evaluate(async (id) => window.subagents?.piHost?.runs?.attach?.(id, undefined, 200), runId)
    assert.ok((afterCancel?.page?.latestSeq || 0) > recovered.latestSeq, 'reattached stream receives subsequent terminal update')
    // The active reattach listener is observation-only; a second bootstrap is
    // the real terminal recovery path after the renderer that was attached to
    // the active run has already lost its turn promise.
    await page.reload({ waitUntil: 'domcontentloaded', timeout })
    await page.waitForSelector('textarea.composer-field', { timeout })
  }

  // Terminal bootstrap owns exactly-once app finalization and is the only path
  // allowed to release the retained Host attachment. The old renderer's
  // terminal race is gone with its context, so this is an honest cross-instance
  // finalization proof.
  const archiveRecords = await page.evaluate(async ({ id, waitMs }) => {
    const deadline = Date.now() + waitMs
    let records = []
    while (Date.now() < deadline) {
      records = await window.subagents?.archive?.list?.() || []
      if (Array.isArray(records) && records.some((record) => record?.id === id)) return records
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return records
  }, { id: runId, waitMs: timeout })
  const matchingArchives = Array.isArray(archiveRecords)
    ? archiveRecords.filter((record) => record?.id === runId)
    : []
  assert.equal(matchingArchives.length, 1, `${kind} app archive is exactly once; runId=${runId}; records=${JSON.stringify(archiveRecords)}`)

  await page.waitForFunction(async (id) => {
    const snapshot = await window.subagents?.piHost?.runs?.active?.()
    const all = [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])]
    return !all.some((item) => item?.runId === id)
  }, runId, { timeout, polling: 300 }).catch((error) => {
    throw new Error(`${kind} Host ack retention release: ${error.message}`)
  })
  return { runId, threadId, token }
}

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.agent-composer-send', { timeout })
  const health = await page.evaluate(async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = await window.subagents?.piHost?.status?.().catch(() => ({ state: 'error' }))
      if (status?.state === 'ready') return window.subagents?.piHost?.health?.()
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('Pi Core Host did not become ready in Electron')
  })
  assert.equal(health?.status, 'ready')
  // Protocol v4 remains backward-compatible with the v3 attachment contract;
  // the app may negotiate a newer protocol while this E2E still exercises
  // the same runs.active/attach/ack and finalization-claim surface.
  assert.ok(health?.protocolVersion >= 3, `Pi Host attachment protocol must be v3+ (got ${health?.protocolVersion})`)
  await page.evaluate(async () => {
    await window.subagents?.piHost?.settings?.update?.({
      approvalMode: 'full',
      unattended: true,
      bashRequireAsk: false,
      thinkingLevel: 'off',
    })
  })
  // Reload once after Host settings update so the renderer's own settings
  // projection sends the same approval profile on the coordinator path.
  await page.reload({ waitUntil: 'domcontentloaded', timeout })
  await page.waitForSelector('.agent-composer-send', { timeout })
  const sessions = await page.evaluate(() => window.subagents?.piHost?.sessions?.list?.())
  assert.ok(Array.isArray(sessions?.sessions))
  const extensions = await page.evaluate(() => window.subagents?.piHost?.extensions?.list?.())
  assert.ok(Array.isArray(extensions?.extensions))

  const repeats = Math.max(2, Number(process.env.PI_HOST_REATTACH_REPEATS || 2))
  for (let iteration = 0; iteration < repeats; iteration += 1) {
    await runScenario(page, 'active', iteration)
    await runScenario(page, 'terminal', iteration)
  }
  console.log(`Electron Pi Core Host renderer reattach E2E passed (${repeats} active + ${repeats} terminal cases)`)
} finally {
  await app.close().catch(() => {})
  modelServer.close()
  fs.rmSync(userDataDir, { recursive: true, force: true })
  fs.rmSync(launcherDir, { recursive: true, force: true })
}
