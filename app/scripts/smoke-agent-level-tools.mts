/**
 * Agent-level intercept set — true import.
 * Run: node --experimental-strip-types scripts/smoke-agent-level-tools.mts
 */
import assert from 'node:assert/strict'
import {
  AGENT_LEVEL_TOOL_NAMES,
  isAgentLevelTool,
  isPostAuthAgentLevelTool,
  isPreAuthAgentLevelTool,
} from '../src/agent/tools/agentLevelTools.ts'

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-agent-level-tools')

test('set includes plan / progressive / run_code / delegate', () => {
  const required = [
    'enter_plan_mode',
    'exit_plan_mode',
    'tool_search',
    'load_capability',
    'run_code',
    'delegate_task',
    'delegate_status',
  ]
  for (const n of required) {
    assert.ok(isAgentLevelTool(n), `missing ${n}`)
    assert.ok(AGENT_LEVEL_TOOL_NAMES.includes(n as never), `list missing ${n}`)
  }
})

test('pre-auth vs post-auth partition is disjoint and complete', () => {
  for (const n of AGENT_LEVEL_TOOL_NAMES) {
    const pre = isPreAuthAgentLevelTool(n)
    const post = isPostAuthAgentLevelTool(n)
    assert.equal(pre || post, true, `${n} must be pre or post`)
    assert.equal(pre && post, false, `${n} must not be both`)
  }
  assert.equal(isPreAuthAgentLevelTool('load_capability'), true)
  assert.equal(isPostAuthAgentLevelTool('run_code'), true)
  assert.equal(isPostAuthAgentLevelTool('delegate_task'), true)
})

test('gated tools are not agent-level', () => {
  assert.equal(isAgentLevelTool('bash'), false)
  assert.equal(isAgentLevelTool('workspace_read'), false)
  assert.equal(isAgentLevelTool('mcp_foo_bar'), false)
})

test('toolLoop routes via isPreAuth / isPostAuth + invokeGatedTool (wiring)', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /isPreAuthAgentLevelTool|isAgentLevelTool/)
  assert.match(loop, /from '\.\/agentLevelTools'|from \"\.\/agentLevelTools\"/)
  assert.match(loop, /invokeGatedTool/)
  assert.match(loop, /!isPostAuthAgentLevelTool/)
})

console.log(`\n${passed} tests passed`)
