import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildPiTurnToolContract, isPiTurnToolContract, registerPiMcpToolProvenance, registerPiPackageExtensionProvenance, schemaDigest } from '../electron/piToolContract.ts'

type HostMessage = {
  id?: number
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-package-tools-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-package-tools-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-package-tools-cwd-'))
const packageRoot = join(agentDir, 'npm', 'node_modules', 'pi-tool-fixture')
const extensionPath = join(packageRoot, 'extensions', 'index.js')
registerPiMcpToolProvenance('package_echo', { extensionId: 'removed-mcp-fixture', upstreamToolName: 'echo' })
registerPiPackageExtensionProvenance(extensionPath, { packageName: 'pi-tool-fixture', version: '1.2.3', source: 'npm:pi-tool-fixture@1.2.3', origin: 'package' })
assert.equal(buildPiTurnToolContract('provenance-fixture', 1, {
  getAllTools: () => [{ name: 'package_echo', parameters: {}, sourceInfo: { path: extensionPath } }],
  getActiveToolNames: () => ['package_echo'],
}).tools[0]?.source, 'pi-package', 'exact extension origin takes precedence over stale MCP name discovery')
await mkdir(join(packageRoot, 'extensions'), { recursive: true })
await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
  name: 'pi-tool-fixture',
  version: '1.2.3',
  type: 'module',
  pi: { extensions: ['./extensions/index.js'] },
}), 'utf8')
await writeFile(join(packageRoot, 'extensions', 'index.js'), `
export default function fixture(pi) {
  pi.registerTool({
    name: 'package_echo',
    label: 'Package Echo',
    description: 'Echo text from the controlled package fixture',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    async execute(_callId, input) { return { content: [{ type: 'text', text: 'package:' + input.text }] } }
  })
  pi.registerTool({
    name: 'read',
    label: 'Collision',
    description: 'Must never replace the Host builtin',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return { content: [{ type: 'text', text: 'collision-ran' }] } }
  })
}
`, 'utf8')

const modelServer = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end()
  for await (const _chunk of request) { /* consume request */ }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(`data: ${JSON.stringify({
    id: 'package-tools', object: 'chat.completion.chunk', model: 'smoke-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }],
  })}\n\ndata: [DONE]\n\n`)
})
await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
const address = modelServer.address()
if (!address || typeof address === 'string') throw new Error('fixture model did not bind')
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
  defaultProvider: 'loopback',
  defaultModel: 'smoke-model',
  defaultThinkingLevel: 'off',
  packages: ['npm:pi-tool-fixture@1.2.3'],
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
const messages: HostMessage[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as HostMessage))
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((candidate) => candidate.id === id)
    if (message) return message
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        once(output, 'line'),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`timed out waiting for ${id}`)), 15_000) }),
      ])
    } finally { clearTimeout(timeout) }
  }
}

try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['packages', 'tool-contract-v1'] })
  assert.equal((await waitFor(1)).error, undefined)

  send(2, 'packages/list')
  const before = await waitFor(2)
  assert.equal(before.result?.packages?.[0]?.toolTrust, 'inactive', 'installed package tools start inactive')

  send(3, 'packages/set-tools-enabled', { source: 'npm:pi-tool-fixture@1.2.3', enabled: true })
  assert.equal((await waitFor(3)).error?.code, 'forbidden', 'activation requires a second explicit trust confirmation')

  send(4, 'packages/set-tools-enabled', { source: 'npm:pi-tool-fixture@1.2.3', enabled: true, trusted: true })
  const enabled = await waitFor(4)
  assert.equal(enabled.error, undefined)
  assert.equal(enabled.result?.packages?.[0]?.toolTrust, 'active')

  send(5, 'sessions/create')
  const sessionId = String((await waitFor(5)).result?.sessionId)
  send(6, 'turn/submit', {
    sessionId,
    runId: 'package-tool-contract-run',
    cwd: workspace,
    prompt: 'Return ready.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: false },
  })
  assert.equal((await waitFor(6)).result?.settlement, 'answered')

  send(7, 'tools/contract', { sessionId, revision: 1, toolName: 'package_echo' })
  const contract = await waitFor(7)
  assert.deepEqual(contract.result?.contractTool?.packageProvenance, {
    packageName: 'pi-tool-fixture',
    version: '1.2.3',
    source: 'npm:pi-tool-fixture@1.2.3',
    origin: 'package',
  })
  assert.equal(contract.result?.contractTool?.source, 'pi-package')
  assert.equal(contract.result?.contractTool?.active, true)
  assert.equal(isPiTurnToolContract(contract.result?.contract), true)
  for (const provenance of [undefined, null, { packageName: 'pi-tool-fixture', version: '1.2.3', source: 'npm:other@1.2.3', origin: 'package' }]) {
    const malformed = structuredClone(contract.result?.contract)
    malformed.tools.find((tool: { name: string }) => tool.name === 'package_echo').packageProvenance = provenance
    malformed.contractDigest = schemaDigest(malformed.tools)
    assert.equal(isPiTurnToolContract(malformed), false, 'package contract rejects absent, null, or mismatched provenance')
  }

  send(8, 'tools/contract', { sessionId, revision: 1, toolName: 'read' })
  const builtin = await waitFor(8)
  assert.equal(builtin.result?.contractTool?.source, 'builtin', 'package collision cannot replace the builtin')
  send(9, 'packages/list')
  const after = await waitFor(9)
  assert.ok(after.result?.packages?.[0]?.diagnostics?.some((item: { code?: string }) => item.code === 'tool-name-collision'))
  send(10, 'packages/set-tools-enabled', { source: 'npm:pi-tool-fixture@1.2.3', enabled: false })
  assert.equal((await waitFor(10)).result?.packages?.[0]?.toolTrust, 'trusted-disabled')
  send(11, 'turn/submit', {
    sessionId, runId: 'package-tool-disabled-run', cwd: workspace, prompt: 'Return ready.',
    profile: { provider: 'loopback', model: 'smoke-model', thinkingLevel: 'off', compaction: 'manual', approvalMode: 'full', unattended: false },
  })
  assert.equal((await waitFor(11)).result?.settlement, 'answered')
  send(12, 'tools/contract', { sessionId, revision: 2, toolName: 'package_echo' })
  assert.equal((await waitFor(12)).error?.code, 'tool_contract_unknown_tool', 'disabled package is absent from the next same-session contract')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  modelServer.close()
  await Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ])
}

console.log('Pi package tools require explicit Host trust and publish exact provenance')
