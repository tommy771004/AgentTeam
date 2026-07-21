/**
 * Hermes-style tool registry smoke.
 * Run: node --experimental-strip-types scripts/smoke-tool-registry.mts
 */
import assert from 'node:assert/strict'
import {
  discoverRegisteredToolModules,
  ensureBuiltinRegistry,
  getRegistryCatalog,
  getRegistryEntry,
  getRegistryToolNames,
  register,
  registryCoversToolDefinitions,
  registryHandlersComplete,
} from '../src/agent/tools/toolRegistry.ts'
import { TOOL_DEFINITIONS } from '../src/agent/tools/toolDefinitions.ts'

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

console.log('smoke-tool-registry')

await test('registry covers every TOOL_DEFINITIONS key (big bang)', async () => {
  await discoverRegisteredToolModules()
  ensureBuiltinRegistry()
  assert.equal(registryCoversToolDefinitions(), true)
  assert.equal(registryHandlersComplete(), true, 'each tool module supplies handler')
  const names = getRegistryToolNames()
  for (const k of Object.keys(TOOL_DEFINITIONS)) {
    assert.ok(names.includes(k), `missing ${k}`)
    assert.ok(getRegistryEntry(k)?.handler, `no handler ${k}`)
  }
})

await test('catalog view is non-empty and has keywords', () => {
  const cat = getRegistryCatalog()
  assert.ok(cat.length > 10)
  assert.ok(cat.every((c) => c.name && typeof c.description === 'string'))
})

await test('register overrides / adds entry', () => {
  register({
    name: '__smoke_probe__',
    toolset: 'test',
    description: 'probe',
    keywords: ['probe'],
    schemaParams: {},
  })
  assert.equal(getRegistryEntry('__smoke_probe__')?.description, 'probe')
})

await test('toolLoop gated path uses invokeGatedTool + registry only', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const loop = fs.readFileSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts'), 'utf8')
  assert.match(loop, /invokeGatedTool/)
  assert.match(loop, /dispatchRegistered/)
  assert.doesNotMatch(loop, /from '\.\/executor'|from \"\.\/executor\"/)
  // Loop Runner deepening: stepStrategies.ts relocated to agent/loop/strategies.ts (ticket 02), shim removed (ticket 04).
  const strategies = fs.readFileSync(path.join(appRoot, 'src/agent/loop/strategies.ts'), 'utf8')
  assert.match(strategies, /dispatchRegistered/)
  assert.doesNotMatch(strategies, /from '\.\/tools\/executor'|from \"\.\/tools\/executor\"/)
  const regDir = path.join(appRoot, 'src/agent/tools/registered')
  const files = fs.readdirSync(regDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  assert.ok(files.length >= 40, `expected many per-tool modules, got ${files.length}`)
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.doesNotMatch(delegate, /\brunDelegatedTask\b/)
  assert.doesNotMatch(delegate, /runFunctionCallingLoop/)
})

console.log(`\n${passed} tests passed`)
