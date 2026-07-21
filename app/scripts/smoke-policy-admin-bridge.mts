/**
 * Policy Admin disk lifecycle (main bridge pure ops).
 * Run: node --experimental-strip-types scripts/smoke-policy-admin-bridge.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  activatePolicyDraft,
  listActivePolicies,
  listPolicyDrafts,
  rollbackActivePolicy,
  savePolicyDraft,
  seedDraftFromActive,
} from '../electron/policyAdminBridge.ts'
import { BUILTIN_BASELINE_POLICY } from '../src/agent/outbound/policySchema.ts'

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

console.log('smoke-policy-admin-bridge')

await test('seed → save → activate → rollback bumps version', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-pol-'))
  try {
    // seed needs active base first
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'company-base.json'),
      JSON.stringify(BUILTIN_BASELINE_POLICY, null, 2),
    )
    const seed = seedDraftFromActive({
      kind: 'company-base',
      draftId: 'd1',
      policyDir: dir,
    })
    assert.equal(seed.ok, true)
    if (!seed.ok) return
    const drafts = listPolicyDrafts(dir)
    assert.ok(drafts.some((d) => d.id === 'd1'))

    // read draft body via file and activate
    const draftFile = path.join(dir, 'drafts', 'd1.json')
    const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'))
    const act = activatePolicyDraft({ draftId: 'd1', policyDir: dir })
    assert.equal(act.ok, true, act.ok ? '' : (act as { reason: string }).reason)
    if (!act.ok) return
    assert.ok(act.active.version > BUILTIN_BASELINE_POLICY.version)

    const active = listActivePolicies(dir)
    assert.ok(active.some((a) => a.kind === 'company-base' && a.version === act.active.version))

    const rb = rollbackActivePolicy({
      kind: 'company-base',
      reason: 'smoke',
      policyDir: dir,
    })
    assert.equal(rb.ok, true)
    if (rb.ok) assert.equal(rb.active.version, act.active.version + 1)

    // save draft invalid body fails
    const bad = savePolicyDraft({
      id: 'bad',
      kind: 'company-base',
      body: { nope: true },
      policyDir: dir,
    })
    assert.equal(bad.ok, false)
    void draft
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('platform wiring: policy admin IPC in main/preload/Settings', () => {
  const root = process.cwd()
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8')
  const settings = fs.readFileSync(path.join(root, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(main, /policyAdminBridge/)
  assert.match(main, /outbound:policyActivateDraft/)
  assert.match(preload, /policySeedDraft/)
  assert.match(settings, /policyAdmin/)
  assert.match(settings, /isPolicyAdminBuild/)
  assert.match(settings, /policyActivateDraft/)
})


await test('provider-supplement seed → activate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-sup-'))
  try {
    fs.mkdirSync(path.join(dir, 'providers'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'company-base.json'),
      JSON.stringify(BUILTIN_BASELINE_POLICY, null, 2),
    )
    const conn = 'llm:test-conn'
    const { emptySupplementalPolicy } = await import('../src/agent/outbound/policySchema.ts')
    fs.writeFileSync(
      path.join(dir, 'providers', conn.replace(/[/:]/g, '_') + '.json'),
      JSON.stringify(emptySupplementalPolicy(conn), null, 2),
    )
    const seed = seedDraftFromActive({
      kind: 'provider-supplement',
      connectionId: conn,
      draftId: 'sup1',
      policyDir: dir,
    })
    assert.equal(seed.ok, true, seed.ok ? '' : (seed as { reason: string }).reason)
    const act = activatePolicyDraft({ draftId: 'sup1', policyDir: dir })
    assert.equal(act.ok, true, act.ok ? '' : (act as { reason: string }).reason)
    if (act.ok) assert.equal(act.active.connectionId, conn)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`\n${passed} tests passed`)
