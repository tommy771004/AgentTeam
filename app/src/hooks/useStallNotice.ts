/**
 * Live stall detection for one run's presentation.
 *
 * The progress clock is the run activity store's `updatedAt` — every real
 * signal (event, thought, draft delta, status line) bumps it, so "no progress"
 * means exactly that: none of those fired. A 10s tick keeps the arithmetic
 * cheap; the policy lives in `agent/stallPolicy.ts`, this hook only observes
 * and formats.
 *
 * Notify-once falls out of the derivation: the notice shows whenever silence
 * crosses the budget and hides once progress pulls idle time back under half
 * of it — one continuous notice per stall episode, no repeats, no timers to
 * reset.
 */

import { useEffect, useState } from 'react'
import { useRunActivityStore } from '../store/runActivityStore'
import {
  DEFAULT_STALL_NOTIFY_MS,
  shouldEmitStallNotice,
  stallNoticeLabel,
} from '../agent/stallPolicy.ts'

export type StallNoticeState = {
  /** The single notice is currently showing. */
  stalled: boolean
  /** Label for the notice; empty when not stalled. */
  label: string
  idleMs: number
}

const TICK_MS = 10_000

export function useStallNotice(
  runId: string | null | undefined,
  options?: { timeoutMs?: number },
): StallNoticeState {
  const active = useRunActivityStore((s) => (runId ? s.presentations[runId]?.active === true : false))
  const updatedAt = useRunActivityStore((s) => (runId ? s.presentations[runId]?.updatedAt ?? 0 : 0))
  const timeoutMs = options?.timeoutMs ?? DEFAULT_STALL_NOTIFY_MS

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  // A terminal/idle presentation has nothing to warn about.
  if (!runId || !active || !updatedAt) {
    return { stalled: false, label: '', idleMs: 0 }
  }

  const idleMs = Math.max(0, now - updatedAt)
  const stalled = shouldEmitStallNotice({
    timeoutMs,
    idleMs,
    runActive: active,
    alreadyNotified: false,
  })

  return stalled
    ? { stalled: true, label: stallNoticeLabel(idleMs), idleMs }
    : { stalled: false, label: '', idleMs }
}
