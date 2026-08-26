/**
 * Windowing math for the trajectory list — the «只掛可見範圍» half of walking
 * back through a long run, as a pure function so every boundary is provable
 * without a browser.
 *
 * Two questions live here and nowhere else:
 * 1. Which rows should be mounted right now? A function of the viewport,
 *    overscan and scroll position alone — never of how many pages the user
 *    has loaded. That independence is what bounds a long run's DOM.
 * 2. Where does the scroll position go when an older page prepends? The row
 *    a reader is on must stay where it was; identity (`seq`) resolves the
 *    same row before and after the merge, the index delta times the row
 *    height is the whole compensation.
 *
 * Known simplification, deliberate: the model treats scroller content as
 * exactly `rowCount × rowHeight`, ignoring non-row siblings (the load-older
 * button, error rows). Their height only skews the maxScroll clamp slightly —
 * the clamp errs toward showing more, never loses rows — and bottomSpacer is
 * zero precisely where those elements sit. Variable heights would reopen the
 * measurement pass.
 */

/** Single-line truncated rows render at one height today. The measurement
 * pass in trajectory-review-closure owns this number; variable heights would
 * reopen it. */
export const TRAJECTORY_ROW_HEIGHT = 30

export type TrajectoryWindowInput = {
  rowCount: number
  rowHeight: number
  overscan: number
  scrollTop: number
  viewportHeight: number
}

export type TrajectoryWindowSlice = {
  /** Inclusive index of the first mounted row. */
  startIndex: number
  /** Exclusive index one past the last mounted row. */
  endIndex: number
  topSpacerHeight: number
  bottomSpacerHeight: number
}

export function computeTrajectoryWindow(input: TrajectoryWindowInput): TrajectoryWindowSlice {
  const rowCount = Number.isFinite(input.rowCount) ? Math.max(0, Math.floor(input.rowCount)) : 0
  const overscan = Number.isFinite(input.overscan) ? Math.max(0, Math.floor(input.overscan)) : 0
  const rowHeight = Number.isFinite(input.rowHeight) ? Math.max(0, input.rowHeight) : 0
  const viewportHeight = Number.isFinite(input.viewportHeight) ? Math.max(0, input.viewportHeight) : 0

  if (rowCount === 0) {
    return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 }
  }
  // Zero-height rows all fit by construction; mounting them all is honest.
  if (!(rowHeight > 0)) {
    return { startIndex: 0, endIndex: rowCount, topSpacerHeight: 0, bottomSpacerHeight: 0 }
  }

  const totalHeight = rowCount * rowHeight
  const maxScroll = Math.max(0, totalHeight - viewportHeight)
  const scrollTop = Math.min(Math.max(0, input.scrollTop), maxScroll)

  const firstVisible = Math.floor(scrollTop / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + 1

  const startIndex = Math.max(0, firstVisible - overscan)
  const endIndex = Math.min(rowCount, firstVisible + visibleCount + overscan)

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: (rowCount - endIndex) * rowHeight,
  }
}

export type TrajectoryPrependAnchorInput = {
  scrollTopBefore: number
  rowHeight: number
  /** Index of the reader's top-visible row before the merge; null when nothing was visible. */
  indexBefore: number | null
  /** Index of that SAME row after the merge; null when it cannot be found. */
  indexAfter: number | null
}

/** Scroll position that keeps the reader's row stationary across a prepend.
 * Either index unknown means «no information» — leave the scroll alone rather
 * than guess a jump. */
export function anchorScrollTopAfterPrepend(input: TrajectoryPrependAnchorInput): number {
  const { scrollTopBefore, indexBefore, indexAfter } = input
  if (indexBefore === null || indexAfter === null || !Number.isFinite(input.rowHeight)) {
    return scrollTopBefore
  }
  return scrollTopBefore + (indexAfter - indexBefore) * Math.max(0, input.rowHeight)
}
