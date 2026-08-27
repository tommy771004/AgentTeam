import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'pi-memory-migration-'))
const statePath = join(root, 'state.json')
const hostBundle = resolve(import.meta.dirname, '../dist-electron/pi-host.js')

async function startup(): Promise<{ code: number | null; stdout: string }> {
  const child = spawn(process.execPath, [hostBundle], {
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_AGENT_DIR: join(root, 'agent') },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.resume()
  const closed = once(child, 'close')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000)
  child.stdin.on('error', () => {})
  child.stdin.end(`${JSON.stringify({ id: 1, method: 'initialize', params: { protocolVersion: 4, capabilities: ['memory-store-v1'] } })}\n`)
  try {
    const [code, signal] = await closed
    assert.equal(signal, null, 'Host startup must finish without hitting the test timeout')
    return { code, stdout }
  } finally {
    clearTimeout(timeout)
  }
}

try {
  const invalidMemoryCollection = JSON.stringify({ schemaVersion: 2, cursor: 0, sessions: [], settings: { model: 'test', activeTools: [] }, memories: { unexpected: 'object' } })
  for (const source of ['{"schemaVersion":2,"memories":[', '{"schemaVersion":999}', invalidMemoryCollection]) {
    await writeFile(statePath, source, { mode: 0o600 })
    const result = await startup()
    assert.notEqual(result.code, 0, 'unreadable or unsupported state must refuse startup')
    assert.equal(result.stdout.includes('"id":1'), false, 'unreadable state must not acknowledge initialize')
    assert.equal(await readFile(statePath, 'utf8'), source, 'refused startup must preserve the source bytes')
  }
  console.log('Pi Host memory migration: corrupt and unsupported snapshots fail closed without overwriting the source')
} finally {
  await rm(root, { recursive: true, force: true })
}
