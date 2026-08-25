/**
 * Context Governor — orchestrates per-round token meter, compaction,
 * checkpoint, memory flush/recall, and related hooks for one tool-loop step.
 *
 * Lifecycle: one instance per tool-loop invocation (each step). Usage-bucket
 * state must NOT accumulate across steps.
 *
 * Effectful work is injected; pure math (token estimate / window / preflight)
 * is called directly from tokenEstimate.
 */
import type { LlmSettings } from '../types.ts'
import {
  estimateTokensFromText,
  estimateTranscriptTokens,
  resolveContextWindow,
  shouldPreflightCompact,
} from '../tokenEstimate.ts'

export type GovernorMessage = {
  role: string
  content: string | null | unknown
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export type CompactResult = {
  messages: GovernorMessage[]
  compacted: boolean
  summary?: string
  pruneStats?: {
    changed: boolean
    softTrimmed: number
    hardCleared: number
    savedChars: number
  }
}

export type ContextGovernorDeps = {
  compact: (
    settings: LlmSettings,
    messages: GovernorMessage[],
    opts?: { force?: boolean; maxChars?: number },
  ) => Promise<CompactResult>
  saveCheckpoint: (
    id: string,
    payload: { summary: string; messages: GovernorMessage[] },
  ) => void | Promise<void>
  memoryFlush: (opts: {
    objective: string
    summary: string
    runId?: string
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }) => boolean | Promise<boolean>
  memoryRecall: (
    query: string,
    limit: number,
  ) => Array<{ text: string }> | Promise<Array<{ text: string }>>
  evaluateHook: (
    point: 'beforeCompaction' | 'afterCompaction',
    ctx: { sourceKind?: string; objective?: string },
  ) =>
    | { audits: string[]; notifications: string[] }
    | Promise<{ audits: string[]; notifications: string[] }>
  bumpMetric: (runId: string | undefined, key: 'compactions') => void | Promise<void>
  notify: (title: string, body: string) => void
  log: (level: string, message: string) => void
  onContextUsage?: (usage: { tokens: number; contextWindow: number; ratio: number }) => void
  /**
   * Called once per compaction, after the summary replaced earlier messages.
   *
   * Injected so the governor stays a pure context policy: the journal record
   * and the on-screen marker are both effects of this one event, and neither
   * is reconstructed by guessing at the transcript afterwards.
   */
  onCompacted?: (event: {
    runId?: string
    threadId?: string
    summary: string
    replacedMessages: number
    remainingMessages: number
    estimatedTokens: number
    contextWindow: number
  }) => void | Promise<void>
  /** Flatten multimodal content for compaction input. */
  contentToPlainText: (content: unknown) => string | null
}

export type BeforeRoundInput = {
  messages: GovernorMessage[]
  round: number
  /** JSON-serialized tool defs for estimate (same as toolLoop). */
  toolsEstimateText: string
  settings: LlmSettings
  model?: string
  runId?: string
  threadId?: string
  objective?: string
  sourceKind?: string
}

export type ContextGovernor = {
  /** Run at the start of each tool-loop round; returns possibly compacted messages. */
  beforeRound: (input: BeforeRoundInput) => Promise<GovernorMessage[]>
}

function hasVisionParts(messages: GovernorMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      (m.content as Array<{ type?: string }>).some((p) => p.type === 'image_url'),
  )
}

function usageBucketFor(ratio: number): number {
  if (ratio >= 0.9) return 3
  if (ratio >= 0.75) return 2
  if (ratio >= 0.5) return 1
  return 0
}

/**
 * Factory — call once per tool-loop (per step). Fresh usage-bucket state.
 */
