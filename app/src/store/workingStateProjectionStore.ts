import { create } from 'zustand'
import type { TurnRecordEntry } from '../agent/turnRecord.ts'
import { isWorkingState, type WorkingState } from '../agent/workingState.ts'
import {
  mergeWorkingStateProjection,
  projectWorkingState,
  projectWorkingStateEntries,
  unavailableWorkingStateProjection,
  type WorkingStateProjection,
} from '../agent/workingStateProjection.ts'

type HostWorkingStateSession = {
  id: string
  archived?: boolean
  workingState?: WorkingState
}

type WorkingStateProjectionStore = {
  hostAvailable: boolean
  byRunId: Record<string, WorkingStateProjection>
  setHostAvailable: (available: boolean) => void
  hydrateHostSessions: (sessions: readonly HostWorkingStateSession[]) => void
  appendHostRecord: (entries: readonly TurnRecordEntry[], runId: string) => void
  reset: () => void
}

export const useWorkingStateProjectionStore = create<WorkingStateProjectionStore>((set) => ({
  hostAvailable: false,
  byRunId: {},

  setHostAvailable: (hostAvailable) => set((state) => ({
    hostAvailable,
    byRunId: hostAvailable
      ? state.byRunId
      : Object.fromEntries(Object.entries(state.byRunId).map(([runId, projection]) => [
          runId,
          projection.verification === 'verified'
            ? { ...projection, verification: 'unverified' as const }
            : projection,
        ])),
  })),

  hydrateHostSessions: (sessions) => set((state) => {
    const byRunId = { ...state.byRunId }
    for (const session of sessions) {
      if (!isWorkingState(session.workingState)) continue
      const incoming = session.archived
        ? unavailableWorkingStateProjection(session.workingState.runId, true)
        : projectWorkingState(session.workingState, 'verified')
      byRunId[incoming.runId] = mergeWorkingStateProjection(byRunId[incoming.runId], incoming)
    }
    return { hostAvailable: true, byRunId }
  }),

  appendHostRecord: (entries, runId) => set((state) => {
    const incoming = projectWorkingStateEntries(entries, state.hostAvailable)
    if (incoming.verification === 'unavailable' || incoming.runId !== runId) return state
    return {
      byRunId: {
        ...state.byRunId,
        [runId]: mergeWorkingStateProjection(state.byRunId[runId], incoming),
      },
    }
  }),

  reset: () => set({ hostAvailable: false, byRunId: {} }),
}))
