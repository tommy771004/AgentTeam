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
  HOST_OWNED_TOOL_NAMES,
  RENDERER_FALLBACK_TOOL_NAMES,
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
  assert.equal(registryHandlersComplete(), true, 'only workspace compatibility tools carry renderer handlers')
  const names = getRegistryToolNames()
  for (const k of Object.keys(TOOL_DEFINITIONS)) {
    assert.ok(names.includes(k), `missing ${k}`)
    if (RENDERER_FALLBACK_TOOL_NAMES.has(k)) {
      assert.ok(getRegistryEntry(k)?.handler, `no handler ${k}`)
    } else {
      assert.ok(HOST_OWNED_TOOL_NAMES.has(k), `${k} must have an explicit owner`)
      assert.equal(getRegistryEntry(k)?.handler, undefined, `${k} is host-owned and must not regain a renderer handler`)
    }
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

await test('legacy renderer loop is gone; only workspace compatibility handlers remain', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/tools/toolLoop.ts')), false)
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/tools/executor.ts')), false)
  assert.equal(fs.existsSync(path.join(appRoot, 'src/agent/loop')), false)
  const regDir = path.join(appRoot, 'src/agent/tools/registered')
  const files = fs.readdirSync(regDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  assert.deepEqual(files.sort(), [...RENDERER_FALLBACK_TOOL_NAMES].map((name) => `${name}.ts`).sort())
  const delegate = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/delegate.ts'), 'utf8')
  assert.doesNotMatch(delegate, /\brunDelegatedTask\b/)
  assert.doesNotMatch(delegate, /runFunctionCallingLoop/)
})

// The delegate_task schema enum and RUNNER_IDS must not drift apart.
{
  const { RUNNER_IDS } = await import('../src/agent/runners/types.ts')
  const { TOOL_DEFINITIONS } = await import('../src/agent/tools/toolDefinitions.ts')
  const params = TOOL_DEFINITIONS.delegate_task?.parameters as {
    properties?: { runner?: { enum?: string[] } }
  }
  const schemaEnum = params?.properties?.runner?.enum || []
  assert.deepEqual(
    [...schemaEnum].sort(),
    [...RUNNER_IDS].sort(),
    'delegate_task runner enum drifted from RUNNER_IDS',
  )
}

console.log(`\n${passed} tests passed`)
