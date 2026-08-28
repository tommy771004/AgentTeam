import { ARTIFACT_RENDERER_CAPABILITIES } from './artifactRendererCapabilities.ts'
import type { SubDesignPluginExecutionProjection } from './pluginExecution.ts'
import {
  canRender,
  mergeStreamingUpdate,
  reconcileUpdates,
  type StreamingEnvelope,
  type StreamingStatus,
  type StreamingUpdate,
} from './streamingEnvelope.ts'
import type { SubDesignArtifact } from './types.ts'

export type SubDesignStreamActivity = {
  seq: number
  kind: Exclude<NonNullable<StreamingUpdate['kind']>, 'text-delta'>
  summary: string
  status: StreamingStatus
  at?: string
}

export type SubDesignStreamingPresentation = {
  artifactId: string
  envelope: StreamingEnvelope | null
  cursor: number
  content: string
  status: StreamingStatus | 'static'
  error?: string
  useStaticFallback: boolean
  fallbackReason?: string
  activity: SubDesignStreamActivity[]
  rejected: string[]
}

export type SubDesignStreamingSnapshot = {
  artifact: SubDesignArtifact
  liveEnvelope?: StreamingEnvelope | null
  providerRuns?: readonly SubDesignPluginExecutionProjection[]
}

function matchingPersistedEnvelope(snapshot: SubDesignStreamingSnapshot): StreamingEnvelope | null {
  const run = snapshot.providerRuns?.find((candidate) => candidate.artifact?.id === snapshot.artifact.id && candidate.stream)
  return run?.stream || null
}

function activitySummary(update: StreamingUpdate): string {
  if (update.kind === 'tool-call') return `執行 ${update.tool || 'tool'}${update.text ? `：${update.text}` : ''}`
  if (update.kind === 'tool-result') return `${update.tool || 'tool'} ${update.ok === false ? '失敗' : '完成'}${update.text ? `：${update.text}` : ''}`
  if (update.kind === 'file-write') return `寫入 ${update.path || 'artifact file'}`
  return update.text || update.kind || 'stream update'
}

function presentationFromEnvelope(
  snapshot: SubDesignStreamingSnapshot,
  envelope: StreamingEnvelope | null,
  rejected: string[],
): SubDesignStreamingPresentation {
  if (!envelope) {
    return {
      artifactId: snapshot.artifact.id,
      envelope: null,
      cursor: 0,
      content: '',
      status: 'static',
      useStaticFallback: true,
      activity: [],
      rejected,
    }
  }
  const accepted = reconcileUpdates(envelope.updates)
  const gate = canRender(ARTIFACT_RENDERER_CAPABILITIES[snapshot.artifact.renderer], {
    ...envelope,
    artifactId: snapshot.artifact.id,
    artifactKind: snapshot.artifact.kind,
  })
  const status = envelope.status
  const activity = accepted
    .filter((update): update is StreamingUpdate & { kind: Exclude<NonNullable<StreamingUpdate['kind']>, 'text-delta'> } => Boolean(update.kind && update.kind !== 'text-delta'))
    .map((update) => ({
      seq: update.seq,
      kind: update.kind,
      summary: activitySummary(update),
      status,
      at: update.at,
    }))
  return {
    artifactId: snapshot.artifact.id,
    envelope: { ...envelope, artifactId: snapshot.artifact.id, artifactKind: snapshot.artifact.kind },
    cursor: accepted.at(-1)?.seq || 0,
    content: accepted.map((update) => update.content || '').join(''),
    status,
    ...(envelope.error ? { error: envelope.error } : {}),
    useStaticFallback: !gate.ok || !accepted.some((update) => Boolean(update.content)),
    ...(!gate.ok ? { fallbackReason: gate.reason } : {}),
    activity,
    rejected,
  }
}

/**
 * Disposable renderer projection. Host snapshot and artifact manifest remain
 * canonical; replaying the same snapshot plus events produces the same UI.
 */
export function projectSubDesignStreaming(input: {
  snapshot: SubDesignStreamingSnapshot
  events?: readonly StreamingUpdate[]
}): SubDesignStreamingPresentation {
  const { snapshot } = input
  let envelope = snapshot.liveEnvelope || matchingPersistedEnvelope(snapshot)
  const rejected: string[] = []
  for (const event of input.events || []) {
    if (!envelope) {
      rejected.push(`seq ${event.seq}: stream snapshot missing`)
      continue
    }
    const merged = mergeStreamingUpdate(envelope, event)
    envelope = merged.envelope
    if (merged.rejected) rejected.push(`seq ${event.seq}: ${merged.rejected}`)
  }
  return presentationFromEnvelope(snapshot, envelope, rejected)
}
