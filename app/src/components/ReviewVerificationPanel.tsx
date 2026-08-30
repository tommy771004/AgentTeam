import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { ReviewVerificationKind, ReviewVerificationProjection } from '../agent/reviewVerificationContract.ts'

const STATUS_LABEL = { passed: '通過', failed: '失敗', 'not-run': '未執行', stale: '已過期' } as const
const KIND_LABEL = { build: 'Build', smoke: 'Smoke', test: 'Test' } as const

function decodeOutput(base64: string): string {
  const binary = atob(base64)
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

export function ReviewVerificationPanel({ snapshotId }: { snapshotId: string }) {
  const [records, setRecords] = useState<ReviewVerificationProjection[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<ReviewVerificationKind>()
  const [error, setError] = useState('')
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const bridge = window.subagents?.piHost?.review

  const load = useCallback(async () => {
    if (!bridge?.listVerifications) { setError('此環境沒有 Host verification records。'); setLoading(false); return }
    try { setRecords((await bridge.listVerifications(snapshotId)).reviewVerifications); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '驗證記錄載入失敗。') }
    finally { setLoading(false) }
  }, [bridge, snapshotId])

  useEffect(() => { void load() }, [load])

  const run = async (kind: ReviewVerificationKind) => {
    if (!bridge?.runVerification) return
    setRunning(kind); setError('')
    try { await bridge.runVerification(snapshotId, kind); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '驗證執行失敗。') }
    finally { setRunning(undefined) }
  }

  const toggleOutput = async (record: ReviewVerificationProjection) => {
    if (!record.outputRef || !bridge?.readVerificationOutput) return
    if (outputs[record.id] !== undefined) { setOutputs((value) => { const next = { ...value }; delete next[record.id]; return next }); return }
    try {
      const page = (await bridge.readVerificationOutput({ outputRef: record.outputRef, maxBytes: 64 * 1024 })).reviewVerificationOutput
      setOutputs((value) => ({ ...value, [record.id]: decodeOutput(page.contentBase64) + (page.nextOffset === undefined ? '' : '\n…輸出已截斷，請在終端機查看完整記錄。') }))
    } catch { setOutputs((value) => ({ ...value, [record.id]: '輸出內容已遺失。' })) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-[13px] font-semibold">Revision 驗證</h2><p className="mt-0.5 text-[11px] text-ink-3">只有 Host 實際執行的結果會計入；程式碼變更後舊結果自動過期。</p></div>
          <button type="button" onClick={() => void load()} className="rounded-control p-2 text-ink-3 hover:bg-hover-2 hover:text-ink" aria-label="重新載入驗證記錄"><Icon name="refresh" size={16} /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['build', 'smoke', 'test'] as const).map((kind) => <button key={kind} type="button" disabled={Boolean(running)} onClick={() => void run(kind)} className="rounded-control border border-line px-3 py-1.5 text-[11px] font-medium text-ink-2 hover:bg-hover-2 disabled:opacity-50">{running === kind ? '執行中…' : `執行 ${KIND_LABEL[kind]}`}</button>)}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">
        {error ? <p role="alert" className="mb-3 text-[12px] text-danger">{error}</p> : null}
        {loading ? <p role="status" className="text-[12px] text-ink-3">載入驗證記錄…</p> : records.length === 0 ? <div className="py-10 text-center"><Icon name="fact_check" size={24} className="mx-auto text-ink-3" /><p className="mt-3 text-[13px] text-ink-2">此 revision 尚未執行驗證。</p></div> : (
          <ol className="divide-y divide-line border-y border-line">
            {records.map((record) => <li key={record.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="font-[family-name:var(--font-mono)] text-[12px] text-ink">{record.command} {record.args.join(' ')}</p><p className="mt-1 text-[10px] text-ink-3">{record.runner} · exit {record.exitCode ?? '—'} · {(record.durationMs / 1000).toFixed(1)}s · rev {record.verifiedRevision.slice(0, 10)}</p></div>
                <span data-verification-status={record.status} className={`shrink-0 text-[11px] font-semibold ${record.status === 'passed' ? 'text-success' : record.status === 'failed' ? 'text-danger' : 'text-ink-3'}`}>{STATUS_LABEL[record.status]}</span>
              </div>
              {record.detail ? <p className="mt-2 text-[11px] text-ink-3">{record.detail}</p> : null}
              <div className="mt-2 flex gap-3 text-[11px]"><button type="button" onClick={() => void run(record.kind)} className="text-accent-ink hover:underline">重試</button>{record.outputRef ? <button type="button" onClick={() => void toggleOutput(record)} className="text-accent-ink hover:underline">{outputs[record.id] === undefined ? '展開輸出' : '收合輸出'}</button> : <span className="text-ink-3">輸出不可用</span>}</div>
              {outputs[record.id] !== undefined ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap bg-inset p-3 text-[10px] leading-relaxed text-ink-2">{outputs[record.id]}</pre> : null}
            </li>)}
          </ol>
        )}
      </div>
    </div>
  )
}
