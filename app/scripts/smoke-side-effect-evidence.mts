/**
 * ADR-0048: a model cannot manufacture its own execution credential.
 * Per side-effect exit, adapter-issued evidence is accepted and
 * model-generated / missing evidence is refused.
 */
import assert from 'node:assert/strict'
import {
  createSideEffectEvidence,
  gateSideEffect,
  rejectModelSuppliedEvidence,
  validateSideEffectEvidence,
  MODEL_SUPPLIED_EVIDENCE_REFUSAL,
} from '../src/agent/evidence/sideEffectEvidence.ts'
import {
  acceptWorkflowDeliveryEvidence,
  recordWorkflowDelivery,
  type WorkflowSession,
} from '../src/agent/paidWorkflow.ts'
import { createContentPublishAdapterRegistry } from '../src/agent/contentPublishAdapters.ts'

let passed = 0
const check = async (label: string, fn: () => void | Promise<void>) => {
  try {
    await fn()
  } catch (error) {
    console.error(`smoke-side-effect-evidence FAILED: ${label}`)
    throw error
  }
  passed += 1
}

// ── shape ────────────────────────────────────────────────────────
const adapterEvidence = createSideEffectEvidence({
  runId: 'run_evidence',
  kind: 'deploy',
  source: 'release-adapter',
  metadata: { target: 'staging', payload: 'metadata-only' },
})

await check('adapter evidence validates', () => {
  assert.equal(validateSideEffectEvidence(adapterEvidence).ok, true)
  assert.equal(validateSideEffectEvidence({ ...adapterEvidence, issuedBy: 'model' }).ok, false)
  assert.equal(validateSideEffectEvidence({ ...adapterEvidence, attestation: 'model-generated' }).ok, false)
  assert.equal(validateSideEffectEvidence(undefined).ok, false)
})

await check('evidence never carries credentials or payloads', () => {
  const serialized = JSON.stringify(adapterEvidence)
  assert.doesNotMatch(serialized, /token|secret|password|authorization/i)
  assert.equal(adapterEvidence.metadata.payload, 'metadata-only')
})

// ── gate: runtime refusal (layer two) ────────────────────────────
await check('gateSideEffect refuses missing, mismatched and cross-run evidence', () => {
  assert.equal(gateSideEffect({ kind: 'deploy', evidence: adapterEvidence, result: 1 }).ok, true)
  assert.equal(gateSideEffect({ kind: 'deploy', evidence: undefined, result: 1 }).ok, false)
  assert.equal(gateSideEffect({ kind: 'merge', evidence: adapterEvidence, result: 1 }).ok, false)
  const other = gateSideEffect({ kind: 'deploy', evidence: adapterEvidence, result: 1, runId: 'run_other' })
  assert.equal(other.ok, false)
  if (!other.ok) assert.match(other.reason, /different run/)
  const forged = gateSideEffect({ kind: 'deploy', evidence: { ...adapterEvidence, issuedBy: 'model' }, result: 1 })
  assert.equal(forged.ok, false)
  if (!forged.ok) assert.match(forged.reason, /trusted adapter/)
})

// ── exit: model-supplied tool arguments ──────────────────────────
await check('model tool arguments naming an evidence field are refused with a reason', () => {
  assert.equal(rejectModelSuppliedEvidence({ chatId: '1', text: 'hi' }), undefined)
  for (const key of ['evidence', 'evidenceId', 'attestation', 'issuedBy']) {
    const refusal = rejectModelSuppliedEvidence({ chatId: '1', text: 'hi', [key]: adapterEvidence })
    assert.ok(refusal, `${key} must be refused`)
    assert.match(String(refusal), /rejected argument/)
    assert.ok(String(refusal).startsWith(MODEL_SUPPLIED_EVIDENCE_REFUSAL))
  }
})

// ── exit: message_send ───────────────────────────────────────────
await check('message_send is not reportable as delivered without gateway evidence', () => {
  const gatewayIssued = createSideEffectEvidence({
    runId: 'run_msg',
    kind: 'message_send',
    source: 'gateway:telegram',
    metadata: { channel: 'telegram', targetRef: '42', payload: 'metadata-only' },
  })
  assert.equal(
    gateSideEffect({ kind: 'message_send', evidence: gatewayIssued, result: { ok: true }, runId: 'run_msg' }).ok,
    true,
  )
  // gateway returned ok but no snapshot -> refused
  assert.equal(gateSideEffect({ kind: 'message_send', evidence: undefined, result: { ok: true } }).ok, false)
})

