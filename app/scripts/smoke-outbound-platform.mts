/**
 * Outbound platform wiring — Electron bridge + coordinator hooks (static contract).
 * Run: node --experimental-strip-types scripts/smoke-outbound-platform.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
async function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-outbound-platform')

await test('outboundBridge module exports main handlers', () => {
  const p = path.join(appRoot, 'electron/outboundBridge.ts')
  const t = fs.readFileSync(p, 'utf8')
  assert.match(t, /export function getOutboundStatus/)
  assert.match(t, /export async function prepareOutboundRunView/)
  assert.match(t, /export async function appendOutboundEvidence/)
  assert.match(t, /safeStorage/)
  assert.match(t, /outbound-evidence/)
})

await test('main.ts registers outbound IPC', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(t, /from '\.\/outboundBridge(\.ts)?'/)
  for (const ch of [
    'outbound:status',
    'outbound:ensurePolicy',
    'outbound:prepareRunView',
    'outbound:disposeRunView',
    'outbound:appendEvidence',
    'outbound:policyActivateDraft',
    'outbound:policySeedDraft',
  ]) {
    assert.match(t, new RegExp(ch.replace(':', '\\:')))
  }
  assert.match(t, /policyAdminBridge/)
})

await test('preload exposes subagents.outbound', () => {
  const t = fs.readFileSync(path.join(appRoot, 'electron/preload.ts'), 'utf8')
  assert.match(t, /outbound:\s*\{/)
  assert.match(t, /prepareRunView/)
  assert.match(t, /policyActivateDraft/)
  assert.match(t, /appendEvidence/)
  assert.match(t, /sandboxProbe/)
  assert.match(t, /viewMeta/)
})

await test('coordinator prepares and disposes restricted view', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(t, /prepareRunView/)
  assert.match(t, /disposeRunView/)
  assert.match(t, /Restricted Project View/)
  assert.match(t, /isProtectionActive/)
})

await test('Settings surfaces build flavor + outbound status + policy admin', () => {
  const t = fs.readFileSync(path.join(appRoot, 'src/pages/SettingsPage.tsx'), 'utf8')
  assert.match(t, /outboundStatus/)
  assert.match(t, /Build flavor/)
  assert.match(t, /outbound\?\.status/)
  assert.match(t, /policyAdmin/)
  assert.match(t, /isPolicyAdminBuild/)
})

console.log(`\n${passed} tests passed`)
