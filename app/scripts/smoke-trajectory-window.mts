import { strict as assert } from 'node:assert'
import {
  anchorScrollTopAfterPrepend,
  computeTrajectoryWindow,
  EMPTY_TRAJECTORY_WINDOW_SLICE,
  TRAJECTORY_ROW_HEIGHT,
} from '../src/agent/trajectoryWindow.ts'

/**
 * Seam: the trajectory list mounts only what is visible plus overscan.
 *
 * The substantive half of «長 run 撐得住» is provable without a browser:
 * the mounted range must be a function of the viewport and overscan alone,
 * never of how many pages the user has loaded. The anchor compensation keeps
 * the row a reader is on stationary when an older page prepends.
 */

const VIEWPORT = 600
const ROW = 30
const OVERSCAN = 8

// --- empty ledger -----------------------------------------------------------

{
  const w = computeTrajectoryWindow({ rowCount: 0, rowHeight: ROW, overscan: OVERSCAN, scrollTop: 0, viewportHeight: VIEWPORT })
  assert.equal(w.startIndex, 0)
  assert.equal(w.endIndex, 0)
  assert.equal(w.topSpacerHeight, 0)
  assert.equal(w.bottomSpacerHeight, 0)
}

// --- fewer than one viewport: everything mounts, no spacers -----------------

{
  const w = computeTrajectoryWindow({ rowCount: 10, rowHeight: ROW, overscan: OVERSCAN, scrollTop: 0, viewportHeight: VIEWPORT })
  assert.deepEqual([w.startIndex, w.endIndex], [0, 10])
  assert.equal(w.topSpacerHeight + w.bottomSpacerHeight, 0)
}

// --- exactly one viewport ---------------------------------------------------

{
  const w = computeTrajectoryWindow({ rowCount: 20, rowHeight: ROW, overscan: OVERSCAN, scrollTop: 0, viewportHeight: VIEWPORT })
  assert.deepEqual([w.startIndex, w.endIndex], [0, 20])
}

// --- large ledger: bounded by viewport + overscan, independent of total -----

{
  const small = computeTrajectoryWindow({ rowCount: 5_000, rowHeight: ROW, overscan: OVERSCAN, scrollTop: VIEWPORT, viewportHeight: VIEWPORT })
  const huge = computeTrajectoryWindow({ rowCount: 200_000, rowHeight: ROW, overscan: OVERSCAN, scrollTop: VIEWPORT, viewportHeight: VIEWPORT })
  // Same scroll position, wildly different totals: identical mounted range.
  assert.deepEqual([small.startIndex, small.endIndex], [huge.startIndex, huge.endIndex])
  const expectedSize = Math.ceil(VIEWPORT / ROW) + 1 + OVERSCAN * 2
  assert.ok(huge.endIndex - huge.startIndex <= expectedSize, `mounted ${huge.endIndex - huge.startIndex} > bound ${expectedSize}`)
  assert.equal(huge.topSpacerHeight, huge.startIndex * ROW)
  assert.equal(huge.bottomSpacerHeight, (200_000 - huge.endIndex) * ROW)
}

// --- spacers account for every unmounted row --------------------------------

{
  const total = 1_000
  const w = computeTrajectoryWindow({ rowCount: total, rowHeight: ROW, overscan: OVERSCAN, scrollTop: 3_000, viewportHeight: VIEWPORT })
  assert.equal(w.topSpacerHeight + w.bottomSpacerHeight, (total - (w.endIndex - w.startIndex)) * ROW)
  assert.equal(w.startIndex * ROW, w.topSpacerHeight)
  assert.equal((total - w.endIndex) * ROW, w.bottomSpacerHeight)
}

// --- scroll clamping ---------------------------------------------------------

{
  const below = computeTrajectoryWindow({ rowCount: 100, rowHeight: ROW, overscan: OVERSCAN, scrollTop: -500, viewportHeight: VIEWPORT })
  assert.deepEqual([below.startIndex, below.endIndex], [0, Math.ceil(VIEWPORT / ROW) + 1 + OVERSCAN])
  const beyond = computeTrajectoryWindow({ rowCount: 100, rowHeight: ROW, overscan: OVERSCAN, scrollTop: 10_000_000, viewportHeight: VIEWPORT })
  assert.equal(beyond.endIndex, 100)
  assert.equal(beyond.bottomSpacerHeight, 0)
}

// --- degenerate inputs do not throw ------------------------------------------

{
  const w = computeTrajectoryWindow({ rowCount: 50, rowHeight: ROW, overscan: OVERSCAN, scrollTop: 120, viewportHeight: 0 })
  assert.ok(w.endIndex >= w.startIndex)
  const z = computeTrajectoryWindow({ rowCount: 50, rowHeight: 0, overscan: OVERSCAN, scrollTop: 120, viewportHeight: VIEWPORT })
  assert.ok(Number.isFinite(z.startIndex) && Number.isFinite(z.endIndex))
}

// --- prepend anchor compensation ----------------------------------------------

{
  // The reader's top-visible row sat at index 40; prepending two pages moved
  // the same seq to index 140. Everything shifts down by 100 rows.
  const shifted = anchorScrollTopAfterPrepend({ scrollTopBefore: 1_200, rowHeight: ROW, indexBefore: 40, indexAfter: 140 })
  assert.equal(shifted, 1_200 + 100 * ROW)
  // Unknown before-index (nothing was visible): leave the scroll alone.
  assert.equal(anchorScrollTopAfterPrepend({ scrollTopBefore: 1_200, rowHeight: ROW, indexBefore: null, indexAfter: 140 }), 1_200)
  // The seq vanished (defensive): leave the scroll alone rather than jump.
  assert.equal(anchorScrollTopAfterPrepend({ scrollTopBefore: 1_200, rowHeight: ROW, indexBefore: 40, indexAfter: null }), 1_200)
  // Zero-delta (a refresh, not a prepend): identity.
  assert.equal(anchorScrollTopAfterPrepend({ scrollTopBefore: 964, rowHeight: ROW, indexBefore: 12, indexAfter: 12 }), 964)
}

// --- the shared row height is a real measurement slot ------------------------

assert.ok(Number.isFinite(TRAJECTORY_ROW_HEIGHT) && TRAJECTORY_ROW_HEIGHT > 0)
assert.deepEqual(EMPTY_TRAJECTORY_WINDOW_SLICE, { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 })

console.log('smoke-trajectory-window: green')