export function createContextGovernor(deps: ContextGovernorDeps): ContextGovernor {
  let lastUsageBucket = 0

  return {
    async beforeRound(input: BeforeRoundInput): Promise<GovernorMessage[]> {
      const {
        messages: inputMessages,
        round,
        toolsEstimateText,
        settings,
        model,
        runId,
        threadId,
        objective,
        sourceKind,
      } = input

      // Prefer returning the original reference when nothing changes so callers
      // can use identity checks (toolLoop: governed !== messages).
      let messages = inputMessages

      const contextWindow = resolveContextWindow(settings, model || settings.model)
      const estTokens =
        estimateTranscriptTokens(messages) + estimateTokensFromText(toolsEstimateText)
      const overflowRisk = shouldPreflightCompact(estTokens, contextWindow)
      const usageRatio = estTokens / Math.max(1, contextWindow)
      deps.onContextUsage?.({ tokens: estTokens, contextWindow, ratio: usageRatio })

      const usageBucket = usageBucketFor(usageRatio)
      if (usageBucket > lastUsageBucket) {
        lastUsageBucket = usageBucket
        deps.log(
          'INFO',
          `context 使用率 ${Math.round(usageRatio * 100)}%（${estTokens}/${contextWindow} tokens）`,
        )
      }

      // Fixed-round trigger: round 1 or every even round; overflow forces.
      if (!(overflowRisk || round === 1 || round % 2 === 0)) {
        return inputMessages
      }

      // A compaction always costs the summarized head its images. Under the
      // parity trigger nothing is at risk yet, so the cheaper answer is not to
      // run one — and the log says exactly that, because a line claiming the
      // transcript "cannot be compacted" beside a compaction that happened is
      // how this decision became unreadable in the first place.
      const vision = hasVisionParts(messages)
      if (vision && !overflowRisk) {
        deps.log(
          'INFO',
          `context 估算 ${estTokens}/${contextWindow} tokens 未逼近上限,transcript 含影像故略過本輪壓縮`,
        )
        return inputMessages
      }
      if (vision) {
        deps.log(
          'WARN',
          `context 估算 ${estTokens}/${contextWindow} tokens 已逼近上限,含影像 transcript 僅摘要較舊段落`,
        )
      }

      // The compactor receives the transcript undamaged: it flattens only the
      // head it replaces with a summary, so the tail it deliberately retains
      // keeps its image parts (OpenCode's verbatim-retention promise).
      // Flattening survives here for the checkpoint alone — persisted state
      // must stay text-sized, and a resume offer is not a vision workflow.
      // Bound to its own name because `messages` is rebound to the compacted
      // transcript below: the checkpoint must keep meaning "before".
      const preCompaction = messages
      const flatten = (): GovernorMessage[] =>
        preCompaction.map((m) => ({
          role: m.role,
          content:
            typeof m.content === 'string' || m.content == null
              ? (m.content as string | null)
              : deps.contentToPlainText(m.content),
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
          name: m.name,
        }))

      let c: CompactResult
      try {
        c = await deps.compact(
          settings,
          messages,
          overflowRisk
            ? {
                force: true,
                maxChars: Math.max(12_000, (contextWindow - 2_500) * 3),
              }
            : undefined,
        )
      } catch {
        return inputMessages
      }

      if (c.compacted) {
        if (overflowRisk) {
          deps.log(
            'WARN',
            `preflight:context 估算 ${estTokens}/${contextWindow} tokens,已先壓縮再呼叫`,
          )
        }

        // Post-compaction effects — independently fault-isolated.
        // Naming quirk preserved: "beforeCompaction" fires after compaction is decided.

        // 1) beforeCompaction hook
        try {
          const ev = await deps.evaluateHook('beforeCompaction', {
            sourceKind,
            objective,
          })
          for (const line of ev.audits) deps.log('INFO', line)
        } catch {
          /* non-fatal */
        }

        // 2) checkpoint — pre-compaction messages (flattened for storage)
        try {
          await deps.saveCheckpoint(runId || threadId || 'adhoc', {
            summary: c.summary || '',
            messages: flatten(),
          })
        } catch {
          /* non-fatal */
        }

        // 3) compaction event — the record that the agent's view was rewritten
        try {
          await deps.onCompacted?.({
            runId,
            threadId,
            summary: c.summary || '',
            replacedMessages: Math.max(0, preCompaction.length - c.messages.length + 1),
            remainingMessages: c.messages.length,
            estimatedTokens: estTokens,
            contextWindow,
          })
        } catch {
          /* non-fatal */
        }

        // 4) memory flush
        try {
          const flushed = await deps.memoryFlush({
            objective: objective || '',
            summary: c.summary || '',
            runId,
            memoryEnabled: settings.memoryEnabled,
            memoryWriteEnabled: settings.memoryWriteEnabled,
          })
          if (flushed) deps.log('INFO', '壓縮前已將重要脈絡 flush 進持久記憶')
        } catch {
          /* non-fatal */
        }
      }

      // 5) message replacement (compaction OR prune-only)
      if (c.compacted || c.pruneStats?.changed) {
        messages = c.messages.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
          name: m.name,
        }))
      }

      if (c.pruneStats?.changed) {
        deps.log(
          'INFO',
          `pruning:soft-trim ${c.pruneStats.softTrimmed} 筆、hard-clear ${c.pruneStats.hardCleared} 筆,省下 ${c.pruneStats.savedChars} chars`,
        )
      }

      if (c.compacted) {
        // 6) memory recall
        if (settings.memoryEnabled !== false) {
          try {
            const related = await deps.memoryRecall(objective || '', 3)
            if (related.length) {
              const idx = messages.findIndex(
                (m) =>
                  m.role === 'system' &&
                  typeof m.content === 'string' &&
                  m.content.startsWith('## Context compaction'),
              )
              if (idx >= 0) {
                messages[idx] = {
                  ...messages[idx],
                  content: `${messages[idx].content}\n\n### 壓縮後記憶召回\n${related
                    .map((e) => `- ${e.text.slice(0, 200)}`)
                    .join('\n')}`,
                }
              }
            }
          } catch {
            /* non-fatal */
          }
        }

        // 7) metrics + afterCompaction hook + notify
        deps.log('INFO', 'Context compacted (OpenCode-style)')
        try {
          await deps.bumpMetric(runId, 'compactions')
        } catch {
          /* non-fatal */
        }
        try {
          const ev = await deps.evaluateHook('afterCompaction', {
            sourceKind,
            objective,
          })
          for (const line of ev.audits) deps.log('INFO', line)
          for (const n of ev.notifications) {
            deps.notify('SubAgents AI · Hook', n.slice(0, 160))
          }
        } catch {
          /* non-fatal */
        }
      }

      return messages
    },
  }
}
