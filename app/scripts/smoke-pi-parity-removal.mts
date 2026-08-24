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
 * advertised, then verifies the renderer handler is GONE so exactly one
 * implementation remains (ADR-0027).
 *
 * Ticket 15 asks for parity item by item — schema, success, error, streaming,
 * cancellation, project scope, session recording — so each is asserted here at
 * the one seam rather than inferred from a neighbouring smoke. Two of them are
 * proven as BEHAVIOUR, not string comparison:
 *
 *  - Schema parity cannot be a field-by-field diff: `tools/list` publishes tool
 *    NAMES, not schemas, and two of the equivalents renamed a parameter on the
 *    way across (workspace_grep `query` → grep `pattern`, workspace_glob
 *    `pattern` → find `pattern`). PARAMETER_PARITY below records that mapping
 *    explicitly, then proves the Host enforces the same requiredness: omitting
 *    a declared-required parameter fails, supplying only those succeeds.
 *  - The bash scope check is deliberately NOT asserted here. `tools/*` scopes
 *    on `params.path`, and bash has no path — its containment is ADR-0047's
 *    in-turn gate, proven in smoke-outbound-shell-evidence.mts. Asserting a
 *    scope rejection for bash at this layer would assert a guard that does not
 *    live here; the absence is recorded instead of papered over.
 */

type Message = {
  id?: number
  result?: Record<string, any>
  error?: { code: string; message: string }
  event?: string
  payload?: Record<string, any>
}

const agentDir = await mkdtemp(join(tmpdir(), 'pi-parity-agent-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-parity-state-'))
const workspace = await mkdtemp(join(tmpdir(), 'pi-parity-cwd-'))
await mkdir(join(workspace, 'sub'), { recursive: true })
await writeFile(join(workspace, 'alpha.txt'), 'hello parity\nsecond line\n', 'utf8')
await writeFile(join(workspace, 'sub', 'beta.md'), '# beta\nparity needle here\n', 'utf8')

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
const send = (method: string, params: Record<string, unknown> = {}): number => {
  const id = ++seq
  host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  return id
}
const call = async (method: string, params: Record<string, unknown> = {}): Promise<Message> =>
  waitFor(send(method, params))
/** Host events carry no id, so they are matched on the run they belong to. */
const eventsFor = (event: string, runId: string) =>
  messages.filter((item) => item.event === event && item.payload?.runId === runId)
