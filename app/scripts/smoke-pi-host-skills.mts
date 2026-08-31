import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { resolvePiSkillsDir } from '../electron/piSkills.ts'

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
assert.equal(
  resolvePiSkillsDir(undefined, { SUBAGENTS_PI_SKILLS_DIR: '~/shared-skills' }, '/Users/skill-owner'),
  '/Users/skill-owner/shared-skills',
)
await mkdir(skillsDir, { recursive: true })
const packageRoot = join(agentDir, 'npm', 'node_modules', 'pi-skill-fixture')
const packageSkillDir = join(packageRoot, 'skills', 'package-review')
const packageSkillRaw = '---\nname: package-review\ndescription: Package-owned review checklist\n---\n\n# Review\n\nVerify the package skill provenance.\n'
await mkdir(packageSkillDir, { recursive: true })
await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
  name: 'pi-skill-fixture',
  version: '1.2.3',
  pi: { skills: ['./skills'] },
}), 'utf8')
await writeFile(join(packageSkillDir, 'SKILL.md'), packageSkillRaw, 'utf8')
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
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
  defaultProvider: 'loopback',
  defaultModel: 'smoke-model',
  defaultThinkingLevel: 'off',
  packages: ['npm:pi-skill-fixture@1.2.3'],
}))

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
  assert.match(systemPrompt1, /package-review/, 'a configured package skill enters the same frozen prompt view')
  assert.match(systemPrompt1, /Package-owned review checklist/, 'package skill description comes from Pi discovery')
  // The intent is that `read` can reach the body from the prompt alone, so the
  // assertion is on a resolvable absolute path to THIS skill's SKILL.md. The
  // literal `skills/` segment is gone on purpose: skills are Pi resources now
  // (ADR-0034) and are served from a per-session resource view whose layout is
  // not part of the contract.
  assert.match(systemPrompt1, /\/[^"\s]*release-notes[/\\]SKILL\.md/, 'the location is given so read can reach the body')
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
  const packageEntry = resources.find((resource: { id: string }) => resource.id === 'package-review')
  assert.ok(releaseEntry, 'resources/list reflects the loader findings instead of an empty array')
  assert.equal(releaseEntry.kind, 'skill')
  assert.equal(releaseEntry.enabled, true)
  assert.equal(legacyEntry?.enabled, false, 'archived stays listed as disabled')
  assert.deepEqual(packageEntry?.packageProvenance, {
    packageName: 'pi-skill-fixture',
    version: '1.2.3',
    source: 'npm:pi-skill-fixture@1.2.3',
    origin: 'package',
    contentDigest: createHash('sha256').update(packageSkillRaw).digest('hex'),
  }, 'package provenance is derived from the frozen manifest, not renderer state')
  // The malformed skill is REPORTED, not dropped. It is identified by the
  // problem, not by its directory name: a skill missing its frontmatter has no
  // usable name, so the loader gives it a generated slug and the actionable
  // part is the message. Pinning the old `broken` path pinned a layout that
  // ADR-0034 deliberately replaced with a per-session resource view.
  const diagnostics = (resourcesListed.result?.diagnostics || []) as Array<{ path: string; message: string }>
  assert.equal(diagnostics.length, 1, 'exactly the malformed skill is reported')
  assert.match(String(diagnostics[0].path), /SKILL\.md$/, 'the diagnostic points at the file to fix')
  assert.match(String(diagnostics[0].message), /description is required/, 'and says what is wrong with it')
  // The skills that DID load are unaffected by their broken neighbour.
  assert.ok(releaseEntry && legacyEntry, 'a malformed skill does not take the valid ones down with it')

  // The model can follow the advertised location: scripted round 1 reads the
  // exact SKILL.md path the SYSTEM PROMPT gave, and the body reaches round 2.
  //
  // Read from the prompt rather than rebuilt from `skillsDir`: skills are
  // served from a per-session resource view (ADR-0034), so a path assembled
  // from the Host-owned directory is a path the model was never given — and it
  // is refused as escaping the frozen Restricted Project View. That refusal is
  // correct; using it here would have tested the wrong location. What matters
  // is that the location the model IS told to use can actually be read.
  const advertised = /<location>([^<]+release-notes[/\\]SKILL\.md)<\/location>/.exec(systemPrompt1)
  assert.ok(advertised, 'the prompt advertises a concrete location for the skill')
  const skillPath = advertised[1]
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

  // ── Mutations propagate: removal + unpin actually reach the loader ──
  // The renderer re-pushes its WHOLE list on every change（技能庫儲存／刪除／
  // 釘選）。A payload that no longer mentions a skill must remove its Host
  // copy — otherwise a deleted skill would keep being advertised and
  // auto-loaded forever, which is exactly the silent-ghost bug this guards.
  send(9, 'resources/sync-skills', { skills: [
    { name: '部署檢查', description: '上線前的檢查清單', body: '- 確認 CI 綠燈\n- 標記 tag', status: 'active' },
    { name: 'legacy-promo', description: '已退役的促銷文案技能', body: '舊流程，不再使用。', status: 'archived' },
  ] })
  const resynced = await waitFor(9)
  assert.equal(resynced.error, undefined)
  const stateAfter = JSON.parse(await readFile(join(skillsDir, 'skills-state.json'), 'utf8')) as {
    skills: Record<string, { status?: string; displayName?: string }>
  }
  assert.ok(!stateAfter.skills['release-notes'], 'a removed skill loses its state entry')
  await assert.rejects(() => stat(join(skillsDir, 'release-notes', 'SKILL.md')), 'its file is really gone')
  assert.ok(
    Object.values(stateAfter.skills).some((meta) => meta?.displayName === '部署檢查' && meta?.status === 'active'),
    'unpin updates the recorded status',
  )
  assert.ok(await stat(join(skillsDir, 'broken.md')).then(() => true, () => false),
    'hand-written files without a state entry survive reconciliation')

  // A fresh session reloads resources, so the NEXT turn reflects the mutations.
  send(10, 'sessions/create', {})
  const recreated = await waitFor(10)
  const sessionIdAfter = String(recreated.result.sessionId)
  const marker = requests.length
  send(11, 'turn/submit', {
    sessionId: sessionIdAfter,
    runId: 'skills-after-mutation-run',
    cwd: workspace,
    prompt: '請寫一份發布說明',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: true },
  })
  const settledAfterMutation = await waitFor(11)
  assert.equal(settledAfterMutation.result.settlement, 'answered')
  // A fresh session may also fire background model calls（例如命名）that do
  // not carry the loader's system prompt, so the POSITIVE assertion is
  // existential（回合本身的請求一定在其中）while the negative ones hold for
  // every request — and never `at(-1)`, which can index a naming prompt.
  const turnRequests = requests.slice(marker)
  assert.ok(turnRequests.some((request) => request.includes('<available_skills>')), 'the surviving skill is still advertised')
  for (const request of turnRequests) {
    assert.doesNotMatch(request, /release-notes/, 'the removed skill leaves every prompt')
    assert.doesNotMatch(request, /已釘選技能/, 'unpinning removes the up-front expansion')
    assert.doesNotMatch(request, /確認 CI 綠燈/, 'the unpinned body is no longer expanded without keyword match')
  }

  // Hydration read-back: the renderer projects the Host directory in at boot
  // so its next full-state push can never reconcile real skills away. The
  // read must reflect the mutations above and exclude non-renderer files.
  send(12, 'resources/read-skill-files', {})
  const skillFiles = await waitFor(12)
  const paths = ((skillFiles.result?.files || []) as Array<{ path: string }>).map((file) => file.path)
  assert.ok(paths.some((p) => p.includes('skill-15phjom')), 'the surviving skill is projected back to the renderer')
  assert.ok(paths.some((p) => p.includes('legacy-promo')), 'archived skills stay listed（狀態在 frontmatter，UI 負責呈現）')
  assert.ok(!paths.some((p) => p.includes('release-notes')), 'a removed skill is gone from the projection too')
  assert.ok(!paths.some((p) => p.includes('broken.md')), 'hand-placed root files are not renderer-managed state')

  console.log('Pi skills are resource-loader owned: advertised, readable, migrated with reports, pinned-expanded, archived-hidden, honest about the read dependency, mutations propagate (remove + unpin), and hydrate back for safe full-state syncs')
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
