import assert from 'node:assert/strict'
import { createSideEffectEvidence, validateSideEffectEvidence } from '../src/agent/evidence/sideEffectEvidence.ts'
import { acceptWorkflowDeliveryEvidence } from '../src/agent/paidWorkflow.ts'

const adapterEvidence = createSideEffectEvidence({
  runId: 'run_evidence',
  kind: 'deploy',
  source: 'release-adapter',
  metadata: { target: 'staging', payload: 'metadata-only' },
})
assert.equal(validateSideEffectEvidence(adapterEvidence).ok, true)
assert.equal(validateSideEffectEvidence({ ...adapterEvidence, issuedBy: 'model' }).ok, false)
assert.equal(validateSideEffectEvidence({ ...adapterEvidence, attestation: 'model-generated' }).ok, false)
assert.equal(acceptWorkflowDeliveryEvidence('deploy', adapterEvidence).ok, true)
assert.equal(acceptWorkflowDeliveryEvidence('deploy', { ...adapterEvidence, kind: 'push' }).ok, false)
console.log('smoke-side-effect-evidence: 5 assertions passed')
