import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

type CatalogEntry = {
  name: string
  description: string
  pack: string
  source: 'discovered' | 'installed'
  active: boolean
  available: boolean
  reason?: string
  schemaDigest: string
}
type Message = {
  id?: number
  result?: { builtinTools?: string[]; catalog?: CatalogEntry[] }
  error?: { code: string; message: string }
}

const hostEntry = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-catalog-'))
const statePath = join(stateDir, 'state.json')
const host = spawn(process.execPath, [hostEntry], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((candidate) => candidate.id === id)
    if (message) return message
    await once(output, 'line')
  }
}
const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
}

try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await waitFor(1)).error, undefined)

  send(2, 'tools/list', { requireContract: true })
  const first = await waitFor(2)
  assert.equal(first.error, undefined)
  const catalog = first.result?.catalog || []
  assert.ok(catalog.length > 0)
  assert.deepEqual(catalog.map((entry) => entry.name), catalog.map((entry) => entry.name).sort((a, b) => a.localeCompare(b)))
  assert.equal(new Set(catalog.map((entry) => entry.name)).size, catalog.length)
  assert.ok(catalog.every((entry) => /^[a-f0-9]{64}$/.test(entry.schemaDigest)), 'every catalog entry has a schema digest')
  assert.ok(catalog.some((entry) => entry.source === 'discovered' && entry.pack === 'builtin'))
  const deferred = catalog.find((entry) => entry.name === 'web_search')
  assert.equal(deferred?.active, false)
  assert.match(deferred?.reason || '', /Inactive this turn/)
  assert.deepEqual(first.result?.builtinTools, catalog.filter((entry) => entry.active && entry.available).map((entry) => entry.name))

  send(3, 'extensions/install', { id: 'broken-mcp', name: 'Broken MCP', version: '1.0.0', kind: 'mcp', source: 'smoke', tools: ['echo'], mcp: { command: 'definitely-not-a-real-mcp-command', args: [] } })
  assert.equal((await waitFor(3)).error, undefined)
  send(4, 'tools/list', { requireContract: true })
  const unavailable = (await waitFor(4)).result?.catalog?.find((entry) => entry.name === 'mcp_broken-mcp_echo')
  assert.equal(unavailable?.available, false)
  // The projection names WHY the tool is unavailable, not just that it is:
  // `MCP ${category}: ${detail}` (piHostProtocol unavailable()). A transport
  // that never came up is 'transport-failed', and the detail carries the
  // spawn error so the catalog can be acted on rather than only read.
  assert.match(unavailable?.reason || '', /MCP transport-failed:/)
  assert.match(unavailable?.reason || '', /definitely-not-a-real-mcp-command/)

  send(5, 'settings/update', { activeTools: ['read'] })
  assert.equal((await waitFor(5)).error, undefined)
  send(6, 'tools/list', { requireContract: true })
  const restrictedResponse = await waitFor(6)
  const restricted = restrictedResponse.result?.catalog?.find((entry) => entry.name === 'bash')
  assert.equal(restricted?.active, false)
  assert.match(restricted?.reason || '', /disabled by Pi active tools settings/)

  send(7, 'tools/list', { requireContract: true })
  const repeated = await waitFor(7)
  send(8, 'tools/list', { requireContract: true })
  const repeatedAgain = await waitFor(8)
  assert.deepEqual(repeatedAgain.result?.catalog, repeated.result?.catalog, 'same Host snapshot is stable regardless of discovery response timing')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}

const incompatibleState = await mkdtemp(join(tmpdir(), 'pi-host-catalog-incompatible-'))
const incompatible = spawn(process.execPath, [hostEntry], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(incompatibleState, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const incompatibleOutput = createInterface({ input: incompatible.stdout })
const incompatibleMessages: Message[] = []
incompatibleOutput.on('line', (line) => incompatibleMessages.push(JSON.parse(line) as Message))
const incompatibleWaitFor = async (id: number) => {
  for (;;) {
    const message = incompatibleMessages.find((candidate) => candidate.id === id)
    if (message) return message
    await once(incompatibleOutput, 'line')
  }
}
try {
  incompatible.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 2, capabilities: [] } })}\n`)
  assert.equal((await incompatibleWaitFor(1)).error, undefined)
  incompatible.stdin.write(`${JSON.stringify({ id: 2, method: 'tools/list', params: { requireContract: true } })}\n`)
  assert.equal((await incompatibleWaitFor(2)).error?.code, 'invalid_request')
} finally {
  incompatible.stdin.end()
  await once(incompatible, 'exit')
  await rm(incompatibleState, { recursive: true, force: true })
}

const settingsSource = await readFile(resolve(import.meta.dirname, '../src/pages/SettingsPage.tsx'), 'utf8')
assert.match(settingsSource, /window\.subagents\?\.piHost\?\.tools\?\.catalog/)
assert.match(settingsSource, /plain-browser compatibility mode/)
assert.match(settingsSource, /schemaDigest/)
assert.doesNotMatch(settingsSource, /toolCatalogEntries\(/)
console.log('Pi Host catalog projection and Settings fail-closed UI contract passed')
