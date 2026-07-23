import { strict as assert } from 'node:assert'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const stateDir = await mkdtemp(join(tmpdir(), 'pi-extension-state-'))
const statePath = join(stateDir, 'state.json')
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], { env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath }, stdio: ['pipe', 'pipe', 'inherit'] })
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, any>))
const waitFor = async (predicate: (message: Record<string, any>) => boolean) => { for (;;) { const found = messages.find(predicate); if (found) return found; await once(output, 'line') } }
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 1 }); await waitFor((m) => m.id === 1)
  send(2, 'extensions/install', { id: 'demo-package', name: 'Demo Package', version: '1.0.0', kind: 'package', source: 'marketplace:demo-package', trusted: true, tools: ['demo_lookup'], credentialRefs: ['demo-token'] })
  const installed = await waitFor((m) => m.id === 2)
  assert.equal(installed.result?.extension?.id, 'demo-package')
  assert.ok(messages.some((m) => m.event === 'host/extension' && m.payload?.action === 'installed' && m.payload?.extension?.id === 'demo-package'))
  send(3, 'extensions/list'); const listed = await waitFor((m) => m.id === 3)
  assert.deepEqual(listed.result?.extensions?.[0], { id: 'demo-package', name: 'Demo Package', version: '1.0.0', kind: 'package', source: 'marketplace:demo-package', enabled: true, trusted: true, tools: ['demo_lookup'], credentialRefs: ['demo-token'] })
  send(4, 'extensions/set-enabled', { id: 'demo-package', enabled: false }); const disabled = await waitFor((m) => m.id === 4)
  assert.equal(disabled.result?.extension?.enabled, false)
  send(5, 'extensions/update', { id: 'demo-package', version: '1.1.0', source: 'marketplace:demo-package@1.1.0' }); const updated = await waitFor((m) => m.id === 5)
  assert.equal(updated.result?.extension?.version, '1.1.0')
  send(6, 'extensions/uninstall', { id: 'demo-package' }); const removed = await waitFor((m) => m.id === 6)
  assert.equal(removed.result?.removed, true)
  send(7, 'extensions/install', { id: 'fixture-mcp', name: 'Fixture MCP', version: '1.0.0', kind: 'mcp', source: 'test-fixture', trusted: false, tools: ['echo'], mcp: { command: process.execPath, args: [resolve(import.meta.dirname, 'pi-mcp-fixture.mjs')] } })
  await waitFor((m) => m.id === 7)
  send(8, 'tools/list'); const toolList = await waitFor((m) => m.id === 8)
  assert.ok(toolList.result?.builtinTools?.includes('mcp_fixture-mcp_echo'))
  send(9, 'tools/mcp', { extensionId: 'fixture-mcp', toolName: 'echo', arguments: { text: 'hello' }, runId: 'mcp-run', approval: 'allow' })
  const mcpResult = await Promise.race([waitFor((m) => m.id === 9), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP response timeout: ${JSON.stringify(messages)}`)), 3_000))])
  assert.match(String(mcpResult.result?.content?.[0]?.text || ''), /echo:hello/)
  assert.ok(messages.some((m) => m.event === 'host/tool-result' && m.payload?.tool === 'mcp_fixture-mcp_echo' && m.payload?.settlement === 'success'))
  send(10, 'extensions/uninstall', { id: 'fixture-mcp' }); assert.equal((await waitFor((m) => m.id === 10)).result?.removed, true)
} finally {
  host.stdin.end(); await once(host, 'exit'); await rm(stateDir, { recursive: true, force: true })
}
console.log('Pi Host exposes typed package lifecycle and trust disclosure events')
