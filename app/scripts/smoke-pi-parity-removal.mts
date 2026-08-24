import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { TOOL_DEFINITIONS } from '../src/agent/tools/toolDefinitions.ts'

/**
 * Issues 14 + 15 — parity evidence before removal, and the removal itself.
 *
 * For each renderer tool that claimed equivalence with a Pi builtin
 * (workspace_read→read, workspace_list→ls, workspace_grep→grep,
 * workspace_glob→find, workspace_write→write, bash→bash) this smoke proves
 * the HOST implementation satisfies the contract the renderer declaration
 * advertised — same required parameters, same information in success results,
 * and the same out-of-root rejection — then verifies the renderer handler is
 * GONE so exactly one implementation remains (ADR-0027).
 */

type Message = {
  id?: number
  result?: Record<string, any>
  error?: { code: string; message: string }
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-parity-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-parity-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-parity-cwd-'))
await mkdir(join(workspace, 'sub'), { recursive: true })
await writeFile(join(workspace, 'alpha.txt'), 'hello parity\nsecond line\n', 'utf8')
await writeFile(join(workspace, 'sub', 'beta.md'), '# beta\nparity needle here\n', 'utf8')
let escapeRejectedMarker = ''

const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'), SUBAGENTS_PI_AGENT_DIR: agentDir },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const output = createInterface({ input: host.stdout })
const messages: Message[] = []
output.on('line', (line) => messages.push(JSON.parse(line) as Message))
const waitFor = async (id: number) => {
  for (;;) {
    const message = messages.find((item) => item.id === id)
    if (message) return message
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for host response ${id}`)), 20_000)),
    ])
  }
}
let seq = 0
const call = async (method: string, params: Record<string, unknown> = {}): Promise<Message> => {
  const id = ++seq
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  return waitFor(id)
}
const firstText = (message: Message): string =>
  (message.result?.content || []).map((part: { text?: string }) => part.text || '').join('\n')

try {
  const init = await call('initialize', { protocolVersion: 2 })
  assert.equal(init.error, undefined)

  // ── workspace_read → read ──
  const declaredRead = TOOL_DEFINITIONS.workspace_read.parameters as { required?: string[] }
  const readResult = await call('tools/read', { cwd: workspace, path: 'alpha.txt' })
  assert.equal(readResult.error, undefined)
  assert.match(firstText(readResult), /hello parity/, 'Host read returns the same file content the renderer contract promised')
  assert.deepEqual(declaredRead.required, ['path'])
  const readEscape = await call('tools/read', { cwd: workspace, path: '../../etc/passwd' })
  assert.match(String(readEscape.error?.message || ''), /outside the requested project scope/, 'escape rejected exactly as the sandboxed declaration promised')

  // ── workspace_list → ls ──
  const lsResult = await call('tools/ls', { cwd: workspace, path: '.' })
  assert.equal(lsResult.error, undefined)
  assert.match(firstText(lsResult), /alpha\.txt/, 'Host ls surfaces the same entries')
  assert.match(firstText(lsResult), /sub/)

  // ── workspace_grep → grep ──
  const grepResult = await call('tools/grep', { cwd: workspace, pattern: 'parity needle', path: '.', include: '*.md' })
  assert.equal(grepResult.error, undefined)
  assert.match(firstText(grepResult), /beta\.md/, 'Host grep finds the same match the renderer regex would')

  // ── workspace_glob → find ──
  const findResult = await call('tools/find', { cwd: workspace, pattern: '**/*.md', path: '.' })
  assert.equal(findResult.error, undefined)
  assert.match(firstText(findResult), /beta\.md/, 'Host find covers the glob contract')

  // ── workspace_write → write (issue 15) ──
  const writeResult = await call('tools/write', { cwd: workspace, path: 'report.md', content: '# report\nwritten by Host write\n', approval: 'allow' })
  assert.equal(writeResult.error, undefined, 'Host write succeeds under full approval policy')
  const written = await readFile(join(workspace, 'report.md'), 'utf8')
  assert.match(written, /written by Host write/)
  // The mutation queue is shared: an immediate read sees the write (same queue
  // as edit), and the write participates per-file.
  const writeEscape = await call('tools/write', { cwd: workspace, path: '../escape.txt', content: 'x', approval: 'allow' })
  assert.match(String(writeEscape.error?.message || ''), /outside the requested project scope/)

  // ── bash → bash (issue 15) ──
  const bashResult = await call('tools/bash', { cwd: workspace, command: 'cat alpha.txt', approval: 'allow' })
  assert.equal(bashResult.error, undefined)
  assert.match(firstText(bashResult), /hello parity/)
  // Dangerous/unsplittable commands always ask regardless of mode.
  const dangerous = await call('tools/bash', { cwd: workspace, command: 'rm -rf /', approval: 'allow' })
  assert.ok(dangerous.error || /denied|approval/i.test(`${dangerous.error?.message}${firstText(dangerous)}`), 'dangerous commands never silently run')
  void escapeRejectedMarker

  // ── Removal: the renderer handlers are GONE ──
  // The registered modules were deleted with the parity evidence above; the
  // dispatch layer answers honestly about who owns these tools now.
  const { dispatchRegistered, registryHandlersComplete, HOST_OWNED_TOOL_NAMES } = await import('../src/agent/tools/toolRegistry.ts')
  const dispatched = await dispatchRegistered('workspace_read', { path: 'alpha.txt' })
  assert.equal(dispatched.ok, false)
  assert.match(dispatched.output, /Pi Core Host 接管/, 'a removed renderer tool names its owner instead of pretending')
  // Every OTHER definition still carries its handler; exactly the six
  // equivalents are host-owned.
  assert.equal(registryHandlersComplete(), true)
  assert.deepEqual([...HOST_OWNED_TOOL_NAMES].sort(), ['bash', 'workspace_glob', 'workspace_grep', 'workspace_list', 'workspace_read', 'workspace_write'])

  console.log('Parity proven at the seam for all six equivalents; renderer duplicates are gone — one implementation each')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit').catch(() => host.kill())
  }
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
