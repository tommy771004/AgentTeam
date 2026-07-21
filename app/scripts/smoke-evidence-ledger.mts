/**
 * Security Evidence Ledger — ticket 04 pure-module smoke.
 * Seam: appendOutboundDecision / verifyLedgerChain; no content digests.
 * Run: node --experimental-strip-types scripts/smoke-evidence-ledger.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendEvidenceRecord,
  buildGuardModeChangeEvidence,
  createMemoryHmacKeyProvider,
  decideSealedEvidenceWhenKeyMissing,
  isoWeekKeyTaipei,
  previousIsoWeekKeyTaipei,
  verifyLedgerFile,
  type EvidenceRecord,
} from '../src/agent/outbound/evidenceLedger.ts'

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

console.log('smoke-evidence-ledger')

await test('isoWeekKeyTaipei uses Asia/Taipei Monday-based week', () => {
  // 2026-07-20 is a Monday UTC+8 morning → week of that Monday
  const key = isoWeekKeyTaipei(new Date('2026-07-20T04:00:00.000Z'))
  assert.match(key, /^\d{4}-W\d{2}$/)
  const key2 = isoWeekKeyTaipei(new Date('2026-07-19T16:00:00.000Z')) // still Mon 00:00 in Taipei
  assert.equal(key, key2)
})

await test('append + verify chain; mutation detected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev-'))
  const key = createMemoryHmacKeyProvider(Buffer.from('test-hmac-key-32bytes-long!!!!'))
  try {
    const r1 = await appendEvidenceRecord(
      {
        eventType: 'outbound-decision',
        runId: 'run_1',
        providerId: 'llm:x',
        effectiveGuardMode: 'required',
        policySource: 'local',
        policyVersion: '1.1',
        action: 'allow',
        exclusions: [{ source: 'prompt', startLine: 2, endLine: 2 }],
      },
      { ledgerDir: dir, keyProvider: key, sealed: true },
    )
    assert.equal(r1.ok, true)
    const r2 = await appendEvidenceRecord(
      {
        eventType: 'outbound-decision',
        runId: 'run_1',
        providerId: 'llm:x',
        effectiveGuardMode: 'required',
        policySource: 'local',
        policyVersion: '1.1',
        action: 'allow',
        exclusions: [],
      },
      { ledgerDir: dir, keyProvider: key, sealed: true },
    )
    assert.equal(r2.ok, true)
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    assert.equal(files.length, 1)
    const filePath = path.join(dir, files[0])
    const ok = await verifyLedgerFile(filePath, key)
    assert.equal(ok.ok, true)

    // mutate middle of line content
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n')
    const rec = JSON.parse(lines[0]) as EvidenceRecord
    rec.action = 'block'
    lines[0] = JSON.stringify(rec)
    fs.writeFileSync(filePath, lines.join('\n') + '\n')
    const bad = await verifyLedgerFile(filePath, key)
    assert.equal(bad.ok, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('records never contain prompt/secret fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev2-'))
  const key = createMemoryHmacKeyProvider(Buffer.from('k'.repeat(32)))
  try {
    await appendEvidenceRecord(
      {
        eventType: 'outbound-decision',
        runId: 'run_x',
        providerId: 'llm:y',
        effectiveGuardMode: 'demo',
        policySource: 'local',
        policyVersion: '1.0',
        action: 'allow',
        exclusions: [{ source: 'history', startLine: 1, endLine: 3 }],
      },
      { ledgerDir: dir, keyProvider: key, sealed: false },
    )
    const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8')
    assert.doesNotMatch(raw, /prompt|password|api_key|digest|contentHash/i)
    const rec = JSON.parse(raw.trim()) as EvidenceRecord
    assert.ok(!('prompt' in rec))
    assert.ok(!('messages' in rec))
    assert.equal(rec.sealed, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('reorder detection fails verify', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev3-'))
  const key = createMemoryHmacKeyProvider(Buffer.from('reorder-key-32-bytes-long!!!!'))
  try {
    for (let i = 0; i < 3; i++) {
      await appendEvidenceRecord(
        {
          eventType: 'guard-mode-change',
          runId: `r${i}`,
          providerId: 'llm:z',
          effectiveGuardMode: 'optional',
          policySource: 'local',
          policyVersion: '1',
          action: 'allow',
          exclusions: [],
        },
        { ledgerDir: dir, keyProvider: key, sealed: true },
      )
    }
    const filePath = path.join(dir, fs.readdirSync(dir)[0])
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n')
    // swap first two lines
    ;[lines[0], lines[1]] = [lines[1], lines[0]]
    fs.writeFileSync(filePath, lines.join('\n') + '\n')
    const v = await verifyLedgerFile(filePath, key)
    assert.equal(v.ok, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('cross-week first record links previous week terminal MAC', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev-xweek-'))
  const key = createMemoryHmacKeyProvider(Buffer.from('cross-week-hmac-key-32bytes!!!!'))
  try {
    const weekA = new Date('2026-07-13T04:00:00.000Z') // prior week
    const weekB = new Date('2026-07-20T04:00:00.000Z') // next week
    assert.notEqual(isoWeekKeyTaipei(weekA), isoWeekKeyTaipei(weekB))
    assert.equal(previousIsoWeekKeyTaipei(weekB), isoWeekKeyTaipei(weekA))

    const a = await appendEvidenceRecord(
      {
        eventType: 'policy-change',
        action: 'activate',
        effectiveGuardMode: 'required',
        policySource: 'local',
        policyVersion: '2',
        changeId: 'chg-a',
      },
      { ledgerDir: dir, keyProvider: key, sealed: true, now: weekA },
    )
    assert.equal(a.ok, true)
    if (!a.ok) return
    const terminalMac = a.record.recordMac
    assert.ok(terminalMac)

    const b = await appendEvidenceRecord(
      {
        eventType: 'outbound-decision',
        action: 'allow',
        effectiveGuardMode: 'required',
        policySource: 'local',
      },
      { ledgerDir: dir, keyProvider: key, sealed: true, now: weekB },
    )
    assert.equal(b.ok, true)
    if (!b.ok) return
    assert.equal(b.record.sequence, 1)
    assert.equal(b.record.previousMac, terminalMac)

    const weekBFile = path.join(dir, `evidence-${isoWeekKeyTaipei(weekB)}.jsonl`)
    const ok = await verifyLedgerFile(weekBFile, key)
    assert.equal(ok.ok, true, ok.reason || 'week B should verify with cross-week previousMac')
    assert.equal(b.record.previousMac, terminalMac)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('onKeyUnavailable=block refuses sealed when key missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev-key-'))
  const noKey = { async getKey() { return null } }
  try {
    const blocked = decideSealedEvidenceWhenKeyMissing({
      wantSealed: true,
      keyAvailable: false,
      onKeyUnavailable: 'block',
    })
    assert.equal(blocked.proceed, false)

    const r = await appendEvidenceRecord(
      { eventType: 'outbound-decision', action: 'allow' },
      {
        ledgerDir: dir,
        keyProvider: noKey,
        sealed: true,
        onKeyUnavailable: 'block',
      },
    )
    assert.equal(r.ok, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('onKeyUnavailable=unsealed continues without MAC', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev-unseal-'))
  const noKey = { async getKey() { return null } }
  try {
    const d = decideSealedEvidenceWhenKeyMissing({
      wantSealed: true,
      keyAvailable: false,
      onKeyUnavailable: 'unsealed',
    })
    assert.equal(d.proceed, true)
    if (d.proceed) assert.equal(d.sealed, false)

    const r = await appendEvidenceRecord(
      { eventType: 'outbound-decision', action: 'allow', effectiveGuardMode: 'optional' },
      {
        ledgerDir: dir,
        keyProvider: noKey,
        sealed: true,
        onKeyUnavailable: 'unsealed',
      },
    )
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.record.sealed, false)
      assert.equal(r.record.recordMac, undefined)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('eventTypes policy/device/workspace/guard-mode append on same ledger', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odg-ev-types-'))
  const key = createMemoryHmacKeyProvider(Buffer.from('types-hmac-key-32-bytes-long!!!'))
  try {
    const types = [
      'policy-change',
      'policy-rollback',
      'guard-mode-change',
      'workspace-sync',
      'device-retired',
      'device-replaced',
      'evidence-verification',
      'retention-checkpoint',
    ] as const
    for (const eventType of types) {
      const r = await appendEvidenceRecord(
        {
          eventType,
          action: 'smoke',
          effectiveGuardMode: 'required',
          policySource: 'local',
        },
        { ledgerDir: dir, keyProvider: key, sealed: true },
      )
      assert.equal(r.ok, true, eventType)
    }
    const filePath = path.join(dir, fs.readdirSync(dir)[0])
    const v = await verifyLedgerFile(filePath, key)
    assert.equal(v.ok, true)
    const raw = fs.readFileSync(filePath, 'utf8')
    for (const t of types) assert.match(raw, new RegExp(t))
    // synthetic secrets must not appear (negative scan)
    assert.doesNotMatch(raw, /sk-live|password=|BEGIN PRIVATE/i)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

await test('guard mode transition helper produces guard-mode-change', () => {
  const e = buildGuardModeChangeEvidence({ fromMode: 'off', toMode: 'required' })
  assert.equal(e.eventType, 'guard-mode-change')
  assert.equal(e.action, 'off→required')
  assert.equal(e.effectiveGuardMode, 'required')
})

await test('import extensions: localCliRun uses .ts outbound paths', () => {
  const t = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/agent/localCliRun.ts'),
    'utf8',
  )
  assert.match(t, /outbound\/outboundGate\.ts/)
  assert.match(t, /outbound\/cliSandbox\.ts/)
})

console.log(`\n${passed} tests passed`)
