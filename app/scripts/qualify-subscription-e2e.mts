import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Handshake version comes from the protocol module's source — never a second
// literal (ticket 03).
const QUALIFY_PROTOCOL_VERSION = Number(
  (await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8'))
    .match(/PI_HOST_PROTOCOL_VERSION = (\d+) as const/)?.[1],
)

/**
 * ADR-0052 ticket 06 — real end-to-end over a CLI subscription.
 *
 * Boots the real host entry with an ISOLATED agent dir and the OAuth sync
 * deliberately enabled, so the developer's real `~/.codex/auth.json` is
 * imported into the isolation dir. Then: builtin session → one tiny turn →
 * the settlement must be `answered` through the subscription model, and the
 * Turn Record must hold the exchange. This is the same path a user's
 *「Pi loop + 訂閱模型」run takes; no vendor binary is spawned anywhere.
 */

const hostEntry = process.env.PI_HOST_ENTRY || resolve(import.meta.dirname, '../electron/piHostEntry.ts')
const stateDir = await mkdtemp(join(tmpdir(), 'pi-sub-e2e-'))
const host = spawn(process.execPath, ['--experimental-strip-types', hostEntry], {
  env: {
    ...process.env,
    SUBAGENTS_PI_SYNC_CLI_OAUTH: 'true',
    SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
    SUBAGENTS_PI_AGENT_DIR: join(stateDir, 'agent'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Array<Record<string, unknown>> = []
output.on('line', (line) => messages.push(JSON.parse(line) as Record<string, unknown>))
const send = (id: number, method: string, params: Record<string, unknown> = {}) =>
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
const waitFor = async (predicate: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
  for (;;) {
    const found = messages.find(predicate)
    if (found) return found
    await once(output, 'line')
  }
}

try {
  send(1, 'initialize', { protocolVersion: QUALIFY_PROTOCOL_VERSION, client: 'subagents-subscription-e2e', capabilities: ['attachments-v1', 'tool-contract-v1'] })
  await waitFor((m) => m.id === 1)

  // The sync must have landed the codex credential into the isolated dir…
  send(2, 'settings/get', {})
  await waitFor((m) => m.id === 2)

  send(3, 'sessions/create', { title: 'Subscription qualification' })
  const created = await waitFor((m) => m.id === 3)
  const sessionId = String((created.result as { sessionId?: string } | undefined)?.sessionId)
  if (!sessionId) throw new Error(`sessions/create failed: ${JSON.stringify(created.error || created.result).slice(0, 200)}`)

  // …and the catalog inside THIS host process must see codex as available
  // with at least one resolvable model before we spend a real turn.
  const settingsGet = messages.find((m) => m.id === 2)
  const catalog = ((settingsGet?.result as { config?: { subscriptionCatalog?: Array<{ id: string; availability: string; models: Array<{ id: string }> }> } }) || {}).config?.subscriptionCatalog
  const codex = catalog?.find((row) => row.id === 'openai-codex')
  if (!codex || codex.availability !== 'available' || !codex.models.length) {
    throw new Error(`codex subscription is not usable on this machine: ${JSON.stringify(catalog)}`)
  }
  console.log(`catalog: openai-codex available with ${codex.models.length} model(s): ${codex.models.map((m) => m.id).join(', ')}`)

  // Not every catalog model is entitled on every subscription plan; the
  // qualification accepts ANY one model that completes a real turn, and
  // records the ones the account rejects (honest vendor errors surface as
  // explained failures — that is the fail-closed contract working).
  // Single-model probe mode: `node qualify-subscription-e2e.mts <modelId>`
  // spends exactly one turn on the named model instead of scanning the catalog.
  const onlyModel = process.argv[2]
  const candidates = onlyModel ? codex.models.filter((m) => m.id === onlyModel) : codex.models
  if (!candidates.length) throw new Error(`model ${onlyModel} not in catalog`)
  let settled: Record<string, unknown> | undefined
  let chosen = ''
  const rejected: string[] = []
  for (const candidate of candidates) {
    send(4, 'settings/update', { provider: 'openai-codex', model: candidate.id })
    const updated = await waitFor((m) => m.id === 4)
    if (updated.error) throw new Error(`settings/update rejected the subscription patch: ${JSON.stringify(updated.error).slice(0, 200)}`)
    send(5, 'turn/submit', { sessionId, runId: `sub-qual-${candidate.id}`, prompt: 'Reply with exactly: pong' })
    const attempt = await waitFor((m) => m.id === 5)
    const result = attempt.result as { settlement?: string } | undefined
    if (result?.settlement === 'answered') {
      settled = attempt
      chosen = candidate.id
      break
    }
    const detail = JSON.stringify(attempt.error || attempt.result || {}, null, 0).slice(0, 500)
    rejected.push(`${candidate.id}: ${detail}`)
    console.log(`  candidate ${candidate.id} did not complete (${result?.settlement || 'error'}): ${detail}`)
  }
  if (!settled) {
    throw new Error(`no catalog model completed a subscription turn. Attempts:\n${rejected.join('\n')}`)
  }
  const result = settled.result as { settlement?: string; items?: Array<{ content?: string }> } | undefined
  const answer = result?.items?.map((item) => item.content || '').join(' ') || ''
  if (!answer.trim()) throw new Error('an answered settlement carried no answer text')
  console.log(`entitled model found: ${chosen} (rejected along the way: ${rejected.length})`)

  send(6, 'sessions/record', { sessionId, limit: 20 })
  const record = await waitFor((m) => m.id === 6)
  const recordText = JSON.stringify(record.result)
  if (!recordText.includes('pong')) throw new Error('the Turn Record does not contain the exchange')

  console.log(`settlement: ${result.settlement}; answer contained pong: ${recordText.includes('pong')}`)
  console.log('SUBSCRIPTION E2E PASS: builtin Pi loop answered through the CLI subscription; Turn Record holds the exchange')
} finally {
  host.stdin.end()
  await once(host, 'exit').catch(() => host.kill())
  await rm(stateDir, { recursive: true, force: true })
}
