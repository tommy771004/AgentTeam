import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendEvidenceRecord,
  createMemoryHmacKeyProvider,
  readEvidenceRecords,
} from '../src/agent/outbound/evidenceLedger.ts'
import { projectOutboundRunEvidence } from '../src/agent/outbound/runEvidence.ts'
import { summarizeRedactions } from '../src/agent/outbound/redactionTaxonomy.ts'

const opsSource = fs.readFileSync(new URL('../src/pages/OpsPage.tsx', import.meta.url), 'utf8')
const viewSource = fs.readFileSync(new URL('../src/components/OutboundRunView.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(opsSource, /activeRuns\[0\].*OutboundRunView/)
assert.match(opsSource, /selectedOutboundRunId/)
assert.match(opsSource, /outboundRunIds\.map/)
assert.match(viewSource, /遮罩類別/)
assert.match(viewSource, /required: '必須通過 outbound policy/)

const taxonomy = summarizeRedactions([
  { detectorId: 'baseline.api-key' },
  { detectorId: 'company.customer-secret' },
], { profileSource: 'company' })
assert.deepEqual(taxonomy, [
  { category: 'credential', count: 1 },
  { category: 'company-policy', count: 1 },
])

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-outbound-view-'))
try {
  const key = createMemoryHmacKeyProvider(Buffer.from('outbound-view-smoke-key-32-bytes!'))
  await appendEvidenceRecord({
    eventType: 'outbound-decision',
    runId: 'run-view',
    providerId: 'openai:default',
    effectiveGuardMode: 'required',
    policySource: 'local',
    filesystemIsolation: 'verified',
    action: 'restricted-view',
    exclusions: [{ source: 'prompt', startLine: 2, endLine: 2 }],
    redactionSummary: [{ category: 'credential', count: 1 }],
  }, { ledgerDir: dir, keyProvider: key, sealed: true })
  await appendEvidenceRecord({
    eventType: 'outbound-decision',
    runId: 'other-run',
    providerId: 'ignored',
    action: 'other',
  }, { ledgerDir: dir, keyProvider: key, sealed: false })
  const records = readEvidenceRecords({ ledgerDir: dir, runId: 'run-view', limit: 100 })
  assert.equal(records.length, 1)
  const view = projectOutboundRunEvidence('run-view', records.map((record) => ({
    eventId: record.eventId,
    eventType: record.eventType,
    timestampUtc: record.timestampUtc,
    runId: record.runId,
    providerId: record.providerId,
    effectiveGuardMode: record.effectiveGuardMode,
    policySource: record.policySource,
    filesystemIsolation: record.filesystemIsolation,
    action: record.action,
    exclusionCount: record.exclusions?.length || 0,
    redactionSummary: record.redactionSummary,
    sealed: record.sealed,
  })))
  assert.equal(view.providerIds.join(','), 'openai:default')
  assert.equal(view.exclusionCount, 1)
  assert.equal(view.sealedRecords, 1)
  assert.equal(view.records[0]?.filesystemIsolation, 'verified')
  assert.deepEqual(view.redactionSummary, [{ category: 'credential', count: 1 }])
  assert.doesNotMatch(JSON.stringify(view), /outbound-view-smoke-key/)
  console.log('outbound-run-view smoke: taxonomy, evidence, and UX assertions passed')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