await check('Host message_send declares outbound side-effect policy and delegates credentials to main', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../electron/piExtensionPacks/integrations.ts', import.meta.url), 'utf8'),
  )
  assert.doesNotMatch(source, /createSideEffectEvidence/)
  assert.match(source, /policyMigration: \{ outbound: true, sideEffect: true \}/)
  assert.match(source, /requestPiHostService[\s\S]*'messaging\/send'/)
  assert.doesNotMatch(source, /messagingGatewayToken|SUBAGENTS_TELEGRAM_BOT_TOKEN|botToken/)
  assert.match(source, /A model may never supply its own execution credential/)
})

// ── exit: content publishing ─────────────────────────────────────
const schedule = {
  id: 'schedule_evidence',
  contentItemId: 'content_item_evidence',
  platform: 'linkedin',
  scheduledAt: '2026-08-17T10:00:00.000Z',
}

await check('publish registry forwards adapter evidence and never mints its own', async () => {
  const issued = createSideEffectEvidence({
    kind: 'content_publish',
    source: 'platform:linkedin',
    metadata: { platform: 'linkedin', contentItemId: schedule.contentItemId, payload: 'metadata-only' },
  })
  const registry = createContentPublishAdapterRegistry([
    { platform: 'linkedin', publish: async () => ({ ok: true, status: 'published', externalId: 'p1', evidence: issued }) },
  ])
  const result = await registry.publish(schedule, { title: 't', body: 'b' })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.evidence.evidenceId, issued.evidenceId)
})

await check('publish claiming success without evidence is not-published', async () => {
  const registry = createContentPublishAdapterRegistry([
    // a compromised or naive adapter claiming success with no snapshot
    { platform: 'linkedin', publish: async () => ({ ok: true, status: 'published' } as never) },
  ])
  const result = await registry.publish(schedule, { title: 't', body: 'b' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.status, 'not-published')
    assert.equal(result.code, 'PLATFORM_PUBLISH_FAILED')
    assert.match(result.message, /evidence/)
  }
})

await check('publish carrying model-attested evidence is refused', async () => {
  const registry = createContentPublishAdapterRegistry([
    {
      platform: 'linkedin',
      publish: async () =>
        ({
          ok: true,
          status: 'published',
          evidence: { ...adapterEvidence, kind: 'content_publish', issuedBy: 'model' },
        }) as never,
    },
  ])
  const result = await registry.publish(schedule, { title: 't', body: 'b' })
  assert.equal(result.ok, false)
})

// ── exit: paid-workflow merge / push / deploy ────────────────────
const session = {
  id: 'workflow:t1:run_evidence',
  runId: 'run_evidence',
} as WorkflowSession

await check('delivery evidence kind must match the action', () => {
  assert.equal(acceptWorkflowDeliveryEvidence('deploy', adapterEvidence).ok, true)
  assert.equal(acceptWorkflowDeliveryEvidence('deploy', { ...adapterEvidence, kind: 'push' }).ok, false)
})

await check('delivery requires both user approval and adapter evidence', () => {
  const approvedAndEvidenced = recordWorkflowDelivery(session, {
    action: 'deploy',
    userApproved: true,
    evidence: adapterEvidence,
  })
  assert.equal(approvedAndEvidenced.ok, true)
  if (approvedAndEvidenced.ok) assert.equal(approvedAndEvidenced.delivery.approvedBy, 'user')

  // approval without evidence: approvalMode `full` reaches here and stops
  const noEvidence = recordWorkflowDelivery(session, { action: 'deploy', userApproved: true, evidence: undefined })
  assert.equal(noEvidence.ok, false)

  // evidence without approval
  const noApproval = recordWorkflowDelivery(session, {
    action: 'deploy',
    userApproved: false,
    evidence: adapterEvidence,
  })
  assert.equal(noApproval.ok, false)
  if (!noApproval.ok) assert.match(noApproval.reason, /approval/)

  // model-attested evidence
  const forged = recordWorkflowDelivery(session, {
    action: 'deploy',
    userApproved: true,
    evidence: { ...adapterEvidence, attestation: 'model-generated' },
  })
  assert.equal(forged.ok, false)

  // cross-run evidence
  const crossRun = recordWorkflowDelivery(session, {
    action: 'deploy',
    userApproved: true,
    evidence: { ...adapterEvidence, runId: 'run_other' },
  })
  assert.equal(crossRun.ok, false)
})

await check('an unattended timeout produces no evidence and therefore no delivery', () => {
  // an unattended run that times out yields no adapter call, hence no snapshot
  for (const action of ['merge', 'push', 'deploy'] as const) {
    assert.equal(recordWorkflowDelivery(session, { action, userApproved: true, evidence: null }).ok, false)
  }
})

console.log(`smoke-side-effect-evidence: ${passed} groups passed`)
