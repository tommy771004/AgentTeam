/**
 * Sanitized Workspace + safe writeback — ticket 05.
 * Seam: createSanitizedWorkspace / safeWriteback / view isolation.
 * Run: node --experimental-strip-types scripts/smoke-sanitized-workspace.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy,
} from '../src/agent/outbound/policySchema.ts'
import { compileProviderSecurityProfile } from '../src/agent/outbound/policyMerge.ts'
import {
  createSanitizedWorkspace,
  disposeSanitizedWorkspace,
  getSanitizedViewCapability,
  safeWritebackTextFile,
} from '../src/agent/outbound/sanitizedWorkspace.ts'
import { PROTECTED_EXCLUSION_MARKER } from '../src/agent/outbound/textSanitize.ts'

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

console.log('smoke-sanitized-workspace')

const profile = compileProviderSecurityProfile(
  BUILTIN_BASELINE_POLICY,
  emptySupplementalPolicy('llm:ws-a'),
)

function makeProject(root: string) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'src', 'app.ts'),
    ['export const ok = 1', 'api_key: sk-SECRET-SHOULD-NOT-LEAVE', 'export const end = 2'].join('\n'),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'README.md'), '# hello safe\n', 'utf8')
  // external symlink target (outside project)
  const outside = path.join(os.tmpdir(), `odg-out-${Date.now()}`)
  fs.writeFileSync(outside, 'outside-secret=1\n', 'utf8')
  try {
    fs.symlinkSync(outside, path.join(root, 'link-out'))
  } catch {
    /* windows may need privilege — skip; test still checks skipped list when present */
  }
}

await test('capability reports full on node filesystem', () => {
  const cap = getSanitizedViewCapability({ hasNodeFs: true })
  assert.equal(cap.status, 'full')
  const browser = getSanitizedViewCapability({ hasNodeFs: false })
  assert.equal(browser.status, 'unavailable')
  assert.match(browser.reason || '', /browser|Electron|unavailable/i)
})

await test('create workspace: original unchanged; secrets replaced; per-connection roots', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-proj-'))
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-view-base-'))
  try {
    makeProject(project)
    const original = fs.readFileSync(path.join(project, 'src', 'app.ts'), 'utf8')
    const ws = await createSanitizedWorkspace({
      connectionId: 'llm:ws-a',
      projectRoot: project,
      profile,
      baseDir: base,
    })
    assert.equal(fs.readFileSync(path.join(project, 'src', 'app.ts'), 'utf8'), original)
    const viewFile = path.join(ws.viewRoot, 'src', 'app.ts')
    assert.ok(fs.existsSync(viewFile))
    const viewText = fs.readFileSync(viewFile, 'utf8')
    assert.doesNotMatch(viewText, /sk-SECRET/)
    assert.match(viewText, new RegExp(PROTECTED_EXCLUSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(viewText, /export const ok/)
    assert.ok(ws.exclusions.some((e) => e.relPath === path.join('src', 'app.ts') || e.relPath.replace(/\\/g, '/') === 'src/app.ts'))

    const wsB = await createSanitizedWorkspace({
      connectionId: 'llm:ws-b',
      projectRoot: project,
      profile: compileProviderSecurityProfile(
        BUILTIN_BASELINE_POLICY,
        emptySupplementalPolicy('llm:ws-b'),
      ),
      baseDir: base,
    })
    assert.notEqual(ws.viewRoot, wsB.viewRoot)
    await disposeSanitizedWorkspace(ws)
    await disposeSanitizedWorkspace(wsB)
    assert.ok(!fs.existsSync(ws.viewRoot))
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
  }
})

await test('external symlink is skipped not followed', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-proj2-'))
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-view2-'))
  try {
    makeProject(project)
    const ws = await createSanitizedWorkspace({
      connectionId: 'llm:ws-a',
      projectRoot: project,
      profile,
      baseDir: base,
    })
    const linkView = path.join(ws.viewRoot, 'link-out')
    if (fs.existsSync(path.join(project, 'link-out'))) {
      assert.ok(
        !fs.existsSync(linkView) || ws.skipped.some((s) => s.relPath.includes('link-out')),
      )
      assert.ok(ws.skipped.some((s) => /symlink|external/i.test(s.reason)))
    }
    await disposeSanitizedWorkspace(ws)
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
  }
})

await test('safe writeback: safe edit applied; protected-overlap withheld; no secret in withheld meta', async () => {
  const original = ['line1 safe', 'api_key: sk-ORIG-999', 'line3 safe'].join('\n')
  const sanitizedBefore = ['line1 safe', PROTECTED_EXCLUSION_MARKER, 'line3 safe'].join('\n')
  const sanitizedAfter = ['line1 EDITED', PROTECTED_EXCLUSION_MARKER, 'line3 safe'].join('\n')
  // agent also tries to change the protected line
  const sanitizedAttack = ['line1 EDITED', 'leaked: sk-HACK', 'line3 safe'].join('\n')

  const ok = safeWritebackTextFile({
    originalText: original,
    sanitizedBefore,
    sanitizedAfter,
    exclusions: [{ startLine: 2, endLine: 2 }],
  })
  assert.equal(ok.applied.length, 1)
  assert.equal(ok.withheld.length, 0)
  assert.match(ok.resultText, /line1 EDITED/)
  assert.match(ok.resultText, /sk-ORIG-999/)
  assert.doesNotMatch(JSON.stringify(ok.withheld), /sk-|password|secret/i)

  const blocked = safeWritebackTextFile({
    originalText: original,
    sanitizedBefore,
    sanitizedAfter: sanitizedAttack,
    exclusions: [{ startLine: 2, endLine: 2 }],
  })
  assert.ok(blocked.withheld.some((w) => w.startLine === 2))
  assert.match(blocked.resultText, /sk-ORIG-999/)
  assert.doesNotMatch(blocked.resultText, /sk-HACK/)
  assert.doesNotMatch(JSON.stringify(blocked.withheld), /sk-HACK|sk-ORIG/)
})

await test('writeback applies only safe hunk when both change', async () => {
  const original = ['a', 'api_key: sk-KEEP', 'c'].join('\n')
  const before = ['a', PROTECTED_EXCLUSION_MARKER, 'c'].join('\n')
  const after = ['A-safe', 'api_key: sk-STEAL', 'C-safe'].join('\n')
  const r = safeWritebackTextFile({
    originalText: original,
    sanitizedBefore: before,
    sanitizedAfter: after,
    exclusions: [{ startLine: 2, endLine: 2 }],
  })
  const lines = r.resultText.split('\n')
  assert.equal(lines[0], 'A-safe')
  assert.equal(lines[1], 'api_key: sk-KEEP')
  assert.equal(lines[2], 'C-safe')
  assert.ok(r.applied.length >= 1)
  assert.ok(r.withheld.length >= 1)
})

console.log(`\n${passed} tests passed`)