const waitForEvent = async (event: string, runId: string) => {
  for (;;) {
    const found = eventsFor(event, runId)[0]
    if (found) return found
    await Promise.race([
      once(output, 'line'),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${event} on ${runId}`)), 20_000)),
    ])
  }
}
const firstText = (message: Message): string =>
  (message.result?.content || []).map((part: { text?: string }) => part.text || '').join('\n')

/**
 * The six equivalents, and what the renderer declaration promised about each.
 *
 * `declaredRequired` is asserted against the shipped TOOL_DEFINITIONS so a
 * silently loosened renderer contract fails here. `hostRequired` is what the
 * Host enforces; where the two lists differ the parameter was RENAMED across
 * the seam, and `renamed` records that so the divergence is documented rather
 * than discovered later.
 */
const PARAMETER_PARITY = [
  { rendererTool: 'workspace_read', hostMethod: 'tools/read', declaredRequired: ['path'], hostRequired: ['path'], minimal: { path: 'alpha.txt' } },
  { rendererTool: 'workspace_list', hostMethod: 'tools/ls', declaredRequired: undefined, hostRequired: [], minimal: { path: '.' } },
  { rendererTool: 'workspace_grep', hostMethod: 'tools/grep', declaredRequired: ['query'], hostRequired: ['path', 'pattern'], renamed: { query: 'pattern' }, minimal: { path: '.', pattern: 'parity' } },
  { rendererTool: 'workspace_glob', hostMethod: 'tools/find', declaredRequired: ['pattern'], hostRequired: ['pattern'], minimal: { pattern: '**/*.md' } },
  { rendererTool: 'workspace_write', hostMethod: 'tools/write', declaredRequired: ['path', 'content'], hostRequired: ['path', 'content'], minimal: { path: 'minimal.txt', content: 'minimal\n' }, approval: 'allow' },
  { rendererTool: 'bash', hostMethod: 'tools/bash', declaredRequired: ['command'], hostRequired: ['command'], minimal: { command: 'true' }, approval: 'allow' },
] as const

try {
  const init = await call('initialize', { protocolVersion: 2 })
  assert.equal(init.error, undefined)

  // ── Schema parity: declared contract, and the Host enforcing it ──
  for (const entry of PARAMETER_PARITY) {
    const declared = (TOOL_DEFINITIONS as Record<string, { parameters: { required?: string[] } }>)[entry.rendererTool]
    assert.ok(declared, `${entry.rendererTool} still declares a contract to be judged against`)
    assert.deepEqual(
      declared.parameters.required,
      entry.declaredRequired,
      `${entry.rendererTool} required parameters must not drift from the contract parity was proven against`,
    )
    // Only the declared-required parameters: the Host must accept that much.
    const minimal = await call(entry.hostMethod, {
      cwd: workspace,
      ...entry.minimal,
      ...('approval' in entry ? { approval: entry.approval } : {}),
    })
    assert.equal(minimal.error, undefined, `${entry.hostMethod} accepts exactly the declared-required parameters`)
    // …and reject when one is missing. A tool with no required parameters has
    // nothing to omit, so it is skipped rather than faked.
    for (const required of entry.hostRequired) {
      const omitted: Record<string, unknown> = { cwd: workspace, ...entry.minimal, ...('approval' in entry ? { approval: entry.approval } : {}) }
      delete omitted[required]
      const missing = await call(entry.hostMethod, omitted)
      assert.match(
        String(missing.error?.message || ''),
        /parameters are invalid/,
        `${entry.hostMethod} rejects a call missing \`${required}\``,
      )
    }
    if ('renamed' in entry) {
      for (const [rendererParam, hostParam] of Object.entries(entry.renamed as Record<string, string>)) {
        assert.notEqual(rendererParam, hostParam, 'a recorded rename must actually be a rename')
        assert.ok(
          entry.hostRequired.includes(hostParam),
          `${entry.hostMethod} requires \`${hostParam}\`, the name \`${rendererParam}\` became`,
        )
      }
    }
  }

  // ── workspace_read → read ──
  const readResult = await call('tools/read', { cwd: workspace, path: 'alpha.txt' })
  assert.equal(readResult.error, undefined)
  assert.match(firstText(readResult), /hello parity/, 'Host read returns the same file content the renderer contract promised')
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

  // ── Project scope: every equivalent that takes a path is contained ──
  // bash is absent on purpose — see the header: it carries no `path`, and its
  // containment is ADR-0047's in-turn gate, not this layer.
  for (const [method, params] of [
    ['tools/ls', { path: '../..' }],
    ['tools/grep', { path: '../..', pattern: 'parity' }],
    ['tools/find', { path: '../..', pattern: '**/*' }],
  ] as const) {
    const escaped = await call(method, { cwd: workspace, ...params })
    assert.match(
      String(escaped.error?.message || ''),
      /outside the requested project scope/,
      `${method} refuses a path outside the project, exactly as the renderer declaration promised`,
    )
  }

  // ── workspace_write → write (issue 15) ──
  const writeResult = await call('tools/write', { cwd: workspace, path: 'report.md', content: '# report\nwritten by Host write\n', approval: 'allow' })
  assert.equal(writeResult.error, undefined, 'Host write succeeds under full approval policy')
  const written = await readFile(join(workspace, 'report.md'), 'utf8')
  assert.match(written, /written by Host write/)
  // The mutation queue is shared with edit and ordered per file: a read issued
  // after the write observes it, and two writes to one path land last-wins
  // rather than interleaving.
  const readAfterWrite = await call('tools/read', { cwd: workspace, path: 'report.md' })
  assert.equal(readAfterWrite.error, undefined)
  assert.match(firstText(readAfterWrite), /written by Host write/, 'a read issued after the write observes it — one shared mutation queue')
  const firstWriteId = send('tools/write', { cwd: workspace, path: 'queued.txt', content: 'first\n', approval: 'allow' })
  const secondWriteId = send('tools/write', { cwd: workspace, path: 'queued.txt', content: 'second\n', approval: 'allow' })
  assert.equal((await waitFor(firstWriteId)).error, undefined)
  assert.equal((await waitFor(secondWriteId)).error, undefined)
  assert.equal(await readFile(join(workspace, 'queued.txt'), 'utf8'), 'second\n', 'same-path writes serialize in order instead of interleaving')
  const writeEscape = await call('tools/write', { cwd: workspace, path: '../escape.txt', content: 'x', approval: 'allow' })
  assert.match(String(writeEscape.error?.message || ''), /outside the requested project scope/)

  // ── bash → bash (issue 15) ──
  const bashResult = await call('tools/bash', { cwd: workspace, command: 'cat alpha.txt', approval: 'allow' })
  assert.equal(bashResult.error, undefined)
  assert.match(firstText(bashResult), /hello parity/)
  // Dangerous/unsplittable commands always ask, and `bashRequireAsk` cannot be
  // satisfied by an allow pattern. The call is made WITHOUT `approval` on
  // purpose: `approval: 'allow'` is the protocol's ANSWER to an ask, so passing
  // it pre-answers the very question under test. (It did exactly that before —
  // the old assertion accepted `dangerous.error` truthy, and what made it
  // truthy was the operating system's own `rm` refusing `/` with a non-zero
  // exit, not the Host refusing anything.) Assert the ask, by its reason.
  const dangerousRun = 'parity-dangerous'
  const dangerous = await call('tools/bash', { cwd: workspace, runId: dangerousRun, command: 'rm -rf /' })
  assert.match(
    String(dangerous.error?.message || ''),
    /Approval required/,
    'a dangerous command stops for approval, and says so by name',
  )
  assert.match(
    String(dangerous.error?.message || ''),
    /危險命令|allow pattern 不可越過/,
    'the reason names the dangerous-command rule, not a generic approval prompt',
  )
  const dangerousDecision = eventsFor('host/tool-decision', dangerousRun)[0]
  assert.equal(dangerousDecision?.payload?.decision, 'ask', 'rm -rf / is decided ask, never allow')
  assert.equal(firstText(dangerous), '', 'nothing ran: an ask produces no tool output')

  // Unsplittable commands ask for the same reason even when every segment
  // would individually pass.
  const unsplittableRun = 'parity-unsplittable'
  const unsplittable = await call('tools/bash', { cwd: workspace, runId: unsplittableRun, command: 'echo $(cat alpha.txt)' })
  assert.match(String(unsplittable.error?.message || ''), /Approval required/)
  assert.equal(eventsFor('host/tool-decision', unsplittableRun)[0]?.payload?.decision, 'ask')

  // ── Streaming (issue 15) ──
  // Updates only stream when a runId is supplied, so parity is asserted on the
  // shape the renderer tool produced: start → decision → bounded updates → result.
  const streamRun = 'parity-stream'
  const streamed = await call('tools/bash', { cwd: workspace, runId: streamRun, command: 'printf one; printf two', approval: 'allow' })
  assert.equal(streamed.error, undefined)
  assert.equal(eventsFor('host/tool-start', streamRun)[0]?.payload?.tool, 'bash')
  assert.equal(eventsFor('host/tool-decision', streamRun)[0]?.payload?.decision, 'allow')
  assert.ok(eventsFor('host/tool-update', streamRun).length > 0, 'bash streams incremental output the renderer tool also produced')
  assert.equal(eventsFor('host/tool-result', streamRun)[0]?.payload?.settlement, 'success')
  const writeStreamRun = 'parity-stream-write'
  const streamedWrite = await call('tools/write', { cwd: workspace, runId: writeStreamRun, path: 'streamed.txt', content: 'streamed\n', approval: 'allow' })
  assert.equal(streamedWrite.error, undefined)
  assert.equal(eventsFor('host/tool-start', writeStreamRun)[0]?.payload?.tool, 'write')
  assert.equal(eventsFor('host/tool-decision', writeStreamRun)[0]?.payload?.decision, 'allow')
  assert.equal(eventsFor('host/tool-result', writeStreamRun)[0]?.payload?.settlement, 'success', 'write settles through the same event triple as bash')

  // ── Cancellation (issue 15) ──
  const cancelRun = 'parity-cancel'
  const pending = send('tools/bash', { cwd: workspace, runId: cancelRun, command: 'sleep 5; printf never', approval: 'allow' })
  await waitForEvent('host/tool-start', cancelRun)
  const cancelAck = await call('turn/cancel', { runId: cancelRun })
  assert.equal(cancelAck.result?.settlement, 'cancelled')
  assert.equal((await waitFor(pending)).result?.settlement, 'cancelled', 'an in-flight bash settles cancelled, never success')
  assert.equal(eventsFor('host/tool-result', cancelRun)[0]?.payload?.settlement, 'cancelled')

  // ── Session recording (issue 15) ──
  // The audit is what a session REMEMBERS about a tool call; it only accrues
  // when a sessionId travels with the call, so parity is proven on a real one.
  const created = await call('sessions/create', { title: 'parity-audit' })
  const sessionId = String(created.result?.sessionId || created.result?.session?.id || '')
  assert.ok(sessionId, 'a session exists to record into')
  await call('tools/write', { cwd: workspace, sessionId, runId: 'parity-audit-write', path: 'audited.txt', content: 'audited\n', approval: 'allow' })
  await call('tools/bash', { cwd: workspace, sessionId, runId: 'parity-audit-bash', command: 'cat audited.txt', approval: 'allow' })
  const listed = await call('sessions/list')
  const audited = (listed.result?.sessions || []).find((entry: { id: string }) => entry.id === sessionId)
  const audit = (audited?.toolAudit || []) as Array<{ tool: string; phase: string; settlement?: string }>
  for (const tool of ['write', 'bash']) {
    const phases = audit.filter((record) => record.tool === tool).map((record) => record.phase)
    assert.ok(phases.includes('start'), `${tool} records that it started`)
    assert.ok(phases.includes('decision'), `${tool} records the approval decision`)
    assert.ok(phases.includes('result'), `${tool} records how it settled`)
    assert.ok(
      audit.some((record) => record.tool === tool && record.phase === 'result' && record.settlement === 'success'),
      `${tool} records the settlement, not just that it ended`,
    )
  }

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

  console.log('Parity proven at the seam for all six equivalents — schema, success, error, project scope, mutation queue, streaming, cancellation, approval and session recording; renderer duplicates are gone — one implementation each')
} finally {
  if (host.exitCode === null) {
    host.stdin.end()
    await once(host, 'exit').catch(() => host.kill())
  }
  await rm(agentDir, { recursive: true, force: true })
  await rm(stateDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
