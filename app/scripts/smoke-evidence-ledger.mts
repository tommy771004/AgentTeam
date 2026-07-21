/**
 * Security Evidence Ledger — ticket 04 pure-module smoke.
 * Seam: appendOutboundDecision / verifyLedgerChain; no content digests.
 * Run: node --experimental-strip-types scripts/smoke-evidence-ledger.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendEvidenceRecord,
  createMemoryHmacKeyProvider,
  isoWeekKeyTaipei,
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

console.log(`\n${passed} tests passed`)
