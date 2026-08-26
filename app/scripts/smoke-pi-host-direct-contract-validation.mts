import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { validatePiToolArguments } from '../electron/piToolArguments.ts'
import {
  PI_LEGACY_TOOL_TRANSLATIONS,
  translateLegacyPiToolCall,
} from './fixtures/piLegacyToolTranslations.ts'

type Message = { id?: number; result?: Record<string, any>; error?: { code: string; message: string } }

// The generic validator proves the JSON Schema vocabulary not currently used
// by every Pi builtin. Direct protocol calls below prove this same validator is
// wired to the live session contract rather than a parallel schema registry.
const completeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' },
    count: { type: 'integer', minimum: 1, maximum: 3 },
    nested: {
      type: 'object',
      properties: { label: { type: 'string', minLength: 2 } },
      required: ['label'],
      additionalProperties: false,
    },
  },
  required: ['count', 'nested'],
} as const
const normalized = validatePiToolArguments(completeSchema as unknown as Record<string, unknown>, { count: 2, nested: { label: 'ok' } })
assert.equal(normalized.ok, true)
if (normalized.ok) assert.equal(normalized.arguments.mode, 'safe', 'declared defaults are materialized')
for (const [input, expected] of [
  [{ count: 0, nested: { label: 'ok' } }, /must be >= 1/],
  [{ count: 4, nested: { label: 'ok' } }, /must be <= 3/],
  [{ count: 2, nested: { label: 'x' } }, /must NOT have fewer than 2/],
  [{ count: 2, nested: { label: 'ok', extra: true } }, /additional properties/],
  [{ count: 2, nested: { label: 'ok' }, mode: 'other' }, /allowed values/],
] as const) {
  const invalid = validatePiToolArguments(completeSchema as unknown as Record<string, unknown>, input as Record<string, unknown>)
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.match(invalid.message, expected)
}

assert.deepEqual(
  PI_LEGACY_TOOL_TRANSLATIONS.map((entry) => entry.legacyTool).sort(),
  ['bash', 'workspace_glob', 'workspace_grep', 'workspace_list', 'workspace_read', 'workspace_write'],
  'every removed renderer/Pi equivalent has a qualification fixture',
)
for (const entry of PI_LEGACY_TOOL_TRANSLATIONS) {
  assert.ok(entry.hostTool)
  assert.ok(entry.hostMethod)
  assert.ok(entry.semanticTranslation.length > 0)
  for (const [before, after] of Object.entries(entry.parameterRenames)) {
    assert.notEqual(before, after, `${entry.legacyTool}.${before} is not a rename when the name is unchanged`)
  }
}
const translatedGrep = translateLegacyPiToolCall('workspace_grep', { query: 'NEEDLE', glob: '*.md' })
assert.deepEqual(translatedGrep.translation.parameterRenames, { query: 'pattern', maxResults: 'limit' })
assert.equal(translatedGrep.arguments.pattern, 'NEEDLE')
assert.equal(translatedGrep.arguments.path, '.', 'project-relative path is a separate default materialization')
assert.equal(translatedGrep.arguments.ignoreCase, true, 'case-insensitive legacy semantics are explicit')

// Electron renderer routing must defer these compatibility names to the Host.
;(globalThis as { window?: unknown }).window = {
  subagents: {
    platform: () => 'darwin',
    piHost: { sessions: { list: () => [] } },
  },
}
const { selectToolsForStep } = await import('../src/agent/tools/registry.ts')
const electronPicks = selectToolsForStep(
  'read file list workspace grep search files glob find files write file shell terminal command',
  'exercise every removed renderer equivalent',
  'read list grep glob write bash',
)
assert.equal(
  electronPicks.some((name) => PI_LEGACY_TOOL_TRANSLATIONS.some((fixture) => fixture.legacyTool === name)),
  false,
  'Electron renderer catalog does not route tools owned by Pi Host',
)
delete (globalThis as { window?: unknown }).window

const agentDir = await mkdtemp(join(tmpdir(), 'pi-direct-contract-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-direct-contract-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-direct-contract-cwd-'))
await writeFile(join(workspace, 'sample.txt'), 'contract needle\n')

