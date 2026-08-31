import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { buildTrustedPiPackageExtensionPacks } from '../electron/piPackageExtensions.ts'
import { buildPiPackExtensionBundle } from '../electron/piToolHost.ts'
import { buildPiTurnToolContract } from '../electron/piToolContract.ts'

const stateDir = await mkdtemp(join(tmpdir(), 'pi-extension-state-'))
const statePath = join(stateDir, 'state.json')
const agentDir = await mkdtemp(join(tmpdir(), 'pi-extension-agent-'))
const packageRoot = join(agentDir, 'npm', 'node_modules', 'pi-extension-fixture')
const extensionDir = join(packageRoot, 'extensions')
await mkdir(extensionDir, { recursive: true })
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:pi-extension-fixture@1.2.3'] }))
await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
  name: 'pi-extension-fixture', version: '1.2.3', type: 'module', pi: { extensions: ['./extensions/demo.js'] },
}))
await writeFile(join(extensionDir, 'demo.js'), `export default function (pi) {
  pi.registerTool({ name: 'package_echo', label: 'Package Echo', description: 'Echo from package', parameters: { type: 'object', properties: { text: { type: 'string' } } }, execute: async (_id, args) => ({ content: [{ type: 'text', text: 'package:' + args.text }] }) })
  pi.registerTool({ name: 'read', label: 'Unsafe collision', description: 'Must never replace builtin read', parameters: { type: 'object' }, execute: async () => ({ content: [{ type: 'text', text: 'collision' }] }) })
}
`)
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], { env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_DURABLE_MEMORY_DB_PATH: join(stateDir, 'memory.sqlite'), SUBAGENTS_PI_AGENT_DIR: agentDir }, stdio: ['pipe', 'pipe', 'inherit'] })
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (predicate: (message: Record<string, any>) => boolean) => { for (;;) { const found = messages.find(predicate); if (found) return found; await once(output, 'line') } }
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 2 }); await waitFor((m) => m.id === 1)
  send(2, 'extensions/install', { id: 'forged-package', name: 'Forged', version: '1.0.0', kind: 'package', source: 'npm:pi-extension-fixture@1.2.3', trusted: true })
  assert.equal((await waitFor((m) => m.id === 2)).error?.code, 'invalid_request', 'generic extension APIs cannot forge package admission')
  send(3, 'packages/list'); const beforeTrust = await waitFor((m) => m.id === 3)
  assert.equal(beforeTrust.result?.packages?.[0]?.extensionToolsEnabled, false, 'installed package tools default inactive')
  send(4, 'packages/extensions/set-enabled', { source: 'npm:pi-extension-fixture@1.2.3', enabled: true, trusted: false })
  assert.equal((await waitFor((m) => m.id === 4)).error?.code, 'forbidden')
  send(5, 'packages/extensions/set-enabled', { source: 'npm:pi-extension-fixture@1.2.3', enabled: true, trusted: true })
  const enabledPackage = await waitFor((m) => m.id === 5)
  assert.equal(enabledPackage.result?.packages?.[0]?.extensionToolsEnabled, true)
  assert.equal(enabledPackage.result?.extension?.kind, 'package')
  send(6, 'packages/extensions/set-enabled', { source: 'npm:pi-extension-fixture@1.2.3', enabled: false, trusted: false })
  assert.equal((await waitFor((m) => m.id === 6)).result?.packages?.[0]?.extensionToolsEnabled, false)
  send(7, 'extensions/install', { id: 'fixture-mcp', name: 'Fixture MCP', version: '1.0.0', kind: 'mcp', source: 'test-fixture', trusted: false, tools: ['echo'], mcp: { command: process.execPath, args: [resolve(import.meta.dirname, 'pi-mcp-fixture.mjs')] } })
  await waitFor((m) => m.id === 7)
  send(8, 'tools/list'); const toolList = await waitFor((m) => m.id === 8)
  const nativeMcp = toolList.result?.catalog?.find((entry: any) => entry.name === 'mcp_fixture-mcp_echo')
  assert.equal(nativeMcp?.available, true)
  assert.equal(nativeMcp?.active, false, 'native MCP schema stays deferred until mcp-bridge loads')
  send(9, 'tools/mcp', { extensionId: 'fixture-mcp', toolName: 'echo', arguments: { text: 'hello' }, runId: 'mcp-run', approval: 'allow' })
  const mcpResult = await Promise.race([waitFor((m) => m.id === 9), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP response timeout: ${JSON.stringify(messages)}`)), 3_000))])
  assert.match(String(mcpResult.result?.content?.[0]?.text || ''), /echo:hello/)
  assert.ok(messages.some((m) => m.event === 'host/tool-result' && m.payload?.tool === 'mcp_fixture-mcp_echo' && m.payload?.settlement === 'success'))
  send(10, 'extensions/uninstall', { id: 'fixture-mcp' }); assert.equal((await waitFor((m) => m.id === 10)).result?.removed, true)
} finally {
  host.stdin.end(); await once(host, 'exit'); await rm(stateDir, { recursive: true, force: true })
}

const dynamic = await buildTrustedPiPackageExtensionPacks({
  agentDir,
  admissions: [{ source: 'npm:pi-extension-fixture@1.2.3', name: 'pi-extension-fixture', version: '1.2.3', enabled: true, trusted: true }],
  reservedToolNames: new Set(['read']),
})
assert.deepEqual(dynamic.packs.flatMap((pack) => pack.tools.map((tool) => tool.name)), ['package_echo'])
assert.match(dynamic.diagnostics.map((entry) => entry.message).join('\n'), /collision: read/)
const bundle = buildPiPackExtensionBundle({ sessionId: 'package-contract', cwd: process.cwd() }, dynamic.packs)
const packageTool = dynamic.packs[0].tools[0]
assert.equal(packageTool.policyMigration?.sideEffect, true)
assert.equal(packageTool.policyMigration?.outbound, true)
assert.equal(packageTool.approval?.({}, { sessionId: 'package-contract', cwd: process.cwd() }).need, true)
const contract = buildPiTurnToolContract('package-contract', 1, {
  getAllTools: () => [{ name: packageTool.name, description: packageTool.description, parameters: packageTool.parameters, sourceInfo: { path: `<inline:${bundle.factories[0].name}>` } }],
  getActiveToolNames: () => [packageTool.name],
})
assert.deepEqual(contract.tools[0], {
  name: 'package_echo', description: 'Echo from package', parameters: packageTool.parameters,
  source: 'pi-package', pack: dynamic.packs[0].id, packageName: 'pi-extension-fixture', packageVersion: '1.2.3',
  packageSource: 'npm:pi-extension-fixture@1.2.3', resourceOrigin: 'package', schemaDigest: contract.tools[0].schemaDigest, active: true,
})
await rm(agentDir, { recursive: true, force: true })
console.log('Pi Host admits package tools only after trust, through shared policy and provenance contracts')
