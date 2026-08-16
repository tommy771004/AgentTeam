import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DodVerdict } from '../agent/types'
import { useThreadStore } from '../store/threadStore'

const verdicts: DodVerdict[] = [
  { iteration: 1, met: false, semantic: true, confidence: 0.4, missing: ['缺少測試'], evaluatedAt: '2026-08-16T01:00:00Z' },
  { iteration: 2, met: true, semantic: true, confidence: 0.93, missing: [], evaluatedAt: '2026-08-16T01:05:00Z' },
]

afterEach(() => {
  useThreadStore.setState({ threads: [], activeId: null })
})

describe('dodVerdicts 傳導（票 02）', () => {
  it('pushRunSummary 後 thread bubble 的 runSummary 帶 dodVerdicts', () => {
    let threadId = ''
    act(() => {
      threadId = useThreadStore.getState().createThread({ title: 'report-test' })
    })
    act(() => {
      useThreadStore.getState().pushRunSummary(threadId, {
        status: 'success',
        simulated: false,
        dodVerdicts: verdicts,
        operations: [{ id: 'op1', kind: 'status', title: '完成', ok: true }],
        files: [],
      })
    })
    const thread = useThreadStore.getState().threads.find((t) => t.id === threadId)
    const bubble = thread?.bubbles.find((b) => b.role === 'run')
    expect(bubble?.runSummary?.dodVerdicts).toEqual(verdicts)
  })

  it('未帶 verdict（CLI run）時欄位為 undefined——不補造假資料', () => {
    let threadId = ''
    act(() => {
      threadId = useThreadStore.getState().createThread({ title: 'cli-run-test' })
    })
    act(() => {
      useThreadStore.getState().pushRunSummary(threadId, {
        status: 'success',
        operations: [{ id: 'op1', kind: 'status', title: '本機 CLI 完成', ok: true }],
        files: [],
      })
    })
    const thread = useThreadStore.getState().threads.find((t) => t.id === threadId)
    const bubble = thread?.bubbles.find((b) => b.role === 'run')
    expect(bubble?.runSummary?.dodVerdicts).toBeUndefined()
  })
})
