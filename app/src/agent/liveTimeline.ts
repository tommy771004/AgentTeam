/**
 * The timeline of a run that is still happening — projected from the Turn
 * Record, by the same pure function that projects a finished one.
 *
 * Before this module the live view and the replay view were built from
 * different things: live rows came from the activity event stream (arrival
 * order, transport-level, thrown away at exit), replay rows came from the
 * record (recorded order, durable). Nothing forced the two orders to agree,
 * so what a user watched happen and what they read back afterwards could
 * legitimately differ. One projection over one ordered source is what makes
 * that disagreement impossible rather than merely unlikely.
 *
 * The activity event channel is not gone — it is the fallback for runners that
 * keep no Turn Record at all (external CLI). It is no longer a second way to
 * build the Pi path's timeline.
 *
 * Pure by contract, like every projection in this effort: no I/O, no store, no
 * clock. It runs on a live buffer and on a replayed page alike.
 */
import { projectTrajectory, type TrajectoryView } from './trajectoryProjection.ts'
import {
  pageTurnRecord,
  TURN_RECORD_FORMAT_VERSION,
  TURN_RECORD_PAGE_SIZE,
  type TurnRecordEntry,
  type TurnRecordPage,
} from './turnRecord.ts'

/** How many live entries one view renders at a time — the record's own page size. */
export const LIVE_TIMELINE_LIMIT = TURN_RECORD_PAGE_SIZE

/**
 * One page of what the renderer has watched arrive.
 *
 * `seen` is how many entries the run has published in total, which can exceed
 * what the ephemeral buffer still holds. Passing it keeps the page honest
 * about its own prefix: the view says older entries exist and offers a cursor
 * for the Host to serve them, instead of quietly presenting a truncated
 * buffer as the whole run.
 */
export function liveTimelinePage(
  entries: readonly TurnRecordEntry[],
  seen?: number,
  limit: number = LIVE_TIMELINE_LIMIT,
): TurnRecordPage {
  const page = pageTurnRecord({ version: TURN_RECORD_FORMAT_VERSION, entries: [...entries] }, { limit })
  const total = Math.max(page.total, typeof seen === 'number' && Number.isFinite(seen) ? seen : 0)
  const hasOlder = page.entries.length < total
  return {
    entries: page.entries,
    ...(hasOlder && page.entries.length > 0 ? { nextBefore: page.entries[0].seq } : {}),
    hasOlder,
    total,
  }
}

/**
 * The live timeline.
 *
 * Deliberately a one-line composition and not a second implementation: the
 * whole point is that live rows come out of `projectTrajectory`, so a future
 * change to how a row is shaped reaches both surfaces or neither.
 */
export function projectLiveTimeline(
  entries: readonly TurnRecordEntry[],
  seen?: number,
  limit: number = LIVE_TIMELINE_LIMIT,
): TrajectoryView {
  return projectTrajectory(liveTimelinePage(entries, seen, limit))
}

/**
 * Entries carried by a `host/record-append` event, or nothing.
 *
 * The renderer receives Host events as untyped IPC, so the shape is checked
 * here rather than trusted at the call site. An event that does not carry a
 * run id and at least one sequenced entry yields nothing — a malformed frame
 * must not be able to renumber a timeline.
 */
export function recordAppendFromEvent(
  event: { event?: unknown; payload?: unknown } | null | undefined,
): { runId: string; entries: TurnRecordEntry[] } | null {
  if (!event || event.event !== 'host/record-append') return null
  const payload = event.payload
  if (!payload || typeof payload !== 'object') return null
  const { runId, entries } = payload as { runId?: unknown; entries?: unknown }
  if (typeof runId !== 'string' || !runId || !Array.isArray(entries)) return null
  const kept = entries.filter((entry): entry is TurnRecordEntry => {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as Record<string, unknown>
    return typeof candidate.kind === 'string'
      && typeof candidate.seq === 'number'
      && Number.isFinite(candidate.seq)
      && typeof candidate.turn === 'number'
      && typeof candidate.step === 'number'
  })
  return kept.length > 0 ? { runId, entries: kept } : null
}

