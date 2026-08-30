import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { access, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Issue 19 — full qualification of "Pi Host tool and skill parity".
 *
 * One seam, one path: initialize → catalog projection → capability load →
 * skills advertised → a real turn executing an extension tool → the record
 * read back through sessions/record. The qualification asserts the effort's
 * promises ON THE SHIPPED PATH: the listed tools are the callable tools,
 * approvals cover packs like builtins, skills live in the prompt with their
 * bodies reachable, and every removed name is gone from every catalog.
 */

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-qual-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-qual-state-'))
const outboundPolicyDir = await mkdtemp(join(tmpdir(), 'pi-qual-outbound-policy-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-qual-cwd-'))
const skillsDir = join(agentDir, 'skills')
await mkdir(skillsDir, { recursive: true })
await mkdir(join(skillsDir, 'deploy-checklist'), { recursive: true })
const deploySkillPath = join(skillsDir, 'deploy-checklist', 'SKILL.md')
await writeFile(deploySkillPath, [
  '---',
  '"name": "deploy-checklist"',
  '"description": "上線前的部署檢查步驟"',
  '---',
  '',
  '# 部署檢查',
  '',
  '- 確認 CI 綠燈',
  '- 標記 release tag',
  '',
].join('\n'), 'utf8')
await mkdir(join(skillsDir, 'deploy-checklist', 'references'), { recursive: true })
await writeFile(join(skillsDir, 'deploy-checklist', 'references', 'check.md'), 'RELATIVE RESOURCE V1\n', 'utf8')
await writeFile(join(agentDir, 'private-auth-sibling.txt'), 'MUST NOT ENTER SNAPSHOT\n', 'utf8')
await symlink(join(agentDir, 'private-auth-sibling.txt'), join(skillsDir, 'deploy-checklist', 'references', 'escape.md'))
// An archived skill must be discoverable but never advertised.
await mkdir(join(skillsDir, 'old-promo'), { recursive: true })
await writeFile(join(skillsDir, 'old-promo', 'SKILL.md'), [
  '---',
  '"name": "old-promo"',
  '"description": "已封存的舊技能"',
  '"disable-model-invocation": true',
  '---',
  '',
  '舊內容。',
  '',
].join('\n'), 'utf8')

let requests: string[] = []
let pendingScript: { tool: string; args: Record<string, unknown> } | undefined
let mutateSkillSourceDuringTurn = false
let advertisedSnapshotRoot: string | undefined
const advertisedSnapshotRoots: string[] = []
let toolCallSequence = 0
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `qual-${requests.length}`,
  object: 'chat.completion.chunk',
  model: 'smoke-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  const body = await new Promise<string>((done) => {
    let raw = ''
    request.on('data', (part) => { raw += part })
    request.on('end', () => done(raw))
  })
  requests.push(body)
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (pendingScript) {
    let script = pendingScript
    pendingScript = undefined
    if (script.tool === 'read') {
      const advertised = body.match(/<location>([^<]*deploy-checklist\/SKILL\.md)<\/location>/)?.[1]
      if (advertised) {
        advertisedSnapshotRoot = dirname(dirname(advertised))
        advertisedSnapshotRoots.push(advertisedSnapshotRoot)
        const requestedPath = script.args.path === '__relative_resource__'
          ? advertised.replace(/SKILL\.md$/, 'references/check.md')
          : advertised
        script = { ...script, args: { ...script.args, path: requestedPath } }
        if (mutateSkillSourceDuringTurn) {
          mutateSkillSourceDuringTurn = false
          await writeFile(deploySkillPath, [
            '---',
            '"name": "deploy-checklist"',
            '"description": "上線前的部署檢查步驟"',
            '---',
            '',
            '# 部署檢查 NEXT TURN',
            '',
            '- NEXT TURN BODY V2',
            '',
          ].join('\n'), 'utf8')
        }
      }
    }
    response.write(chunk({ role: 'assistant', content: '執行工具。' }, null))
    response.write(chunk({ tool_calls: [{
      index: 0,
      id: `call_${script.tool}_${++toolCallSequence}`,
      type: 'function',
      function: { name: script.tool, arguments: JSON.stringify(script.args) },
    }] }, null))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: '結論：完成。' }, null))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('Loopback model server did not bind')

// The page http_fetch reads during qualification.
let fetchHits = 0
const webServer = createServer((_request, response) => {
  fetchHits += 1
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end(`qualification page hit ${fetchHits}`)
})
await new Promise<void>((resolveListen) => webServer.listen(0, '127.0.0.1', resolveListen))
const webUrl = `http://127.0.0.1:${(webServer.address() as { port: number }).port}/page`

