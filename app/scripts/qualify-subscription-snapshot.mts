import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * ADR-0052 ticket 06 security probe — boots the REAL host entry against the
 * REAL agent dir, negotiates v4 like the app client does, pulls every
 * snapshot-bearing surface, and scans the FULL serialized text for
 * credential-shaped material. Only verdicts are printed; payload text is
 * never echoed.
 */

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../electron/piHostEntry.ts')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-sub-qual-'))
const host = spawn(process.execPath, ['--experimental-strip-types', hostEntry], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, unknown>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, unknown>))
const send = (id: number, method: string, params: Record<string, unknown> = {}) =>
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const waitFor = async (id: number): Promise<Record<string, unknown>> => {
  for (;;) {
    const found = messages.find((m) => m.id === id)
    if (found) return found
    await once(output, 'line')
  }
}

try {
  send(1, 'initialize', { protocolVersion: 4, client: 'subagents-qualify', capabilities: ['attachments-v1', 'tool-contract-v1'] })
  const ready = await waitFor(1)
  if ((ready.result as { protocolVersion?: number } | undefined)?.protocolVersion !== 4) {
    throw new Error(`expected negotiated protocolVersion 4, got ${JSON.stringify((ready.result as { protocolVersion?: number })?.protocolVersion)}`)
  }
  send(2, 'settings/get', {})
  const settingsGet = await waitFor(2)
  send(3, 'state/snapshot', {})
  const snapshot = await waitFor(3)

  const surfaces = [
    ['settings/get', JSON.stringify(settingsGet.result)],
    ['state/snapshot', JSON.stringify(snapshot.result)],
    ['host events so far', JSON.stringify(messages.filter((m) => m.event))],
  ]
  // Credential-shaped markers: OAuth token field names, JWT segments,
  // account-id-ish keys. The catalog may say a provider is available; it may
  // not carry the material that makes it so.
  const patterns: Array<[string, RegExp]> = [
    ['accessToken field', /"(access|refresh)_?token"\s*:/i],
    ['token value key', /"id_token"/i],
    ['jwt shape', /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./],
    ['apiKey non-empty', /"apiKey"\s*:\s*"(?!")/i],
    ['openai api key literal', /sk-[A-Za-z0-9]{16,}/],
    ['anthropic key literal', /sk-ant-[A-Za-z0-9_-]{8,}/],
    ['account id field', /"account_?id"\s*:/i],
  ]
  let clean = true
  for (const [surface, text] of surfaces) {
    for (const [name, re] of patterns) {
      if (re.test(text)) {
        clean = false
        console.error(`FAIL ${surface}: contains ${name}`)
      }
    }
  }
  const catalog = (settingsGet.result as { config?: { subscriptionCatalog?: Array<{ id: string; availability: string; modelTotal: number }> } } | undefined)?.config?.subscriptionCatalog
  console.log('negotiated protocol: v4')
  console.log('subscriptionCatalog rows:', catalog ? catalog.map((r) => `${r.id}=${r.availability}(models=${r.modelTotal})`).join(' ') : '(absent — no synced credentials on this machine)')
  console.log(clean ? 'SECURITY PROBE PASS: no credential-shaped data in any snapshot surface' : 'SECURITY PROBE FAIL')
  if (!clean) process.exitCode = 1
} finally {
  host.stdin.end()
  await once(host, 'exit').catch(() => host.kill())
  await rm(stateDir, { recursive: true, force: true })
}
