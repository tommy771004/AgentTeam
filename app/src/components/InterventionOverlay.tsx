import { InterventionPanel } from './InterventionPanel'
import { useAgentStore } from '../store/agentStore'

/**
 * Manual intervention is a blocking decision, so it lives at app level.
 * It must remain available when the execution rail is collapsed or closed.
 */
export function InterventionOverlay() {
  const selectedRunId = useAgentStore((state) => state.selectedRunId)
  const runStates = useAgentStore((state) => state.runStates)
  const resolveIntervention = useAgentStore((state) => state.resolveIntervention)

  const selected = selectedRunId ? runStates[selectedRunId] : undefined
  const fallback = Object.entries(runStates).find(([, state]) => state.intervention?.active)
  const entry = selectedRunId && selected?.intervention?.active
    ? { runId: selectedRunId, state: selected.intervention }
    : fallback
      ? { runId: fallback[0], state: fallback[1].intervention }
      : null

  if (!entry?.state?.active) return null

  return (
    <InterventionPanel
      intervention={entry.state}
      onApprove={(payloadJson) => resolveIntervention({ action: 'approve', payloadJson }, entry.runId)}
      onReject={() => resolveIntervention({ action: 'reject' }, entry.runId)}
    />
  )
}
