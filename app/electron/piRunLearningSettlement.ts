import {
  decideRunLearningSettlement,
  type RunLearningFinalOutcome,
} from '../src/agent/runLearningSettlement.ts'
import { canonicalProjectId, type DurableMemoryStore, type MemoryAccessContext } from './durableMemoryStore.ts'
import type { PiHostRunLearningCandidate } from './piHostAttachment.ts'
import { writePiMemory, type PiMemoryChange } from './piDurableMemory.ts'

export type PiRunLearningSettlement = {
  committed: boolean
  mode?: 'explicit' | 'automatic'
  reason:
    | 'no-candidate'
    | 'write-disabled'
    | 'temporary'
    | 'eligible-explicit'
    | 'eligible-automatic'
    | 'external-runner'
    | 'non-success'
    | 'dod-unmet'
    | 'already-committed'
}

/**
 * Commit one Host-owned learning candidate after the app finalization owner
 * supplies the final run outcome. The stable call id makes a crash between
 * SQLite commit and finalization-complete safe to retry.
 */
export async function settlePiRunLearning(input: {
  store: DurableMemoryStore
  candidate?: PiHostRunLearningCandidate
  outcome: RunLearningFinalOutcome
  publish?: (change: PiMemoryChange) => void
}): Promise<PiRunLearningSettlement> {
  const candidate = input.candidate
  if (!candidate) return { committed: false, reason: 'no-candidate' }
  if (!candidate.access.memoryWriteEnabled) {
    return { committed: false, mode: candidate.mode, reason: 'write-disabled' }
  }
  if (candidate.access.temporary) {
    return { committed: false, mode: candidate.mode, reason: 'temporary' }
  }
  const decision = decideRunLearningSettlement(candidate.mode, input.outcome)
  if (!decision.commit) {
    return { committed: false, mode: candidate.mode, reason: decision.reason }
  }
  const access: MemoryAccessContext = {
    origin: 'runtime',
    runId: candidate.access.runId,
    sessionId: candidate.access.sessionId,
    callId: 'run-learning-finalization',
    memoryReadEnabled: candidate.access.memoryReadEnabled,
    memoryWriteEnabled: candidate.access.memoryWriteEnabled,
    temporary: candidate.access.temporary,
    canonicalProject: canonicalProjectId(candidate.access.canonicalProject),
  }
  const beforeRevision = await input.store.revision()
  await writePiMemory(input.store, access, candidate.memory, input.publish)
  const committed = await input.store.revision() > beforeRevision
  return {
    committed,
    mode: candidate.mode,
    reason: committed ? decision.reason : 'already-committed',
  }
}
