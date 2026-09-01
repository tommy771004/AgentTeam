import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const requests: string[] = []
const registry = createServer((request, response) => {
  requests.push(request.url || '')
  response.setHeader('content-type', 'application/json')
  if (request.url?.startsWith('/-/v1/search')) {
    response.end(JSON.stringify({ objects: [{ package: {
      name: '@fixture/pi-review',
      version: '2.3.4',
      description: 'Controlled Pi review package',
      keywords: ['pi-package'],
      links: { npm: 'https://www.npmjs.com/package/@fixture/pi-review', repository: 'https://github.com/fixture/pi-review' },
    } }] }))
    return
  }
  if (request.url === '/%40fixture%2Fpi-review/2.3.4') {
    response.end(JSON.stringify({
      name: '@fixture/pi-review', version: '2.3.4', keywords: ['pi-package'],
      pi: { extensions: ['./extensions'], skills: ['./skills'], prompts: ['./prompts'] },
      repository: { type: 'git', url: 'git+https://github.com/fixture/pi-review.git' },
    }))
    return
  }
  response.writeHead(404).end(JSON.stringify({ error: 'not found' }))
})
await new Promise<void>((done) => registry.listen(0, '127.0.0.1', done))
const address = registry.address()
if (!address || typeof address === 'string') throw new Error('registry fixture did not bind')

const stateDir = await mkdtemp(join(tmpdir(), 'pi-package-catalog-state-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: {
    ...process.env,
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: join(stateDir, 'agent'),
    SUBAGENTS_PI_NATIVE_AGENT_DIR: join(stateDir, 'empty-native-agent'),
    SUBAGENTS_PI_SYNC_CLI_OAUTH: 'false',
    SUBAGENTS_PI_NPM_REGISTRY: `http://127.0.0.1:${address.port}`,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, any>> = []
output.on('line', (line) => messages.push(JSON.parse(line)))
const send = (id: number, method: string, params: Record<string, unknown> = {}) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const waitFor = async (id: number) => {
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([once(output, 'line'), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`timeout ${id}`)), 10_000) })])
    } finally { clearTimeout(timeout) }
  }
}

try {
  send(1, 'initialize', { protocolVersion: 5, capabilities: ['packages'] })
  assert.equal((await waitFor(1)).error, undefined)
  send(2, 'packages/catalog-search', { query: 'review', limit: 50, workspace: 'must-not-leave-host' })
  const response = await waitFor(2)
  assert.equal(response.error, undefined)
  assert.deepEqual(response.result?.packageCatalog?.[0], {
    name: '@fixture/pi-review',
    version: '2.3.4',
    source: 'npm:@fixture/pi-review@2.3.4',
    description: 'Controlled Pi review package',
    repositoryUrl: 'https://github.com/fixture/pi-review',
    npmUrl: 'https://www.npmjs.com/package/@fixture/pi-review',
    piDevUrl: 'https://pi.dev/packages/%40fixture%2Fpi-review',
    compatibility: [
      { kind: 'extensions', status: 'unknown' },
      { kind: 'skills', status: 'supported' },
      { kind: 'prompts', status: 'unsupported' },
    ],
  })
  assert.ok(requests[0]?.includes('text=keywords%3Api-package+review'))
  assert.ok(requests[0]?.includes('size=12'), 'result size is Host-bounded')
  assert.ok(requests.every((url) => !url.includes('must-not-leave-host')), 'catalog sends only the explicit query')
} finally {
  host.stdin.end()
  await once(host, 'exit')
  registry.close()
  await rm(stateDir, { recursive: true, force: true })
}

console.log('Pi package catalog is bounded discovery metadata, not installed authority')
