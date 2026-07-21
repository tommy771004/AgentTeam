/**
 * Tool Invocation (gated tools) — true import of invokeGatedTool.
 * Run: node --experimental-strip-types scripts/smoke-tool-invocation.mts
 */
import assert from 'node:assert/strict'
import { invokeGatedTool } from '../src/agent/tools/toolInvocation.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-tool-invocation')

await test('auth deny → structured denied result, afterTool not called', async () => {
  let afterToolCalls = 0
  let executeCalled = false
  const result = await invokeGatedTool({
    tool: 'bash',
    input: { command: 'rm -rf /' },
    authorize: async () => ({ allowed: false, output: '政策拒絕：bash' }),
    execute: async () => {
      executeCalled = true
      return { ok: true, output: 'should not run' }
    },
    evaluateAfterTool: () => {
      afterToolCalls++
      return { audits: [], notifications: [] }
    },
    newId: () => 'deny_1',
    nowTime: () => '12:00:00',
  })
  assert.equal(result.ok, false)
  assert.equal(result.denied, true)
  assert.equal(result.output, '政策拒絕：bash')
  assert.equal(result.record.ok, false)
  assert.equal(result.record.tool, 'bash')
  assert.match(result.chunk, /政策拒絕：bash/)
  assert.equal(afterToolCalls, 0, 'deny must not run afterTool')
  assert.equal(executeCalled, false, 'execute must not run on deny')
})

await test('allow + execute success → ok, afterTool with toolOk true', async () => {
  const hooks: string[] = []
  const result = await invokeGatedTool({
    tool: 'workspace_read',
    input: { path: 'a.md' },
    authorize: async () => ({ allowed: true }),
    execute: async () => ({ ok: true, output: 'file contents' }),
    evaluateAfterTool: ({ tool, toolOk }) => {
      hooks.push(`${tool}:${toolOk}`)
      return { audits: [`after:${tool}`], notifications: ['n1'] }
    },
    notify: () => {
      hooks.push('notify')
    },
    newId: () => 'ok_1',
    nowTime: () => '12:00:00',
  })
  assert.equal(result.ok, true)
  assert.equal(result.denied, false)
  assert.equal(result.output, 'file contents')
  assert.equal(result.record.ok, true)
  assert.equal(hooks[0], 'workspace_read:true')
  assert.ok(hooks.includes('notify'))
})

await test('allow + soft fail → ok false not denied, afterTool with toolOk false', async () => {
  let toolOkSeen: boolean | undefined
  const result = await invokeGatedTool({
    tool: 'jira_create_issue',
    input: { title: 'x' },
    authorize: async () => ({ allowed: true }),
    execute: async () => ({ ok: false, output: 'api 400' }),
    evaluateAfterTool: ({ toolOk }) => {
      toolOkSeen = toolOk
      return { audits: [], notifications: [] }
    },
    newId: () => 'soft_1',
    nowTime: () => '12:00:00',
  })
  assert.equal(result.ok, false)
  assert.equal(result.denied, false)
  assert.equal(result.output, 'api 400')
  assert.equal(toolOkSeen, false)
})

await test('allow + execute throw → structured fail, afterTool still runs', async () => {
  let afterToolCalls = 0
  const result = await invokeGatedTool({
    tool: 'workspace_write',
    input: { path: 'x' },
    authorize: async () => ({ allowed: true }),
    execute: async () => {
      throw new Error('IPC hung')
    },
    evaluateAfterTool: ({ toolOk }) => {
      afterToolCalls++
      assert.equal(toolOk, false)
      return { audits: [], notifications: [] }
    },
    newId: () => 'throw_1',
    nowTime: () => '12:00:00',
  })
  assert.equal(result.ok, false)
  assert.equal(result.denied, false)
  assert.match(result.output, /IPC hung/)
  assert.equal(afterToolCalls, 1)
})

await test('authorize may return guard-shaped AuthorizeResult without remap', async () => {
  // Same discriminant as tools/toolGuard.AuthorizeResult — no call-site ternary.
  const denied = await invokeGatedTool({
    tool: 'bash',
    input: {},
    authorize: async () => ({ allowed: false, output: 'guard deny' }),
    execute: async () => ({ ok: true, output: 'x' }),
    newId: () => 'g1',
    nowTime: () => '12:00:00',
  })
  assert.equal(denied.denied, true)
  assert.equal(denied.output, 'guard deny')

  const allowed = await invokeGatedTool({
    tool: 'datetime_now',
    input: {},
    authorize: async () => ({ allowed: true }),
    execute: async () => ({ ok: true, output: 't' }),
    newId: () => 'g2',
    nowTime: () => '12:00:00',
  })
  assert.equal(allowed.denied, false)
  assert.equal(allowed.ok, true)
})

await test('haltOnPayloadOverflow rethrows SupervisorViolation', async () => {
  const { SupervisorViolation } = await import('../src/agent/supervisor.ts')
  const big = 'x'.repeat(200_000)
  let threw = false
  try {
    await invokeGatedTool({
      tool: 'workspace_read',
      input: {},
      authorize: async () => ({ allowed: true }),
      execute: async () => ({ ok: true, output: big }),
      haltOnPayloadOverflow: true,
      supervisorLimits: {
        maxToolPayloadBytes: 1000,
        maxToolRounds: 4,
        maxStepContextBytes: 50_000,
      },
      newId: () => 'halt_1',
      nowTime: () => '12:00:00',
    })
  } catch (e) {
    threw = e instanceof SupervisorViolation
  }
  assert.equal(threw, true)
})

await test('oversized output is truncated inside the seam', async () => {
  const big = 'x'.repeat(200_000)
  const result = await invokeGatedTool({
    tool: 'workspace_read',
    input: {},
    authorize: async () => ({ allowed: true }),
    execute: async () => ({ ok: true, output: big }),
    supervisorLimits: {
      maxToolPayloadBytes: 1000,
      maxToolRounds: 4,
      maxStepContextBytes: 50_000,
    },
    evaluateAfterTool: () => ({ audits: [], notifications: [] }),
    newId: () => 'trunc_1',
    nowTime: () => '12:00:00',
  })
  assert.ok(result.output.length < big.length, 'truncated')
  assert.equal(result.ok, true)
  assert.match(result.output, /truncated by supervisor/)
})

await test('onRecord receives records for deny and success', async () => {
  const records: string[] = []
  await invokeGatedTool({
    tool: 'bash',
    input: {},
    authorize: async () => ({ allowed: false, output: 'no' }),
    execute: async () => ({ ok: true, output: 'x' }),
    onRecord: (r) => records.push(`deny:${r.ok}`),
    newId: () => 'r1',
    nowTime: () => '12:00:00',
  })
  await invokeGatedTool({
    tool: 'datetime_now',
    input: {},
    authorize: async () => ({ allowed: true }),
    execute: async () => ({ ok: true, output: 'now' }),
    onRecord: (r) => records.push(`ok:${r.ok}`),
    newId: () => 'r2',
    nowTime: () => '12:00:00',
  })
  assert.deepEqual(records, ['deny:false', 'ok:true'])
})

console.log(`\n${passed} tests passed`)
