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
import {
  buildComplianceReport,
  renderComplianceReportJson,
  renderComplianceReportMarkdown,
} from '../src/agent/complianceReport.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-compliance-'))
try {
  const key = createMemoryHmacKeyProvider(Buffer.from('compliance-smoke-key-32-bytes!!!!'))
  await appendEvidenceRecord({
    eventType: 'outbound-decision',
    runId: 'run-compliance',
    providerId: 'provider:demo',
    effectiveGuardMode: 'required',
    policySource: 'local',
    action: 'restricted-view',
    exclusions: [{ source: 'prompt', startLine: 4, endLine: 5 }],
  }, { ledgerDir: dir, keyProvider: key, sealed: true })
  const ledger = readEvidenceRecords({ ledgerDir: dir, runId: 'run-compliance' })
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.exclusions?.length, 1)

  const outbound = projectOutboundRunEvidence('run-compliance', ledger.map((record) => ({
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
    sealed: record.sealed,
  })))
  assert.equal(outbound.providerIds[0], 'provider:demo')
  assert.equal(outbound.redactionEvents, 1)

  const report = buildComplianceReport({
    reportId: 'report:smoke',
    runId: 'run-compliance',
    authorizations: [{ actor: 'local-user', tool: 'message_send', decision: 'allow', runId: 'run-compliance' }],
    credentialReferences: [{ reference: 'sk-live-THIS-IS-A-SECRET-VALUE', providerId: 'provider:demo' }],
    fileChanges: [{ path: 'src/demo.ts', action: 'edit', added: 4, removed: 1 }],
    blockedTools: [{ tool: 'publish', reason: 'fingerprint changed', fingerprint: 'abc123' }],
    outboundEvidence: outbound.records,
  })
  const json = renderComplianceReportJson(report)
  const markdown = renderComplianceReportMarkdown(report)
  assert.equal(report.redactionsApplied, true)
  assert.equal(report.summary.blockedTools, 1)
  assert.match(json, /message_send/)
  assert.match(json, /fingerprint changed/)
  assert.match(markdown, /Raw credentials and content: not included/)
  assert.doesNotMatch(`${json}\n${markdown}`, /sk-live-THIS-IS-A-SECRET-VALUE/)
  console.log('compliance-report smoke: 10 assertions passed')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
