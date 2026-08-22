/** Internal Pi Host event adapter for the workspace facade. */
import type { StreamingUpdate } from './streamingEnvelope.ts'

export type SubDesignWorkspaceHostEvent = {
  event: 'host/pipeline-stream'
  payload: {
    runId: string
    sessionId: string
    stageId: string
    providerId: string
    update: StreamingUpdate
  }
}

type SubDesignWorkspaceRawHostEvent = {
  event: string
  payload: unknown
}

export type SubDesignWorkspaceHostEventListener = (event: SubDesignWorkspaceHostEvent) => void
export type SubDesignWorkspaceRawHostEventSubscription = (
  listener: (event: SubDesignWorkspaceRawHostEvent) => void,
) => () => void

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function adaptPipelineStreamEvent(event: SubDesignWorkspaceRawHostEvent): SubDesignWorkspaceHostEvent | null {
  if (event.event !== 'host/pipeline-stream') return null
  const payload = asRecord(event.payload)
  const runId = asNonEmptyString(payload?.runId)
  const sessionId = asNonEmptyString(payload?.sessionId)
  const stageId = asNonEmptyString(payload?.stageId)
  const providerId = asNonEmptyString(payload?.providerId)
  const update = asRecord(payload?.update)
  if (!runId || !sessionId || !stageId || !providerId || !update) return null
  return {
    event: 'host/pipeline-stream',
    payload: {
      runId,
      sessionId,
      stageId,
      providerId,
      update: update as StreamingUpdate,
    },
  }
}

/** Adapt the untyped preload event boundary before it reaches the workspace. */
export function createSubDesignHostEventSubscription(
  subscribe?: SubDesignWorkspaceRawHostEventSubscription,
): (listener: SubDesignWorkspaceHostEventListener) => () => void {
  return (listener) => {
    if (!subscribe) return () => undefined
    return subscribe((event) => {
      const adapted = adaptPipelineStreamEvent(event)
      if (adapted) listener(adapted)
    })
  }
}
