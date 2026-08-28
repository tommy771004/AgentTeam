import { useEffect, useMemo, useState } from 'react'
import { projectLiveTimeline } from '../agent/liveTimeline'
import type { TurnRecordEntry } from '../agent/turnRecord'

/** Visible Turn Record paging behind one small Interface for the run feed. */
export function useRunTimelinePaging(runId: string, tail: readonly TurnRecordEntry[], total: number) {
  const [older, setOlder] = useState<TurnRecordEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setOlder([])
    setLoading(false)
    setError('')
  }, [runId])

  const entries = useMemo(() => {
    const bySeq = new Map<number, TurnRecordEntry>()
    for (const entry of older) bySeq.set(entry.seq, entry)
    for (const entry of tail) bySeq.set(entry.seq, entry)
    return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
  }, [older, tail])
  const view = useMemo(
    () => projectLiveTimeline(entries, total, Math.max(entries.length, 1)),
    [entries, total],
  )

  const loadOlder = async () => {
    const attach = window.subagents?.piHost?.runs?.attach
    const before = entries[0]?.seq
    if (typeof attach !== 'function' || before === undefined || loading) return
    setLoading(true)
    setError('')
    try {
      const { page } = await attach(runId, before, 128)
      setOlder((current) => {
        const bySeq = new Map(current.map((entry) => [entry.seq, entry]))
        for (const entry of page?.entries || []) bySeq.set(entry.seq, entry)
        return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '讀取較早記錄失敗')
    } finally {
      setLoading(false)
    }
  }

  return { view, loading, error, loadOlder }
}
