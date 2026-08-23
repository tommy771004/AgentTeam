/**
 * Stall notification policy (item 4 — hermes `session_stall` port).
 *
 * One honest notice when a live run goes quiet; never a repeating alarm.
 * Pure-module assertions plus drift guards on the UI wiring.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DEFAULT_STALL_NOTIFY_MS,
  MAX_STALL_NOTIFY_MS,
  MIN_STALL_NOTIFY_MS,
  clampStallNotifyMs,
  shouldClearStallNotice,
  shouldEmitStallNotice,
  stallNoticeLabel,
} from '../src/agent/stallPolicy.ts'

// ── Notify-once gate set (upstream semantics) ──
const BASE = { timeoutMs: DEFAULT_STALL_NOTIFY_MS, idleMs: DEFAULT_STALL_NOTIFY_MS, runActive: true, alreadyNotified: false }
assert.ok(shouldEmitStallNotice(BASE), 'silence crossing the budget on a live run notifies')
assert.ok(!shouldEmitStallNotice({ ...BASE, alreadyNotified: true }), 'notify-once: no second notice in the same episode')
assert.ok(!shouldEmitStallNotice({ ...BASE, runActive: false }), 'a terminal/idle run cannot stall')
assert.ok(!shouldEmitStallNotice({ ...BASE, idleMs: undefined }), 'no clock yet stays silent instead of guessing')
assert.ok(!shouldEmitStallNotice({ ...BASE, timeoutMs: 0 }), 'timeout 0 disables the notice entirely')
assert.ok(!shouldEmitStallNotice({ ...BASE, idleMs: DEFAULT_STALL_NOTIFY_MS - 1 }), 'just under the budget stays quiet')

// ── Clearing re-arms the latch for a future episode ──
assert.ok(shouldClearStallNotice({ timeoutMs: DEFAULT_STALL_NOTIFY_MS, idleMs: 1_000 }), 'progress below half the budget clears')
assert.ok(!shouldClearStallNotice({ timeoutMs: DEFAULT_STALL_NOTIFY_MS, idleMs: DEFAULT_STALL_NOTIFY_MS }), 'still stalled does not clear')

// ── Bounds and copy ──
assert.equal(clampStallNotifyMs(0), DEFAULT_STALL_NOTIFY_MS)
assert.equal(clampStallNotifyMs(1_000), MIN_STALL_NOTIFY_MS)
assert.equal(clampStallNotifyMs(99 * 60_000), MAX_STALL_NOTIFY_MS)
assert.match(stallNoticeLabel(3.4 * 60_000), /3 分鐘/)
assert.match(stallNoticeLabel(30_000), /1 分鐘/, 'sub-minute idle still reads as at least one minute')

// ── Drift guards: the feed must surface the notice through the shared hook ──
const feed = await readFile(resolve(import.meta.dirname, '../src/components/RunProcessFeed.tsx'), 'utf8')
assert.match(feed, /useStallNotice\(runId\)/, 'RunProcessFeed must observe stalls via the shared hook')
assert.match(feed, /role="status"/, 'the stall notice must be announced as a status region')

const hook = await readFile(resolve(import.meta.dirname, '../src/hooks/useStallNotice.ts'), 'utf8')
assert.match(hook, /from '..\/agent\/stallPolicy\.ts'/, 'hook must reuse the pure policy, not re-derive it')
assert.doesNotMatch(hook, /notifiedRef/, 'notify-once falls out of the derivation — no render-phase mutation')

console.log('smoke-stall-policy: all assertions passed')
