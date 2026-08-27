import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const runScenario = async (mode: 'cancel' | 'interrupt') => {
  const agentDir = await mkdtemp(join(tmpdir(), `pi-preflight-${mode}-agent-`))
  const stateDir = await mkdtemp(join(tmpdir(), `pi-preflight-${mode}-state-`))
  const workspace = await mkdtemp(join(tmpdir(), `pi-preflight-${mode}-workspace-`))
  const skillDir = join(agentDir, 'skills', 'stop-replay-write')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), `---
name: stop-replay-write
description: Intercept the original write before stop
version: 1
preflight-tools: write
---
Use a fresh call identity after this revision is injected.
`)
  await writeFile(join(workspace, 'sibling.txt'), 'original\n')

  let completion = 0
  const requests: Array<Record<string, any>> = []
  const modelServer = createServer(async (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (part) => { body += part })
    await once(request, 'end')
    requests.push(JSON.parse(body))
    completion += 1
    if (completion === 2) {
      await new Promise<void>((done) => response.once('close', done))
      return
    }
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
      id: `${mode}-${completion}`,
      object: 'chat.completion.chunk',
      model: 'smoke-model',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
    if (completion === 1 || completion === 3) {
      response.write(chunk({ role: 'assistant', tool_calls: [
        {
          index: 0, id: 'call_stopped_write', type: 'function',
          function: { name: 'write', arguments: JSON.stringify({ path: 'result.txt', content: 'must-not-run\n' }) },
        },
        {
          index: 1, id: 'call_stopped_edit', type: 'function',
          function: { name: 'edit', arguments: JSON.stringify({ path: 'sibling.txt', edits: [{ oldText: 'original\n', newText: 'must-not-run\n' }] }) },
        },
      ] }, null))
      response.write(chunk({}, 'tool_calls'))
    } else {
      response.write(chunk({ role: 'assistant', content: `${mode} replay stayed blocked.` }, null))
      response.write(chunk({}, 'stop'))
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
  const address = modelServer.address()
  if (!address || typeof address === 'string') throw new Error(`${mode} model fixture did not bind`)
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'test-key',
    models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 8_192, maxTokens: 256 }],
  } } }))
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

  const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const messages: Array<Record<string, any>> = []
  let stdout = ''
  host.stdout.on('data', (buffer) => {
    stdout += String(buffer)
    for (;;) {
      const newline = stdout.indexOf('\n')
      if (newline < 0) break
      const line = stdout.slice(0, newline).trim()
      stdout = stdout.slice(newline + 1)
      if (line) messages.push(JSON.parse(line))
    }
  })
  const waitFor = async (id: number) => {
    const timeoutAt = Date.now() + 20_000
    for (;;) {
      const found = messages.find((message) => message.id === id)
      if (found) return found
      if (Date.now() > timeoutAt) throw new Error(`${mode} timeout waiting for ${id}`)
      await new Promise((done) => setTimeout(done, 10))
    }
  }
  const waitForRequests = async (count: number) => {
    const timeoutAt = Date.now() + 20_000
    while (requests.length < count) {
      if (Date.now() > timeoutAt) throw new Error(`${mode} timeout waiting for model request ${count}`)
      await new Promise((done) => setTimeout(done, 10))
    }
  }
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

  try {
    send(1, 'initialize', { protocolVersion: 2 })
    assert.equal((await waitFor(1)).error, undefined)
    send(2, 'sessions/create', { title: `Skill ${mode} replay` })
    const sessionId = String((await waitFor(2)).result?.sessionId)
    const profile = { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', activeTools: ['write', 'edit'], approvalMode: 'full', unattended: false, compaction: 'manual' }
    send(3, 'turn/submit', { sessionId, runId: `${mode}-blocked-run`, cwd: workspace, prompt: 'Attempt the intercepted batch.', profile })
    await waitForRequests(2)
    send(4, mode === 'cancel' ? 'turn/cancel' : 'turn/interrupt', {
      runId: `${mode}-blocked-run`, ...(mode === 'interrupt' ? { reason: 'user' } : {}),
    })
    assert.equal((await waitFor(4)).error, undefined)
    assert.equal((await waitFor(3)).result?.settlement, mode === 'cancel' ? 'cancelled' : 'interrupted')
    await rm(skillDir, { recursive: true, force: true })

    send(5, 'turn/submit', { sessionId, runId: `${mode}-replay-run`, cwd: workspace, prompt: 'Replay the old transport identities.', profile })
    const replay = await waitFor(5)
    assert.equal(replay.error, undefined)
    assert.equal(replay.result?.settlement, 'answered')
    assert.equal(await readFile(join(workspace, 'sibling.txt'), 'utf8'), 'original\n')
    await assert.rejects(() => readFile(join(workspace, 'result.txt')), /ENOENT/)
    const replayResults = (replay.result?.record?.entries || []).filter((entry: any) =>
      entry.kind === 'tool-result' && ['call_stopped_write', 'call_stopped_edit'].includes(entry.callId) && entry.turn === 2)
    assert.equal(replayResults.length, 2)
    assert.ok(replayResults.every((entry: any) => entry.settlement === 'not-executed' && /identity conflict/i.test(String(entry.detail))))
  } finally {
    host.stdin.end()
    if (host.exitCode === null) await once(host, 'exit').catch(() => host.kill())
    modelServer.close()
    await Promise.all([rm(agentDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
  }
}

await runScenario('cancel')
await runScenario('interrupt')
console.log('Cancelled and interrupted Skill interceptions keep original-call tombstones across later replay')
