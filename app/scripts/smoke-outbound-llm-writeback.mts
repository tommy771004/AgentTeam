/**
 * Residual fail-closed wiring:
 * 24 — main LLM egress evidence metadata
 * 25 — safe writeback on dispose (ADR-0008)
 * Run: node --experimental-strip-types scripts/smoke-outbound-llm-writeback.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLlmEgressEvidenceMeta } from '../src/agent/outbound/llmEgress.ts'
import {
  createSanitizedWorkspace,
  writebackSanitizedWorkspace,
  disposeSanitizedWorkspace,
} from '../src/agent/outbound/sanitizedWorkspace.ts'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

console.log('smoke-outbound-llm-writeback')

await test('ticket24: buildLlmEgressEvidenceMeta is metadata-only', () => {
  const m = buildLlmEgressEvidenceMeta({
    runId: 'run_x',
    connectionId: 'llm:x',
    effectiveMode: 'required',
    action: 'llm-transport',
    profileSource: 'company',
  })
  assert.equal(m.eventType, 'outbound-decision')
  assert.equal(m.action, 'llm-transport:company')
  assert.equal(m.effectiveGuardMode, 'required')
  const json = JSON.stringify(m)
  assert.ok(!json.includes('messages'))
  assert.ok(!json.includes('content'))
  assert.ok(!json.includes('prompt'))
})

await test('ticket24: main llm:chat wires evidence meta fields', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(t, /buildLlmEgressEvidenceMeta/)
  assert.match(t, /llm-transport/)
  assert.match(t, /outboundProfileSource/)
  const llm = fs.readFileSync(path.join(appRoot, 'src/agent/llm.ts'), 'utf8')
  assert.match(llm, /outboundProfileSource/)
  assert.match(llm, /providerConnectionId/)
})

await test('ticket25: safe writeback applies agent edits, keeps protected lines', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-proj-'))
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-view-'))
  try {
    fs.mkdirSync(path.join(project, 'src'), { recursive: true })
    // Line 1 secret (baseline api_key), line 2 safe note
    fs.writeFileSync(
      path.join(project, 'src', 'a.ts'),
      "export const k = 'api_key: sk-SECRET-WRITEBACK'\nexport const note = 'old'\n",
    )
    const profile = compileProviderSecurityProfile(
      BUILTIN_BASELINE_POLICY,
      emptySupplementalPolicy('llm:wb'),
    )
    const ws = await createSanitizedWorkspace({
      connectionId: 'llm:wb',
      projectRoot: project,
      profile,
      baseDir: base,
    })
    const mapping = ws.fileMappings.find((m) => m.relPath === path.join('src', 'a.ts') || m.relPath === 'src/a.ts')
    assert.ok(mapping?.initialSanitizedText, 'must capture initial sanitized text')
    assert.ok(mapping!.initialSanitizedText!.includes('PROTECTED') || mapping!.initialSanitizedText!.includes('⟦'))
    // Agent edits only the safe line in the view
    const viewBody = fs.readFileSync(mapping!.sanitizedAbs, 'utf8')
    const edited = viewBody.replace("note = 'old'", "note = 'new-from-agent'")
    fs.writeFileSync(mapping!.sanitizedAbs, edited, 'utf8')

    const wb = writebackSanitizedWorkspace(ws)
    assert.ok(wb.filesWritten >= 1, 'expected at least one file written')
    const origAfter = fs.readFileSync(path.join(project, 'src', 'a.ts'), 'utf8')
    assert.match(origAfter, /sk-SECRET-WRITEBACK/, 'protected secret must remain in original')
    assert.match(origAfter, /new-from-agent/, 'safe agent edit must write back')
    assert.doesNotMatch(origAfter, /PROTECTED|⟦/, 'markers must not overwrite original secrets')

    await disposeSanitizedWorkspace(ws)
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
  }
})

await test('ticket25: disposeRunView accepts writeback + coordinator success path', () => {
  const bridge = fs.readFileSync(path.join(appRoot, 'electron/outboundBridge.ts'), 'utf8')
  assert.match(bridge, /writebackSanitizedWorkspace|writeback\?:/)
  const coord = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coord, /String\(status\) === ['"]success['"]/)
  assert.match(coord, /disposeRunView/)
  assert.match(coord, /writeback/)
})

console.log(`\n${passed} tests passed`)
