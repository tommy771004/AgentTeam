import { useMemo } from 'react'
import { projectContextUsage, type ContextUsage } from '../agent/contextUsageProjection'
import { resolveKnownContextWindow } from '../agent/contextUsageView'
import { TURN_RECORD_FORMAT_VERSION, type TurnRecordEntry } from '../agent/turnRecord'
import { useAgentStore } from '../store/agentStore'
import { useRunActivityStore } from '../store/runActivityStore'
import { useSettingsStore } from '../store/settingsStore'

/**
 * What one run spent, resolved the same way for every surface that shows it.
 *
 * The run summary panel, the process-feed microcopy and `/cost` all ask this
 * question, and they used to answer it with their own copy of the derivation —
 * which is how two of them came to resolve different context windows for the
 * same run. One hook, one answer.
 *
 * The window itself comes from the record first (the model catalog's own
 * figure for the model that actually served the last step) and only then from
 * this model's profile. Never from `defaultContextWindowTokens`: that ships as
 * 64,000 for everyone, so a percentage against it would be a confident wrong
 * number rather than knowledge.
 */
const EMPTY_ENTRIES: TurnRecordEntry[] = []

export function useRunContextUsage(runId: string): ContextUsage {
  const settings = useSettingsStore((state) => state.settings)
  const entries = useRunActivityStore((state) => state.presentations[runId]?.recordEntries) ?? EMPTY_ENTRIES
  const recordTotal = useRunActivityStore((state) => state.presentations[runId]?.recordTotal) ?? 0
  // The model that actually ran this run's last step, so a conversation that
  // switched models is not measured against the one it used to use.
  const runModel = useAgentStore((state) => {
    const steps = state.runStates[runId]?.steps
    return steps?.[steps.length - 1]?.modelUsed
  })

  return useMemo(
    () => projectContextUsage(
      { version: TURN_RECORD_FORMAT_VERSION, entries: [...entries] },
      {
        contextWindow: resolveKnownContextWindow(settings, runModel),
        pricing: settings.modelProfiles?.[(runModel || settings.model || '').trim()]?.pricing,
        unloadedBefore: Math.max(0, recordTotal - entries.length),
      },
    ),
    [entries, recordTotal, settings, runModel],
  )
}