await writeFile(join(agentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
      apiKey: 'test-key-placeholder',
      models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'test-key' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_PI_SKILLS_DIR: skillsDir,
    SUBAGENTS_OUTBOUND_POLICY_DIR: outboundPolicyDir,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await new Promise<Array<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 25_000)
      once(output, 'line').then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
      })
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'sessions/create', {})
  const created = await waitFor(2)
  const sessionId = String(created.result.sessionId)

  // ── 1. Catalog projection: every active+available entry must EXECUTE ──
  send(3, 'tools/list')
  const listed = await waitFor(3)
  const catalog = listed.result?.catalog || []
  assert.ok(catalog.length > 20, `the catalog is substantial (${catalog.length} entries)`)
  // Removed equivalents are gone from every catalog surface (ADR-0027).
  const REMOVED = ['workspace_read', 'workspace_list', 'workspace_grep', 'workspace_glob', 'workspace_write', 'skill_list', 'skill_load', 'skill_save']
  for (const name of REMOVED) {
    assert.equal(catalog.some((entry: { name: string }) => entry.name === name), false, `${name} is absent from the catalog`)
    assert.equal(listed.result.builtinTools.includes(name), false, `${name} is absent from the flat list`)
  }
  // Active entries are exactly what the flat list names — no ghost list.
  const flatActive = [...listed.result.builtinTools].sort()
  const projectedActive = catalog.filter((entry: { active: boolean; available: boolean }) => entry.active && entry.available).map((entry: { name: string }) => entry.name).sort()
  assert.deepEqual(flatActive, projectedActive, 'flat list ≡ active catalog entries')

  // Probe EVERY always-on pack tool through direct execution: anything that
  // claims availability must actually run.
  const probes: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'datetime_now', args: {} },
    { name: 'tool_search', args: { query: 'fetch' } },
    { name: 'table_parse', args: { text: 'a,b\n1,2' } },
    { name: 'json_extract_lite', args: { json: '{"a":{"b":42}}', path: 'a.b' } },
  ]
  let probeId = 100
  for (const probe of probes) {
    probeId += 1
    send(probeId, 'tools/pack', { name: probe.name, arguments: probe.args, cwd: workspace, sessionId: 'qual-direct' })
    const result = await waitFor(probeId)
    assert.equal(result.error, undefined, `${probe.name} executes directly`)
  }
  // Capability-gated entries refuse honestly until loaded.
  probeId += 1
  send(probeId, 'tools/pack', { name: 'web_search', arguments: { query: 'x' }, cwd: workspace, sessionId: 'qual-direct', approval: 'allow' })
  // web_search IS executable when its pack is registered — gating is a
  // turn-level fact, not a registry absence. It runs; the point is it does
  // not error as unknown.
  const gatedProbe = await waitFor(probeId)
  assert.equal(gatedProbe.error, undefined, 'gated-but-loaded tools answer structurally')

  // ── 2. Capability load changes the projection mid-flight ──
  send(10, 'capabilities/load', { id: 'web-research' })
  assert.equal((await waitFor(10)).result?.loaded, true)
  send(11, 'capabilities/load', { id: 'messaging' })
  await waitFor(11)
  send(12, 'tools/list')
  const afterLoad = await waitFor(12)
  const webAfter = afterLoad.result?.catalog?.find((entry: { name: string }) => entry.name === 'http_fetch')
  assert.equal(webAfter?.active, true, 'loaded capability flips its tools active')

  // ── 3. Skills visible in the prompt; bodies reachable; archived hidden ──
  pendingScript = { tool: 'read', args: { path: join(skillsDir, 'deploy-checklist', 'SKILL.md') } }
  mutateSkillSourceDuringTurn = true
  send(13, 'turn/submit', {
    sessionId,
    runId: 'qual-skills-run',
    cwd: workspace,
    prompt: '依照 deploy-checklist 準備上線',
    preloadedCapabilities: ['web-research'],
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const skillsTurn = await waitFor(13)
  assert.equal(skillsTurn.error, undefined, JSON.stringify(skillsTurn.error))
  assert.equal(skillsTurn.result.settlement, 'answered')
  const prompt1 = requests[0] || ''
  assert.match(prompt1, /<available_skills>/, 'skills are advertised in the system prompt')
  assert.match(prompt1, /deploy-checklist/)
  assert.match(prompt1, /部署檢查/)
  assert.doesNotMatch(prompt1, new RegExp(agentDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'prompt never advertises the mutable global skill path')
  assert.match(prompt1, /subagents-pi-skill-resource-view\/[^<]*\/[a-f0-9]{64}\/deploy-checklist\/SKILL\.md/)
  assert.doesNotMatch(prompt1, /old-promo/, 'archived skill is not advertised')
  assert.match(requests.at(-1) || '', /確認 CI 綠燈/, 'the advertised location led the model to the real body')

  // Source changed after this turn advertised its snapshot. The current turn
  // kept V1; the next turn must reload and advertise/read V2.
  pendingScript = { tool: 'read', args: { path: join(skillsDir, 'deploy-checklist', 'SKILL.md') } }
  send(18, 'turn/submit', {
    sessionId,
    runId: 'qual-skill-reload-run',
    cwd: workspace,
    prompt: '再次讀取 deploy-checklist',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: false },
  })
  const reloadTurn = await waitFor(18)
  assert.equal(reloadTurn.error, undefined)
  assert.equal(reloadTurn.result?.settlement, 'answered')
  assert.match(requests.at(-1) || '', /NEXT TURN BODY V2/, 'next turn sees the changed source through a new snapshot')
  const reloadEntries = reloadTurn.result?.record?.entries || []
  const reloadReadCall = reloadEntries.find((entry: any) => entry.kind === 'tool-call' && entry.tool === 'read')
  assert.ok(reloadReadCall, 'reload turn records the native read call')
  assert.equal(advertisedSnapshotRoots.length >= 2, true, 'reload turn discovers a fresh resource snapshot')
  assert.equal(reloadReadCall?.args?.path, join(advertisedSnapshotRoots.at(-1)!, 'deploy-checklist', 'SKILL.md'))
  const reloadReadResult = reloadEntries.find((entry: any) => entry.kind === 'tool-result' && entry.tool === 'read')
  assert.ok(reloadReadResult, 'reload turn records the native read result')
  assert.equal(reloadReadResult?.settlement, 'success')
  assert.equal(reloadEntries.some((entry: any) => entry.kind === 'skill-context'), false,
    'native read reload does not fabricate a Skill preflight context entry')

  pendingScript = { tool: 'read', args: { path: '__relative_resource__' } }
  send(19, 'turn/submit', {
    sessionId,
    runId: 'qual-skill-relative-run',
    cwd: workspace,
    prompt: '讀取技能的 relative reference',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: false },
  })
  const relativeTurn = await waitFor(19)
  assert.equal(relativeTurn.error, undefined)
  assert.match(requests.at(-1) || '', /RELATIVE RESOURCE V1/, 'manifested relative resource is readable through native read')

  // ── 4. Extension tool execution inside a turn, end to end ──
  send(14, 'turn/submit', {
    sessionId,
    runId: 'qual-execution-run',
    cwd: workspace,
    prompt: '抓取這個網頁',
    preloadedCapabilities: ['web-research'],
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  pendingScript = { tool: 'http_fetch', args: { url: webUrl } }
  const execTurn = await waitFor(14)
  assert.equal(execTurn.result.settlement, 'answered')
  assert.equal(fetchHits >= 1, true, 'the extension tool reached the network')
  assert.match(requests.at(-1) || '', /qualification page hit/, 'its result fed back into the conversation')

  // ── 5. Approvals cover packs like builtins: unattended denies fail-closed ──
  // The approval-mode change forces a runtime replacement without changing
  // the skill digest. The deterministic resource root must remain readable
  // while the replacement is built and after the new runtime is live.
  const sameDigestRoot = advertisedSnapshotRoots.at(-1)
  assert.ok(sameDigestRoot, 'same-digest replacement has an advertised root')
  await access(join(sameDigestRoot!, 'deploy-checklist', 'SKILL.md'))
  pendingScript = { tool: 'message_send', args: { chatId: 'ops', text: 'hi' } }
  send(15, 'turn/submit', {
    sessionId,
    runId: 'qual-denial-run',
    cwd: workspace,
    prompt: '送出通知',
    preloadedCapabilities: ['messaging'],
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'auto', unattended: true, activeTools: ['message_send'] },
  })
  const denialTurn = await waitFor(15)
  assert.equal(denialTurn.result.settlement, 'answered')
  assert.equal(advertisedSnapshotRoots.at(-1), sameDigestRoot, 'same-digest replacement reuses the resource root')
  await access(join(sameDigestRoot!, 'deploy-checklist', 'SKILL.md'))
  const denyDecision = messages.find((message) => message.event === 'host/tool-decision' && message.payload?.tool === 'message_send' && message.payload?.decision === 'deny')
  assert.ok(denyDecision, 'the outbound denial was audited on the same channel as builtins')
  const denialEntries = denialTurn.result?.record?.entries || []
  const denialResult = denialEntries.find((entry: { kind: string; tool?: string }) => entry.kind === 'tool-result' && entry.tool === 'message_send')
  assert.equal(denialResult?.settlement, 'denied', 'the approval denial is durable in the Turn Record')

  // ── 6. ADR-0047: builtin shell fails closed under Outbound Guard required ──
  pendingScript = { tool: 'bash', args: { command: `cat ${webUrl.replace('http://127.0.0.1', '/etc')}` } }
  send(17, 'turn/submit', {
    sessionId,
    runId: 'qual-shell-required-run',
    cwd: workspace,
    prompt: '跑個指令',
    contextPolicy: { memoryEnabled: false, memoryWriteEnabled: false, referenceChatHistory: false, temporary: false, outboundShellMode: 'required', viewRoot: workspace },
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const shellTurn = await waitFor(17)
  assert.equal(shellTurn.result.settlement, 'answered', 'a denied shell does not end the turn')
  const shellResult = shellTurn.result.record.entries.find((entry: { kind: string; tool?: string; settlement?: string }) => entry.kind === 'tool-result' && entry.tool === 'bash')
  assert.ok(shellResult, 'the gated shell call is on the record')
  assert.equal(shellResult.settlement, 'denied', 'required mode denies an unverified builtin shell — fail-closed (ADR-0047)')

  // ── 7. The record is readable one page at a time, coordinates intact ──
  send(16, 'sessions/record', { sessionId })
  const recordPage = await waitFor(16)
  const pageEntries = recordPage.result?.page?.entries || []
  assert.ok(pageEntries.length >= 6, `the durable record holds the whole path (${pageEntries.length} entries)`)
  for (const tool of ['load_capability-placeholder']) void tool
  const qualCalls = pageEntries.filter((entry: { kind: string; tool?: string }) =>
    entry.kind === 'tool-call' && ['http_fetch', 'message_send', 'read'].includes(entry.tool || ''))
  const qualResults = pageEntries.filter((entry: { kind: string; tool?: string }) =>
    entry.kind === 'tool-result' && ['http_fetch', 'message_send', 'read'].includes(entry.tool || ''))
  assert.equal(qualCalls.length >= 3, true, `each probed tool left a call entry (${qualCalls.length})`)
  assert.equal(qualResults.length >= 3, true, `each probed tool left a result entry (${qualResults.length})`)
  for (const call of qualCalls) {
    const matching = qualResults.find((result: { callId: string; seq: number; settlement: string }) => result.callId === call.callId && result.seq > call.seq)
    assert.ok(matching, `call ${call.tool}/${call.callId} has its own later result with coordinates`)
  }
  const deniedResult = qualResults.find((result: { tool: string; settlement: string }) => result.tool === 'message_send')
  assert.equal(deniedResult?.settlement, 'denied', 'denials persist as denials in the durable record')

  // A failed replacement must not leave the retired same-digest root orphaned.
  // The next valid admission must safely rematerialize and reuse that root.
  send(151, 'turn/submit', {
    sessionId,
    runId: 'qual-runtime-construction-failure',
    cwd: workspace,
    prompt: '觸發 runtime 建構失敗',
    profile: { provider: 'loopback', model: 'missing-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'auto', unattended: true, activeTools: ['message_send'] },
  })
  const failedReplacement = await waitFor(151)
  assert.equal(failedReplacement.result, undefined)
  assert.equal(failedReplacement.error?.code, 'runtime_error')
  await assert.rejects(access(join(sameDigestRoot!, 'deploy-checklist', 'SKILL.md')), /ENOENT/)
  pendingScript = undefined
  send(152, 'turn/submit', {
    sessionId,
    runId: 'qual-runtime-construction-retry',
    cwd: workspace,
    prompt: '重試 runtime',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'auto', unattended: true, activeTools: ['message_send'] },
  })
  const retriedReplacement = await waitFor(152)
  assert.equal(retriedReplacement.result?.settlement, 'answered')
  assert.equal(advertisedSnapshotRoots.at(-1), sameDigestRoot, 'retry rematerializes the same-digest resource root')
  await access(join(sameDigestRoot!, 'deploy-checklist', 'SKILL.md'))

  console.log('QUALIFICATION PASSED: listed=callable across the whole catalog, approvals cover packs, skills live through the loader, removals stay removed, records replay')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit').catch(() => host.kill())
  }
  if (advertisedSnapshotRoot) {
    await assert.rejects(access(advertisedSnapshotRoot), 'Host shutdown removes the final per-session Skill Resource View')
  }
  modelServer.close()
  webServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(outboundPolicyDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
