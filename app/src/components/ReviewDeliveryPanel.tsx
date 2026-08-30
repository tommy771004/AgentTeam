import { useState } from 'react'
import type { ReviewTarget } from '../agent/reviewContract.ts'
import type { ReviewDeliveryIntent, ReviewDeliveryPreview, ReviewDeliveryReceipt } from '../agent/reviewDeliveryContract.ts'

export function ReviewDeliveryPanel({ target, onOpenTarget }: {
  target: Extract<ReviewTarget, { kind: 'staged' }>
  onOpenTarget?: (target: ReviewTarget, title?: string) => void
}) {
  const [message, setMessage] = useState('')
  const [sign, setSign] = useState(false)
  const [remote, setRemote] = useState('origin')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [draft, setDraft] = useState(true)
  const [preview, setPreview] = useState<ReviewDeliveryPreview>()
  const [commit, setCommit] = useState<ReviewDeliveryReceipt>()
  const [push, setPush] = useState<ReviewDeliveryReceipt>()
  const [receipt, setReceipt] = useState<ReviewDeliveryReceipt>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bridge = window.subagents?.piHost?.review

  const requestPreview = async (intent: ReviewDeliveryIntent) => {
    if (!bridge?.previewDelivery) { setError('此環境沒有 Host Git delivery workflow。'); return }
    setBusy(true); setError(''); setReceipt(undefined)
    try { setPreview((await bridge.previewDelivery(intent)).reviewDeliveryPreview) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const apply = async () => {
    if (!preview || !bridge?.applyDelivery) return
    setBusy(true); setError('')
    try {
      const next = (await bridge.applyDelivery(preview.id)).reviewDeliveryReceipt
      setPreview(undefined); setReceipt(next)
      if (next.status === 'failed') { setError(`${next.code || 'unknown'}：${next.detail || 'Delivery failed'}`); return }
      if (next.status !== 'applied') return
      if (next.kind === 'commit') {
        setCommit(next)
      } else if (next.kind === 'push') setPush(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return <details className="shrink-0 border-t border-line bg-surface-container-low">
    <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-ink-2">Git delivery · Commit → Push → PR</summary>
    <div className="space-y-3 border-t border-line p-3">
      {!commit?.commitOid ? <section>
        <label className="block text-[9px] text-ink-3">Commit message<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} className="mt-1 block w-full resize-none border border-line bg-surface p-2 text-[10px] text-ink outline-none focus:border-accent" /></label>
        <div className="mt-2 flex items-center justify-between"><label className="text-[9px] text-ink-3"><input type="checkbox" checked={sign} onChange={(event) => setSign(event.target.checked)} className="mr-1" />使用 Git signing</label><button type="button" disabled={busy || !message.trim()} onClick={() => void requestPreview({ kind: 'commit', workspaceId: target.workspaceId, expectedIndexRevision: target.revision, message, ...(sign ? { sign: true as const } : {}) })} className="border border-line-strong px-2 py-1 text-[10px] text-ink-2 disabled:opacity-40">預覽 Commit</button></div>
      </section> : !push?.pushId ? <section className="grid grid-cols-2 gap-2">
        <label className="text-[9px] text-ink-3">Remote<input value={remote} onChange={(event) => setRemote(event.target.value)} className="mt-1 block w-full border border-line bg-surface px-2 py-1 text-[10px] text-ink" /></label>
        <p className="self-end text-[9px] text-ink-3">目前 checkout branch；Host 會保留既有 upstream。</p>
        <p className="self-end truncate font-[family-name:var(--font-mono)] text-[9px] text-ink-3">commit {commit.commitOid.slice(0, 12)}</p>
        <button type="button" disabled={busy || !commit.commitId || !remote.trim()} onClick={() => void requestPreview({ kind: 'push', workspaceId: target.workspaceId, commitId: commit.commitId!, remote, setUpstream: true, force: false })} className="border border-line-strong px-2 py-1 text-[10px] text-ink-2 disabled:opacity-40">預覽 Push</button>
      </section> : !receipt?.prUrl ? <section className="space-y-2">
        <input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="PR title" className="block w-full border border-line bg-surface px-2 py-1 text-[10px] text-ink" />
        <textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} rows={2} placeholder="PR description" className="block w-full resize-none border border-line bg-surface p-2 text-[10px] text-ink" />
        <div className="flex items-center justify-between"><label className="text-[9px] text-ink-3"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} className="mr-1" />Draft PR</label><button type="button" disabled={busy || !prTitle.trim() || !prBody.trim()} onClick={() => void requestPreview({ kind: 'pr', workspaceId: target.workspaceId, pushId: push.pushId!, title: prTitle, body: prBody, draft })} className="border border-line-strong px-2 py-1 text-[10px] text-ink-2 disabled:opacity-40">預覽 PR</button></div>
      </section> : <a href={receipt.prUrl} className="text-[10px] text-accent-ink underline" target="_blank" rel="noreferrer">開啟 PR #{receipt.prNumber || ''}</a>}

      {preview ? <section className="border border-orange/40 bg-surface p-2"><p className="text-[10px] font-semibold text-ink">{preview.title}</p><pre className="mt-1 whitespace-pre-wrap text-[9px] text-ink-3">{preview.detail}</pre><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setPreview(undefined)} className="text-[9px] text-ink-3">取消</button><button type="button" disabled={busy} onClick={() => void apply()} className="border border-orange px-2 py-1 text-[9px] text-orange disabled:opacity-40">送交核准</button></div></section> : null}
      {error ? <p role="alert" className="whitespace-pre-wrap text-[9px] text-red">{error}</p> : null}
      {receipt?.status === 'applied' ? <div className="flex items-center justify-between gap-2 text-[9px] text-green"><p>{receipt.kind} 完成{receipt.commitOid ? ` · ${receipt.commitOid.slice(0, 12)}` : ''}</p>{commit?.workingRevision ? <button type="button" onClick={() => onOpenTarget?.({ kind: 'live-working-tree', workspaceId: target.workspaceId, revision: commit.workingRevision! }, 'Live working tree · committed')} className="text-accent-ink hover:underline">檢視剩餘變更</button> : null}</div> : null}
    </div>
  </details>
}
