import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Message = {
  id?: number
  event?: string
  payload?: Record<string, any>
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const source = 'npm:pi-lifecycle-fixture@1.2.3'
const agentDir = await mkdtemp(join(tmpdir(), 'pi-package-lifecycle-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-package-lifecycle-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-package-lifecycle-cwd-'))
const fakeNpm = join(stateDir, 'fake-npm.mjs')
await writeFile(fakeNpm, `
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const args = process.argv.slice(2)
const prefixAt = args.indexOf('--prefix')
if (prefixAt < 0 || !args[prefixAt + 1]) throw new Error('fixture npm requires --prefix')
const root = join(args[prefixAt + 1], 'node_modules', 'pi-lifecycle-fixture')
if (args[0] === 'uninstall') {
  await rm(root, { recursive: true, force: true })
  process.exit(0)
}
if (args[0] !== 'install' || !args.includes('pi-lifecycle-fixture@1.2.3')) throw new Error('unexpected fixture npm request')
await mkdir(join(root, 'extensions'), { recursive: true })
await mkdir(join(root, 'skills', 'package-lifecycle'), { recursive: true })
await writeFile(join(root, 'package.json'), JSON.stringify({
  name: 'pi-lifecycle-fixture', version: '1.2.3', type: 'module',
  pi: { extensions: ['./extensions/index.js'], skills: ['./skills'] }
}))
await writeFile(join(root, 'extensions', 'index.js'), \`
export default function fixture(pi) {
  pi.registerTool({
    name: 'package_echo', label: 'Package Echo', description: 'Echo through the package lifecycle fixture',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    async execute(_id, input) { return { content: [{ type: 'text', text: 'package:' + input.text }] } }
  })
}
\`)
await writeFile(join(root, 'skills', 'package-lifecycle', 'SKILL.md'), '---\\nname: package-lifecycle\\ndescription: Controlled lifecycle package skill\\n---\\n\\n# Package lifecycle\\n\\nUse the trusted package lifecycle.\\n')
`, 'utf8')

const requestBodies: string[] = []
function currentSystemPrompt(): string {
  const request = JSON.parse(requestBodies.at(-1) || '{}') as { messages?: Array<{ role: string; content: unknown }> }
  return JSON.stringify(request.messages?.filter((message) => message.role === 'system') || [])
}
let holdStarted!: () => void
const holding = new Promise<void>((done) => { holdStarted = done })
let releaseHold!: () => void
const held = new Promise<void>((done) => { releaseHold = done })
const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  let body = ''
  for await (const chunk of request) body += chunk
  requestBodies.push(body)
  if (body.includes('HOLD_PACKAGE_RUN')) {
    holdStarted()
    await held
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  if (body.includes('USE_PACKAGE_TOOL') && !body.includes('"role":"tool"')) {
    response.write(sse({ id: 'lifecycle-tool', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: {
      role: 'assistant',
      tool_calls: [{ index: 0, id: 'call_package_echo', type: 'function', function: { name: 'package_echo', arguments: '{"text":"hello"}' } }],
    }, finish_reason: null }] }))
    response.write(sse({ id: 'lifecycle-tool', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }))
  } else {
    response.write(sse({ id: 'lifecycle-answer', object: 'chat.completion.chunk', model: 'smoke-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }] }))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('model fixture did not bind')
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
  defaultProvider: 'loopback', defaultModel: 'smoke-model', defaultThinkingLevel: 'off',
  npmCommand: [process.execPath, fakeNpm], packages: [],
}), 'utf8')
await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
  baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'placeholder',
  models: [{ id: 'smoke-model', name: 'Smoke Model', reasoning: false, input: ['text'], contextWindow: 32_000 }],
} } }), 'utf8')
await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'fixture' } }), 'utf8')

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_PI_NATIVE_AGENT_DIR: join(stateDir, 'empty-native-agent'),
    SUBAGENTS_PI_SYNC_CLI_OAUTH: 'false',
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const waitFor = async (predicate: (message: Message) => boolean, label: string) => {
  for (;;) {
    const found = messages.find(predicate)
    if (found) return found
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([once(output, 'line'), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`timeout: ${label}`)), 20_000) })])
    } finally { clearTimeout(timeout) }
  }
}
const waitId = (id: number) => waitFor((message) => message.id === id, `response ${id}`)
const createSession = async (id: number) => {
  send(id, 'sessions/create')
  return String((await waitId(id)).result?.sessionId)
}
const submit = (id: number, sessionId: string, runId: string, prompt: string) => send(id, 'turn/submit', {
  sessionId, runId, cwd: workspace, prompt,
  profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: false },
  contextPolicy: { outboundShellMode: 'off' },
})

