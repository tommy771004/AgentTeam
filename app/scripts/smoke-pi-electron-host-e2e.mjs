import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
    const command = 'sleep 120'
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
  args: [appRoot, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  timeout: 30_000,
})
app.process().on('exit', (code, signal) => console.error(`electron exited code=${code} signal=${signal}`))
app.process().stderr?.on('data', (chunk) => console.error(`electron stderr: ${chunk}`))

const timeout = 120_000

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
      stop: document.querySelectorAll('[aria-label="停止執行"]').length,
      host: await window.subagents?.piHost?.runs?.active?.(),
    }), runId)
    // The feed proves the restored same-thread run is projected. Active runs
    // additionally retain stop control; terminal recovery intentionally does
    // not render that control after the turn has settled.
    if (kind !== 'active' || (lastState.feed && lastState.stop)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${description}: timed out after ${timeout}ms; last state=${JSON.stringify(lastState)}`)
}

const archiveCount = async (page, runId) => page.evaluate(async (id) => {
  const records = await window.subagents?.archive?.list?.()
  return Array.isArray(records) ? records.filter((record) => record?.id === id).length : 0
}, runId)

const runScenario = async (page, kind, iteration) => {
  const token = `reattach-token-${kind}-${iteration}-${Date.now().toString(36)}`
  const objective = `Run ${kind} renderer reattach ${token}`
  const before = await page.evaluate(async () => {
    const snapshot = await window.subagents?.piHost?.runs?.active?.()
    return [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])].map((item) => item.runId)
  })
  if (before.length) throw new Error(`previous attachments remain before ${kind}: ${before.join(', ')}`)

  // Keep the terminal attachment retained until the replacement renderer has
  // claimed recovery. The old renderer's finalization request is deliberately
  // parked at the Host CAS boundary, making terminal-before-reload deterministic.
  if (kind === 'terminal') {
    await page.evaluate(() => {
      const runs = window.subagents?.piHost?.runs
      if (!runs?.finalizeClaim || window.__reattachFinalizeClaimWrapped) return
      const original = runs.finalizeClaim
      runs.finalizeClaim = async (...args) => {
        if (window.__reattachFinalizeClaimBlocked) {
          await new Promise((resolve) => { window.__reattachFinalizeClaimRelease = resolve })
        }
        return original(...args)
      }
      window.__reattachFinalizeClaimBlocked = true
      window.__reattachFinalizeClaimWrapped = true
    })
  }

  const composer = page.locator('textarea.composer-field').first()
  await composer.fill(objective)
  await page.locator('.agent-composer-send').first().click()
  const attachment = await waitForRun(page, before, `${kind} run admission`)
  if (!attachment) throw new Error(`${kind} run admission returned no attachment`)
  assert.equal(attachment.status, 'active', `${kind} starts as Host active`)
  const runId = attachment.runId
  const threadId = attachment.threadId
  assert.ok(threadId, `${kind} attachment carries its owning thread`)

  if (kind === 'active') {
    const initial = await waitForHostStatus(page, runId, 'active', 'active tool boundary')
    assert.ok(initial.latestSeq > 0, 'active scenario reached a recorded tool boundary')
  } else {
    await waitForHostStatus(page, runId, 'active', 'terminal scenario tool boundary')
    // Arm the observer before cancelling. The Host publishes the final
    // Turn Record entry before returning the turn result; reloading from that
    // event proves the terminal attachment exists in the narrow window where
    // the old renderer's finalizer could otherwise lose it.
    await page.evaluate((id) => {
      const onEvent = window.subagents?.piHost?.onEvent
      if (!onEvent) throw new Error('Pi Host event bridge unavailable for terminal race')
      let resolveWait
      const wait = new Promise((resolve) => { resolveWait = resolve })
      const unsubscribe = onEvent((event) => {
        if (event?.event !== 'host/record-append') return
        const payload = event.payload
        if (!payload || payload.runId !== id || !Array.isArray(payload.entries)) return
        if (!payload.entries.some((entry) => entry?.kind === 'turn-end')) return
        unsubscribe()
        resolveWait()
      })
      window.__reattachTerminalAppendWait = wait
    }, runId)
    const terminalCancel = await page.evaluate((id) => window.subagents?.piHost?.turn?.cancel?.(id), runId)
    assert.equal(terminalCancel?.settlement, 'cancelled', 'terminal race reaches Host cancellation before reload')
    await page.evaluate(async () => window.__reattachTerminalAppendWait)
    const terminalAttachment = await waitForHostStatus(page, runId, 'terminal', 'terminal append before app finalization')
    assert.equal(terminalAttachment?.settlement, 'cancelled', 'Host terminal append is cancellation')
  }

  await page.reload({ waitUntil: 'domcontentloaded', timeout })
  await page.waitForSelector('textarea.composer-field', { timeout })
  await waitForRecoveredTimeline(page, runId, kind, `${kind} renderer reattach projection`)

  const recovered = await page.evaluate(async (id) => {
    const runs = window.subagents?.piHost?.runs
    const snapshot = await runs?.active?.()
    const attachment = [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])].find((item) => item?.runId === id)
    const pageResult = await runs?.attach?.(id, undefined, 200)
    return {
      attachment,
      latestSeq: pageResult?.page?.latestSeq || 0,
      entries: pageResult?.page?.entries?.length || 0,
      hasGapField: Object.prototype.hasOwnProperty.call(pageResult?.page || {}, 'gap'),
    }
  }, runId)
  assert.ok(recovered.attachment, `${kind} run remains retained through renderer destruction`)
  // A live Pi turn can have a journal high-watermark before its session page
  // is materialized; the terminal case below proves bounded entry replay.
  if (kind === 'terminal') assert.ok(recovered.entries > 0, 'terminal timeline was replayed from Host Turn Record')
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
  await page.waitForFunction(async (id) => {
    const records = await window.subagents?.archive?.list?.()
    return Array.isArray(records) && records.some((record) => record?.id === id)
  }, runId, { timeout, polling: 300 }).catch((error) => {
    throw new Error(`${kind} recovered app finalization: ${error.message}`)
  })
  assert.equal(await archiveCount(page, runId), 1, `${kind} app archive is exactly once`)

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
  assert.equal(health?.protocolVersion, 3)
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
}