/**
 * One line of the unified run timeline.
 *
 * A fold over the trajectory rows, never a second synthesis of them: the
 * ordering, the step attribution and the timing all arrive already decided by
 * `projectTrajectory`, and this only decides what a reader sees on one line.
 */
export type RunTimelineRow = {
  id: string
  seq: number
  turn: number
  step: number
  timing?: TrajectoryView['rows'][number]['timing']
} & (
  | {
      kind: 'reasoning'
      content: string
      /** Length of the thought, so a collapsed row can say what it is hiding. */
      chars: number
    }
  | {
      kind: 'assistant'
      content: string
      /** Still being written — the current assistant line, not a settled one. */
      draft?: boolean
    }
  | { kind: 'tool'; tool: string; callId: string; settlement?: string; detail?: string; approval?: string; approvalReason?: string }
  | { kind: 'notice'; content: string }
)

/**
 * The rows a run's timeline shows.
 *
 * Two folds, both of them about not saying the same thing twice:
 *
 *  - a tool's call row and its result row are ONE line, because the reader is
 *    watching one action; the result supplies the settlement the call did not
 *    know yet, and the call keeps the position it actually occupied.
 *  - the user's own prompt is dropped, because the chat bubble immediately
 *    above the feed is already that text.
 *
 * `draft` is the text streaming in right now. It belongs to the timeline's
 * current assistant line rather than to a panel of its own — the narrative is
 * 解說 → 動作 → 結論, and a draft parked elsewhere breaks it.
 */
export function runTimelineRows(view: TrajectoryView, draft?: string): RunTimelineRow[] {
  const rows: RunTimelineRow[] = []
  const toolRowIndex = new Map<string, number>()
  for (const row of view.rows) {
    const base = { id: row.id, seq: row.seq, turn: row.turn, step: row.step, ...(row.timing ? { timing: row.timing } : {}) }
    switch (row.kind) {
      case 'user':
        break
      case 'reasoning':
        rows.push({ ...base, kind: 'reasoning', content: row.content, chars: row.content.length })
        break
      case 'assistant':
        rows.push({ ...base, kind: 'assistant', content: row.content })
        break
      case 'notice':
        rows.push({ ...base, kind: 'notice', content: row.content })
        break
      case 'tool': {
        const existing = toolRowIndex.get(row.callId)
        if (existing === undefined) {
          toolRowIndex.set(row.callId, rows.length)
          rows.push({
            ...base,
            kind: 'tool',
            tool: row.tool,
            callId: row.callId,
            ...(row.settlement ? { settlement: row.settlement } : {}),
            ...(row.detail ? { detail: row.detail } : {}),
            // The approval decision rides the invocation's own line (the
            // conversation projection attached it there); keep it through the fold.
            ...(row.approval ? { approval: row.approval } : {}),
            ...(row.approvalReason ? { approvalReason: row.approvalReason } : {}),
          })
          break
        }
        const merged = rows[existing]
        if (merged.kind !== 'tool') break
        rows[existing] = {
          ...merged,
          ...(row.settlement ? { settlement: row.settlement } : {}),
          // The call's own detail (its path) is the better label; a result
          // only fills the gap when the call never carried one.
          ...(merged.detail ? {} : row.detail ? { detail: row.detail } : {}),
          ...(merged.approval ? {} : row.approval ? { approval: row.approval } : {}),
          ...(merged.approvalReason ? {} : row.approvalReason ? { approvalReason: row.approvalReason } : {}),
          ...(row.timing ? { timing: row.timing } : {}),
        }
        break
      }
      default:
        break
    }
  }
  const streaming = draft?.trim()
  if (streaming) {
    const last = rows[rows.length - 1]
    const seq = (last?.seq ?? 0) + 1
    rows.push({
      id: `draft-${seq}`,
      seq,
      turn: last?.turn ?? 1,
      step: last?.step ?? 1,
      kind: 'assistant',
      content: draft as string,
      draft: true,
    })
  }
  return rows
}