const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end()
  request.resume()
  await once(request, 'end')
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
  response.write(`data: ${JSON.stringify({ id: 'direct-contract-smoke', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }] })}\n\n`)
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }] } } }))
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off' }))

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const lines = createInterface({ input: host.stdout })
const received: Message[] = []
lines.on('line', (line) => received.push(JSON.parse(line) as Message))
let sequence = 0
const call = async (method: string, params: Record<string, unknown> = {}) => {
  const id = ++sequence
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  for (;;) {
    const message = received.find((candidate) => candidate.id === id)
    if (message) return message
    await new Promise<Array<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000)
      once(lines, 'line').then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
    })
  }
}

try {
  assert.equal((await call('initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })).error, undefined)
  const created = await call('sessions/create', { title: 'direct contract validation' })
  const sessionId = String(created.result?.sessionId)
  const turn = await call('turn/submit', {
    sessionId,
    runId: 'direct-contract-turn',
    cwd: workspace,
    prompt: 'capture tools',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', approvalMode: 'full', unattended: true },
  })
  assert.equal(turn.error, undefined)
  const contractRevision = Number(turn.result?.contractRevision)
  const described = await call('tools/contract', { sessionId, revision: contractRevision, toolName: 'read' })
  const readDigest = String(described.result?.contractTool?.schemaDigest)
  const envelope = { cwd: workspace, sessionId, contractRevision, schemaDigest: readDigest }

  const read = await call('tools/read', { ...envelope, runId: 'direct-read', callId: 'direct-read-call', path: 'sample.txt' })
  assert.equal(read.error, undefined, 'protocol envelope is separate from schema-validated arguments')
  assert.match(JSON.stringify(read.result?.content), /contract needle/)
  assert.match(String((await call('tools/read', { ...envelope })).error?.message), /required property 'path'/)
  assert.match(String((await call('tools/read', { ...envelope, path: 42 })).error?.message), /must be string/)
  assert.match(String((await call('tools/read', { ...envelope, path: 'sample.txt', contractRevision: contractRevision - 1 })).error?.message), /not current/)
  assert.match(String((await call('tools/read', { ...envelope, path: 'sample.txt', schemaDigest: '0'.repeat(64) })).error?.message), /digest mismatch/)

  const nestedInvalid = await call('tools/edit', {
    cwd: workspace,
    sessionId,
    contractRevision,
    approval: 'allow',
    path: 'sample.txt',
    edits: [{ oldText: 'needle' }],
  })
  assert.match(String(nestedInvalid.error?.message), /newText/, 'nested required fields come from the live Pi schema')
  assert.equal(await readFile(join(workspace, 'sample.txt'), 'utf8'), 'contract needle\n', 'invalid nested arguments never execute')

  const enumInvalid = await call('tools/pack', {
    cwd: workspace,
    sessionId,
    contractRevision,
    name: 'update_plan',
    arguments: { steps: [{ title: 'bad status', status: 'unknown' }] },
  })
  assert.match(String(enumInvalid.error?.message), /allowed values/, 'nested enum validation uses the current pack contract')
  const packSuccess = await call('tools/pack', {
    cwd: workspace,
    sessionId,
    contractRevision,
    name: 'update_plan',
    arguments: { steps: [{ title: 'valid status', status: 'pending' }] },
  })
  assert.equal(packSuccess.error, undefined)

  // Drift guard: production Host validation cannot regain renderer schema authority.
  const protocolSource = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
  assert.doesNotMatch(protocolSource, /agent\/tools\/(?:toolDefinitions|schemas|registry|toolRegistry)/)
  const fixtureImporters = await Promise.all([
    readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8'),
    readFile(resolve(import.meta.dirname, '../src/agent/tools/registry.ts'), 'utf8'),
  ])
  assert.equal(fixtureImporters.some((source) => source.includes('piLegacyToolTranslations')), false, 'qualification fixture never becomes production authority')

  console.log('Direct Pi Host calls validate complete current-contract schemas; legacy translations remain qualification-only')
} finally {
  host.stdin.end()
  if (host.exitCode === null) await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { host.kill(); resolve() }, 1_000)
    once(host, 'exit').then(() => { clearTimeout(timer); resolve() })
  })
  lines.close()
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}
