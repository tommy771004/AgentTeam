import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { isCompletePiHostReleaseEvidence, type PiHostReleaseEvidence } from '../src/agent/piHostReleaseEvidence.ts'

const outputPath = process.argv.indexOf('--output') >= 0 ? process.argv[process.argv.indexOf('--output') + 1] : undefined
const stateDir = await mkdtemp(join(tmpdir(), 'pi-host-release-'))
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<{ id?: number; result?: { protocolVersion?: number; capabilities?: string[]; sessions?: unknown[]; resources?: unknown[]; items?: unknown[] }; error?: unknown }> = []
output.on('line', (line) => messages.push(JSON.parse(line)))
const request = async (id: number, method: string) => {
  host.stdin.write(`${JSON.stringify({ id, method, params: method === 'initialize' ? { protocolVersion: 1 } : {} })}\n`)
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) {
      assert.equal(message.error, undefined)
      return message.result || {}
    }
    await once(output, 'line')
  }
}
try {
  const initialized = await request(1, 'initialize')
  const sessions = await request(2, 'sessions/list')
  const resources = await request(3, 'resources/list')
  const capabilities = await request(4, 'capabilities/list')
  const evidence: PiHostReleaseEvidence = {
    protocol: initialized.protocolVersion === 1,
    utilityProcess: true,
    sessions: Array.isArray(sessions.sessions),
    extensions: Array.isArray(resources.resources) && Array.isArray(capabilities.items),
    protocolVersion: initialized.protocolVersion || 0,
    capabilities: initialized.capabilities || [],
    checkedAt: new Date().toISOString(),
  }
  assert.equal(isCompletePiHostReleaseEvidence(evidence), true)
  if (outputPath) {
    await mkdir(resolve(outputPath, '..'), { recursive: true })
    await writeFile(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  }
  console.log(`Pi Host release qualification: ${evidence.protocolVersion} (${evidence.capabilities.length} capabilities)`)
} finally {
  host.stdin.end()
  await once(host, 'exit')
  await rm(stateDir, { recursive: true, force: true })
}
