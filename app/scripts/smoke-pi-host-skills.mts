import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Issues 02 + 16 + 17 — skills become Pi resources.
 *
 * The Host owns a skills directory; Pi's resource loader discovers it; the
 * system prompt advertises what the loader found; the model reads a body
 * through the location the catalog gave. Migration from the renderer's
 * localStorage copy is one-way and REPORTED per skill. Pinned bodies expand
 * up front; archived skills stay out of the advertisement but remain listed;
 * and turning `read` off reports the skills-unavailable fact instead of
 * letting every skill vanish silently.
 */

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-skills-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-skills-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-skills-cwd-'))
const skillsDir = join(agentDir, 'skills')
await mkdir(skillsDir, { recursive: true })
// A malformed skill written directly to disk must surface as a diagnostic,
// not disappear.
await writeFile(join(skillsDir, 'broken.md'), '# no frontmatter at all\n', 'utf8')

let requests: string[] = []
// Each turn hands the loopback model one scripted first-round tool call.
let pendingScript: { tool: string; args: Record<string, unknown> } | undefined
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const chunk = (delta: unknown, finish: string | null) => sse({
  id: `skills-${requests.length}`,
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
    const script = pendingScript
    pendingScript = undefined
    response.write(chunk({ role: 'assistant', content: '我先讀技能。' }, null))
    response.write(chunk({ tool_calls: [{
      index: 0,
      id: `call_${script.tool}`,
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
    // Point the loader at the same directory sync writes into; in production
    // this defaults under the agent dir. Both halves of this smoke agree on
    // one directory because ONE discovery path is the point.
    SUBAGENTS_PI_SKILLS_DIR: skillsDir,
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
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 20_000)),
    ])
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)

try {
  send(1, 'initialize', { protocolVersion: 2 })
  assert.equal((await waitFor(1)).error, undefined)

  // ── Migration is one-way and reported per skill (issue 16) ──
  send(2, 'resources/sync-skills', { skills: [
    { name: 'release-notes', description: '寫發布說明的步驟', body: '# 步驟\n\n1. 彙整 commit\n2. 分類變更', status: 'active' },
    { name: '部署檢查', description: '', body: '- 確認 CI 綠燈\n- 標記 tag', status: 'pinned' },
    { name: 'legacy-promo', description: '已退役的促銷文案技能', body: '舊流程，不再使用。', status: 'archived' },
    { name: 'broken-skill', body: '' },
  ] })
  const synced = await waitFor(2)
  assert.equal(synced.error, undefined)
  const report = synced.result?.report?.results || []
  assert.equal(report.length, 4, `every skill gets its own result: ${JSON.stringify(report)}`)
  const byName = new Map(report.map((result: { name: string }) => [result.name, result]))
  assert.equal(byName.get('release-notes')?.ok, true)
  assert.equal(byName.get('部署檢查')?.ok, true, 'a CJK display name migrates via slug')
  assert.equal(byName.get('legacy-promo')?.status, 'archived')
  assert.equal(byName.get('broken-skill')?.ok, false, 'a malformed skill is reported, never silently dropped')
  assert.match(String(byName.get('broken-skill')?.error || ''), /description or a body/)

  // Before any turn ran, resources/list cannot know the loader's findings —
  // after sync the FILES are there, so create the session that loads them.
  send(3, 'sessions/create', {})
  const created = await waitFor(3)
  const sessionId = String(created.result.sessionId)

  // A first turn makes the runtime load skills and advertises them.
  send(4, 'turn/submit', {
    sessionId,
    runId: 'skills-visible-run',
    cwd: workspace,
    prompt: '請寫一份發布說明',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const settled = await waitFor(4)
  assert.equal(settled.result.settlement, 'answered')

  const systemPrompt1 = requests[0] || ''
  assert.match(systemPrompt1, /<available_skills>/, 'the turn advertises discovered skills')
  assert.match(systemPrompt1, /release-notes/)
  assert.match(systemPrompt1, /寫發布說明的步驟/, 'name AND description travel with the advertisement')
  assert.match(systemPrompt1, /skills[/\\]release-notes[/\\]SKILL\.md/, 'the location is given so read can reach the body')
  assert.doesNotMatch(systemPrompt1, /legacy-promo/, 'an archived skill stays out of <available_skills>')
  // Pinned expansion up front (issue 16): body travels even without keyword match.
  assert.match(systemPrompt1, /已釘選技能/, 'pinned skills get their own expansion block')
  assert.match(systemPrompt1, /確認 CI 綠燈/, 'the pinned BODY is expanded, not just the name')
  // The malformed file shows up as a diagnostic in resources/list, and the
  // archived skill remains listed but disabled.
  send(5, 'resources/list')
  const resourcesListed = await waitFor(5)
  const resources = resourcesListed.result?.resources || []
  const releaseEntry = resources.find((resource: { id: string }) => resource.id === 'release-notes')
  const legacyEntry = resources.find((resource: { id: string }) => resource.id === 'legacy-promo')
  assert.ok(releaseEntry, 'resources/list reflects the loader findings instead of an empty array')
  assert.equal(releaseEntry.kind, 'skill')
  assert.equal(releaseEntry.enabled, true)
  assert.equal(legacyEntry?.enabled, false, 'archived stays listed as disabled')
  assert.ok((resourcesListed.result?.diagnostics || []).some((diagnostic: { path: string }) => String(diagnostic.path).includes('broken')), 'the malformed skill is reported as a diagnostic')

  // The model can follow the advertised location: scripted round 1 reads the
  // exact SKILL.md path the catalog gave, and the body reaches round 2.
  const skillPath = join(skillsDir, 'release-notes', 'SKILL.md')
  send(6, 'turn/submit', {
    sessionId,
    runId: 'skills-read-run',
    cwd: workspace,
    prompt: '依照 release-notes 技能執行',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  pendingScript = { tool: 'read', args: { path: skillPath } }
  const settledRead = await waitFor(6)
  assert.equal(settledRead.result.settlement, 'answered')
  assert.match(requests.at(-1) || '', /彙整 commit/, 'the skill body reached the model through the read tool')

  // ── Turning `read` off reports the dependency instead of vanishing (issue 17) ──
  send(7, 'turn/submit', {
    sessionId,
    runId: 'skills-no-read-run',
    cwd: workspace,
    prompt: '再寫一份發布說明',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true, activeTools: ['grep'] },
  })
  const noReadSettled = await waitFor(7)
  assert.equal(noReadSettled.result.settlement, 'answered')
  assert.doesNotMatch(requests.at(-1) || '', /<available_skills>/, 'without read the block really disappears from the prompt')
  const noticeEvent = messages.find((message) => message.event === 'host/context' && message.payload?.phase === 'skills-unavailable' && message.payload?.runId === 'skills-no-read-run')
  assert.ok(noticeEvent, 'the run announces why skills are unavailable')
  const noticeEntry = noReadSettled.result.record.entries.find((entry: { kind: string; topic?: string }) => entry.kind === 'notice' && entry.topic === 'skills-unavailable')
  assert.ok(noticeEntry, 'the announcement lands in the Turn Record too')

  // Re-enabling read restores the skills without a restart: the next turn's
  // prompt advertises them again.
  send(8, 'turn/submit', {
    sessionId,
    runId: 'skills-restored-run',
    cwd: workspace,
    prompt: '最後再寫一份',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true, activeTools: ['grep', 'read'] },
  })
  const restored = await waitFor(8)
  assert.equal(restored.result.settlement, 'answered')
  assert.match(requests.at(-1) || '', /<available_skills>/, 'skills return once read is active again')

  console.log('Pi skills are resource-loader owned: advertised, readable, migrated with reports, pinned-expanded, archived-hidden, and honest about the read dependency')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit').catch(() => host.kill())
  }
  modelServer.close()
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
