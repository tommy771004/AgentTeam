import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import {
  evaluatePiInvocationPolicy,
  freezePiRunPolicy,
  PI_POLICY_EVIDENCE_MIGRATION_INVENTORY,
  type PiInvocationOrigin,
} from '../electron/piPolicyEvidence.ts'

const digest = 'c'.repeat(64)
const origins: PiInvocationOrigin[] = ['model', 'direct-protocol', 'code-mode', 'mcp']
const invoke = (origin: PiInvocationOrigin, policy: ReturnType<typeof freezePiRunPolicy>, requirements: Record<string, unknown>) =>
  evaluatePiInvocationPolicy({
    coordinates: { sessionId: 'session', runId: 'run', callId: `call-${origin}` },
    origin,
    tool: 'effect',
    contract: { contractRevision: 3, contractDigest: digest, schemaDigest: digest, toolSource: origin === 'mcp' ? 'mcp' : 'extension-pack' },
    args: { path: 'inside.txt' },
    policy,
    requirements,
  })

for (const origin of origins) {
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'always', projectRoot: '/tmp/project' }), { sideEffect: true }).verdict, 'ask')
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'auto', projectRoot: '/tmp/project' }), { sideEffect: true }).verdict, 'allow')
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project' }), { sideEffect: true }).verdict, 'allow')
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project' }), { capabilityApproval: 'capability approval' }).verdict, 'ask')
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'full', unattended: true, projectRoot: '/tmp/project' }), { capabilityApproval: 'capability approval' }).verdict, 'deny')
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project', deniedTools: ['effect'] }), {}).verdict, 'deny')
  assert.equal(invoke(origin, freezePiRunPolicy({ approvalMode: 'full', projectRoot: '/tmp/project', approvalTools: ['eff*'] }), {}).verdict, 'ask')
  const outbound = invoke(origin, freezePiRunPolicy({ approvalMode: 'auto', projectRoot: '/tmp/project', outboundMode: 'required' }), { outbound: true })
  assert.equal(outbound.verdict, 'deny')
  assert.equal(outbound.evidence.outboundDecision, 'deny')
}
assert.equal(PI_POLICY_EVIDENCE_MIGRATION_INVENTORY.pending.length, 0)

const resourcePolicy = freezePiRunPolicy({
  approvalMode: 'full',
  projectRoot: '/tmp/project',
  resourceView: { root: '/tmp/skill-view-digest', digest, manifest: ['deploy/SKILL.md', 'deploy/reference.md'] },
})
const resourceCall = (tool: string, path: string) => evaluatePiInvocationPolicy({
  coordinates: { sessionId: 'session', runId: 'resource-run', callId: `resource-${tool}` },
  origin: 'model', tool,
  contract: { contractRevision: 1, contractDigest: digest, schemaDigest: digest, toolSource: 'builtin' },
  args: { path }, policy: resourcePolicy, requirements: { pathArguments: ['path'] },
})
const skillRead = resourceCall('read', '/tmp/skill-view-digest/deploy/reference.md')
assert.equal(skillRead.verdict, 'allow')
assert.equal(skillRead.evidence.resourceViewDecision, 'allow')
assert.equal(skillRead.evidence.restrictedViewDecision, 'not-applicable', 'resource read is not mislabeled as project-view allow')
assert.equal(resourceCall('read', '/tmp/skill-view-digest/deploy/private.txt').verdict, 'deny', 'nonmanifest sibling fails closed')
assert.equal(resourceCall('write', '/tmp/skill-view-digest/deploy/SKILL.md').verdict, 'deny', 'mutators never inherit a resource grant')
assert.ok(Object.isFrozen(resourcePolicy.resourceView) && Object.isFrozen(resourcePolicy.resourceView?.manifest))

const toolHostSource = await readFile(resolve(import.meta.dirname, '../electron/piToolHost.ts'), 'utf8')
const protocolSource = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
assert.doesNotMatch(toolHostSource, /if \(tool\.policyMigration\)/, 'all pack tools use the common policy branch')
assert.doesNotMatch(protocolSource, /function approvalOutcome/, 'duplicate direct approval derivation is removed')
assert.match(toolHostSource, /The single model-builtin policy hook/)
assert.match(protocolSource, /authorizeContractInvocation/)

type Message = { id?: number; event?: string; payload?: Record<string, any>; result?: Record<string, any>; error?: { message: string } }
const root = await mkdtemp(join(tmpdir(), 'pi-policy-mutation-'))
const stateDir = await mkdtemp(join(tmpdir(), 'pi-policy-mutation-state-'))
await writeFile(join(root, 'shared.txt'), 'base\n')
const host = spawn(process.execPath, [resolve(import.meta.dirname, '../dist-electron/pi-host.js')], {
  env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const lines = createInterface({ input: host.stdout })
const messages: Message[] = []
lines.on('line', (line) => messages.push(JSON.parse(line)))
const waitId = async (id: number) => {
  const deadline = Date.now() + 10_000
  for (;;) {
    const found = messages.find((message) => message.id === id)
    if (found) return found
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${id}: ${JSON.stringify(messages)}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}
const send = (id: number, method: string, params: Record<string, unknown>) => host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
try {
  send(1, 'initialize', { protocolVersion: 2, capabilities: ['tool-contract-v1'] })
  assert.equal((await waitId(1)).error, undefined)
  const common = { cwd: root, runId: 'concurrent-mutation', approval: 'allow', path: 'shared.txt' }
  send(2, 'tools/edit', { ...common, callId: 'edit-a', edits: [{ oldText: 'base', newText: 'alpha' }] })
  send(3, 'tools/edit', { ...common, callId: 'edit-b', edits: [{ oldText: 'base', newText: 'beta' }] })
  const [left, right] = await Promise.all([waitId(2), waitId(3)])
  assert.equal([left, right].filter((response) => !response.error).length, 1, 'shared Pi mutation queue serializes the full read-modify-write')
  assert.equal([left, right].filter((response) => response.error).length, 1, 'the second exact edit observes the first mutation')
  assert.match(await readFile(join(root, 'shared.txt'), 'utf8'), /^(alpha|beta)\n$/)
  const terminal = messages.filter((message) => message.event === 'host/tool-result' && ['edit-a', 'edit-b'].includes(String(message.payload?.callId)))
  assert.equal(terminal.length, 2)
  assert.deepEqual(new Set(terminal.map((message) => message.payload?.settlement)), new Set(['success', 'failed']))
  assert.ok(terminal.every((message) => message.payload?.contractRevision === 1 && message.payload?.schemaDigest && message.payload?.invocationOrigin === 'direct-protocol'))
} finally {
  host.stdin.end()
  if (host.exitCode === null) await Promise.race([once(host, 'exit'), new Promise<void>((done) => setTimeout(() => { host.kill(); done() }, 1_000))])
  lines.close()
  await Promise.all([rm(root, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })])
}

console.log('All invocation origins share frozen policy vocabulary; concurrent same-path mutations serialize')
