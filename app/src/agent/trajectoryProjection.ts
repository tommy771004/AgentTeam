/**
 * The trajectory view, projected from one page of the Turn Record.
 *
 * A finished run has an interior worth walking back through: which step was
 * slow, which tool failed, where the answer actually came from. This turns a
 * page of entries into rows a view can render without knowing anything about
 * how the record is stored — and, like every projection in this effort, it is
 * pure so live rendering and replay produce the same rows.
 */
import { projectConversationRows, type ConversationRow } from './conversationProjection.ts'
import { recordRunnerDeclaration, stepTimings, type PiStepTimingView, type TurnRecord, type TurnRecordPage } from './turnRecord.ts'

export type TrajectoryRow = ConversationRow & {
  /** The step this row belongs to, so a reader can locate it rather than scroll for it. */
  step: number
  /** Timing for the row's step, absent while that step is still running. */
  timing?: PiStepTimingView
}

export type TrajectoryView = {
  rows: TrajectoryRow[]
  /**
   * Entries older than this page that have not been loaded. A view marks them
   * neutrally — never with a fabricated duration or a guessed count of work.
   */
  unloadedBefore: number
  /** Pass as `before` to load the page ahead of this one. */
  nextBefore?: number
  /** Steps covered by this page, whether or not they have finished. */
  steps: PiStepTimingView[]
  /**
   * The runner that drove the turn, when it declared itself. Present so a view
   * can say what this path did NOT do — identical rows never imply identical
   * guarantees.
   */
  runner?: { runner: string; capabilities?: { parse: boolean; validateDoD: boolean; iterate: boolean } }
}

/**
 * Rows for one loaded page.
 *
 * Timing is attached from the step the row belongs to, and only once that step
 * has ended: a row inside a running step reports its step as running and
 * carries no duration, because none has been measured yet.
 */
export function projectTrajectory(page: TurnRecordPage): TrajectoryView {
  const record: TurnRecord = { version: 1, entries: page.entries }
  const steps = stepTimings(record)
  const byStep = new Map(steps.map((timing) => [`${timing.turn}:${timing.step}`, timing]))
  const stepOf = new Map(page.entries.map((entry) => [entry.seq, entry.step]))
  const rows = projectConversationRows(record).map((row) => {
    const step = stepOf.get(row.seq) ?? 0
    const timing = byStep.get(`${row.turn}:${step}`)
    return {
      ...row,
      step,
      ...(timing && !timing.running ? { timing } : {}),
    }
  })
  const runner = recordRunnerDeclaration(record)
  return {
    rows,
    ...(runner ? { runner } : {}),
    unloadedBefore: Math.max(0, page.total - page.entries.length),
    ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
    steps,
  }
}
