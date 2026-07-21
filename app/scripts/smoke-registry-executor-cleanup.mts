/**
 * Hermes registry-executor cleanup guards.
 * Run: node --experimental-strip-types scripts/smoke-registry-executor-cleanup.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverRegisteredToolModules, registryHandlersComplete } from '../src/agent/tools/toolRegistry.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(appRoot, 'src')

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

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walkTs(p))
    else if (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

console.log('smoke-registry-executor-cleanup')

await test('no runDelegatedTask symbol in app/src', () => {
  for (const f of walkTs(src)) {
    const t = fs.readFileSync(f, 'utf8')
    assert.doesNotMatch(
      t,
      /\brunDelegatedTask\b/,
      `found runDelegatedTask in ${path.relative(appRoot, f)}`,
    )
  }
})

await test('registered modules do not import executeTool', async () => {
  await discoverRegisteredToolModules()
  const regDir = path.join(src, 'agent/tools/registered')
  for (const f of fs.readdirSync(regDir).filter((n) => n.endsWith('.ts'))) {
    const t = fs.readFileSync(path.join(regDir, f), 'utf8')
    assert.doesNotMatch(t, /executeTool/, `registered/${f} still references executeTool`)
  }
  assert.equal(registryHandlersComplete(), true)
})

await test('executor has no ToolName switch over cases', () => {
  const execPath = path.join(src, 'agent/tools/executor.ts')
  if (!fs.existsSync(execPath)) {
    console.log('  (executor.ts deleted — ok)')
    return
  }
  const t = fs.readFileSync(execPath, 'utf8')
  assert.doesNotMatch(t, /switch\s*\(\s*tool\s*\)/, 'executor still has switch (tool)')
  assert.doesNotMatch(t, /export async function executeTool/, 'executeTool still exported')
})

console.log(`\n${passed} tests passed`)