try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['packages', 'tool-contract-v1'] })
  assert.equal((await waitId(1)).error, undefined)

  // Pinned install establishes Host truth but no execution authority.
  send(2, 'packages/install', { source, scope: 'user', trusted: true })
  const installed = await waitId(2)
  assert.equal(installed.error, undefined)
  assert.equal(installed.result?.packages?.[0]?.source, source)
  assert.equal(installed.result?.packages?.[0]?.installed, true)
  assert.equal(installed.result?.packages?.[0]?.toolTrust, 'inactive')

  // Agent Chat and Pi-backed SubDesign are two sessions over one Host-owned package state.
  const chatSession = await createSession(3)
  submit(4, chatSession, 'package-chat-run', 'CHAT_PACKAGE_SKILL')
  assert.equal((await waitId(4)).result?.settlement, 'answered')
  const chatPrompt = requestBodies.at(-1) || ''
  assert.match(chatPrompt, /package-lifecycle/)
  assert.match(chatPrompt, /Controlled lifecycle package skill/)
  send(24, 'tools/contract', { sessionId: chatSession, revision: 1, toolName: 'package_echo' })
  assert.equal((await waitId(24)).error?.code, 'tool_contract_unknown_tool', 'installed-but-untrusted tools never enter the model contract')

  const subDesignSession = await createSession(5)
  submit(6, subDesignSession, 'package-subdesign-run', 'SUBDESIGN_PACKAGE_SKILL')
  assert.equal((await waitId(6)).result?.settlement, 'answered')
  const subDesignPrompt = requestBodies.at(-1) || ''
  assert.match(subDesignPrompt, /package-lifecycle/)
  assert.match(subDesignPrompt, /Controlled lifecycle package skill/)
  send(7, 'resources/list')
  const packageSkill = (await waitId(7)).result?.resources?.find((resource: { id?: string }) => resource.id === 'package-lifecycle')
  assert.deepEqual(packageSkill?.packageProvenance && { ...packageSkill.packageProvenance, contentDigest: undefined }, {
    packageName: 'pi-lifecycle-fixture', version: '1.2.3', source, origin: 'package', contentDigest: undefined,
  })

  // Explicit trust creates the next run's active tool contract. The ordinary
  // Host approval/evidence path still owns the call.
  send(8, 'packages/set-tools-enabled', { source, enabled: true, trusted: true })
  assert.equal((await waitId(8)).result?.packages?.[0]?.toolTrust, 'active')
  const toolSession = await createSession(9)
  submit(10, toolSession, 'package-tool-run', 'USE_PACKAGE_TOOL')
  const approval = await waitFor((message) => message.event === 'host/approval-requested' && message.payload?.runId === 'package-tool-run', 'package tool approval')
  assert.equal(approval.payload?.tool, 'package_echo')
  send(11, 'approvals/resolve', { runId: 'package-tool-run', callId: approval.payload?.callId, decision: 'allow' })
  assert.equal((await waitId(11)).error, undefined)
  const toolRun = await waitId(10)
  assert.equal(toolRun.result?.settlement, 'answered')
  const toolCall = toolRun.result?.record?.entries?.find((entry: { kind?: string; tool?: string }) => entry.kind === 'tool-call' && entry.tool === 'package_echo')
  const toolResult = toolRun.result?.record?.entries?.find((entry: { kind?: string; tool?: string }) => entry.kind === 'tool-result' && entry.tool === 'package_echo')
  assert.equal(toolCall?.toolSource, 'pi-package')
  assert.deepEqual(toolCall?.packageProvenance, { packageName: 'pi-lifecycle-fixture', version: '1.2.3', source, origin: 'package' })
  assert.equal(toolResult?.settlement, 'success')
  assert.deepEqual(toolResult?.packageProvenance, toolCall?.packageProvenance)

  // Remove invalidates every session runtime; neither Chat, SubDesign nor the
  // active-tool contract can retain the fixture on their next run.
  send(12, 'packages/remove', { source, scope: 'user' })
  assert.deepEqual((await waitId(12)).result?.packages, [])
  const chatAfterRemoveSession = chatSession
  submit(14, chatAfterRemoveSession, 'package-chat-after-remove', 'CHAT_AFTER_REMOVE')
  assert.equal((await waitId(14)).result?.settlement, 'answered')
  assert.doesNotMatch(currentSystemPrompt(), /Controlled lifecycle package skill/)
  const subDesignAfterRemoveSession = subDesignSession
  submit(16, subDesignAfterRemoveSession, 'package-subdesign-after-remove', 'SUBDESIGN_AFTER_REMOVE')
  assert.equal((await waitId(16)).result?.settlement, 'answered')
  assert.doesNotMatch(currentSystemPrompt(), /Controlled lifecycle package skill/)
  send(17, 'resources/list')
  assert.equal((await waitId(17)).result?.resources?.some((resource: { id?: string }) => resource.id === 'package-lifecycle'), false)
  send(18, 'tools/contract', { sessionId: chatAfterRemoveSession, revision: 2, toolName: 'package_echo' })
  assert.equal((await waitId(18)).error?.code, 'tool_contract_unknown_tool')

  // The one critical failure path: mutation while a Pi turn is active leaves
  // both package state and the current generation unchanged.
  submit(19, chatAfterRemoveSession, 'package-active-run', 'HOLD_PACKAGE_RUN')
  await holding
  send(22, 'tools/contract', { sessionId: chatAfterRemoveSession, revision: 3, toolName: 'read' })
  const admittedContract = (await waitId(22)).result?.contract
  assert.ok(admittedContract, 'active run has a Host-issued contract generation')
  send(20, 'packages/install', { source, scope: 'user', trusted: true })
  assert.equal((await waitId(20)).error?.code, 'busy')
  send(21, 'packages/list')
  assert.deepEqual((await waitId(21)).result?.packages, [])
  send(23, 'tools/contract', { sessionId: chatAfterRemoveSession, revision: 3, toolName: 'read' })
  assert.deepEqual((await waitId(23)).result?.contract, admittedContract, 'refused mutation preserves the admitted contract generation')
  releaseHold()
  assert.equal((await waitId(19)).result?.settlement, 'answered')
} finally {
  releaseHold?.()
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}

console.log('Pi package lifecycle qualifies install, shared resources, trust, removal, and active-run refusal')
