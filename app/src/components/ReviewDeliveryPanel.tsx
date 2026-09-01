import { useState } from 'react'
import type { ReviewTarget } from '../agent/reviewContract.ts'
import type { ReviewDeliveryIntent, ReviewDeliveryPreview, ReviewDeliveryReceipt } from '../agent/reviewDeliveryContract.ts'
import { Icon } from './Icon.tsx'

const DELIVERY_ICON_BUTTON = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line-strong text-ink-2 outline-none hover:bg-hover-2 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40'

function DeliveryPhase(props: {
  target: Extract<ReviewTarget, { kind: 'staged' }>
  busy: boolean
  message: string
  sign: boolean
  remote: string
  prTitle: string
  prBody: string
  draft: boolean
  commit?: ReviewDeliveryReceipt
  push?: ReviewDeliveryReceipt
  receipt?: ReviewDeliveryReceipt
  setMessage: (value: string) => void
  setSign: (value: boolean) => void
  setRemote: (value: string) => void
  setPrTitle: (value: string) => void
  setPrBody: (value: string) => void
  setDraft: (value: boolean) => void
  requestPreview: (intent: ReviewDeliveryIntent) => Promise<void>
}) {
  if (!props.commit?.commitOid) return <section>
    <label className="block text-[9px] text-ink-3">Commit message<textarea value={props.message} onChange={(event) => props.setMessage(event.target.value)} rows={2} className="mt-1 block w-full resize-none border border-line bg-surface p-2 text-[10px] text-ink outline-none focus:border-accent" /></label>
    <div className="mt-2 flex items-center justify-between"><label className="text-[9px] text-ink-3"><input type="checkbox" checked={props.sign} onChange={(event) => props.setSign(event.target.checked)} className="mr-1" />使用 Git signing</label><button type="button" disabled={props.busy || !props.message.trim()} onClick={() => void props.requestPreview({ kind: 'commit', workspaceId: props.target.workspaceId, expectedIndexRevision: props.target.revision, message: props.message, ...(props.sign ? { sign: true as const } : {}) })} className={DELIVERY_ICON_BUTTON} aria-label="預覽 Commit" title="預覽 Commit"><Icon name="commit" size={16} /></button></div>
  </section>
  if (!props.push?.pushId) return <section className="grid grid-cols-2 gap-2">
    <label className="text-[9px] text-ink-3">Remote<input value={props.remote} onChange={(event) => props.setRemote(event.target.value)} className="mt-1 block w-full border border-line bg-surface px-2 py-1 text-[10px] text-ink" /></label>
    <p className="self-end text-[9px] text-ink-3">目前 checkout branch；Host 會保留既有 upstream。</p>
    <p className="self-end truncate font-[family-name:var(--font-mono)] text-[9px] text-ink-3">commit {props.commit.commitOid.slice(0, 12)}</p>
    <button type="button" disabled={props.busy || !props.commit.commitId || !props.remote.trim()} onClick={() => void props.requestPreview({ kind: 'push', workspaceId: props.target.workspaceId, commitId: props.commit!.commitId!, remote: props.remote, setUpstream: true, force: false })} className={`${DELIVERY_ICON_BUTTON} justify-self-end`} aria-label="預覽 Push" title="預覽 Push"><Icon name="upload" size={16} /></button>
  </section>
  if (!props.receipt?.prUrl) return <section className="space-y-2">
    <input value={props.prTitle} onChange={(event) => props.setPrTitle(event.target.value)} placeholder="PR title" className="block w-full border border-line bg-surface px-2 py-1 text-[10px] text-ink" />
    <textarea value={props.prBody} onChange={(event) => props.setPrBody(event.target.value)} rows={2} placeholder="PR description" className="block w-full resize-none border border-line bg-surface p-2 text-[10px] text-ink" />
    <div className="flex items-center justify-between"><label className="text-[9px] text-ink-3"><input type="checkbox" checked={props.draft} onChange={(event) => props.setDraft(event.target.checked)} className="mr-1" />Draft PR</label><button type="button" disabled={props.busy || !props.prTitle.trim() || !props.prBody.trim()} onClick={() => void props.requestPreview({ kind: 'pr', workspaceId: props.target.workspaceId, pushId: props.push!.pushId!, title: props.prTitle, body: props.prBody, draft: props.draft })} className={DELIVERY_ICON_BUTTON} aria-label="預覽 PR" title="預覽 PR"><Icon name="call_split" size={16} /></button></div>
  </section>
  return <a href={props.receipt.prUrl} className="text-[10px] text-accent-ink underline" target="_blank" rel="noreferrer">開啟 PR #{props.receipt.prNumber || ''}</a>
}

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
      <DeliveryPhase target={target} busy={busy} message={message} sign={sign} remote={remote} prTitle={prTitle} prBody={prBody} draft={draft} commit={commit} push={push} receipt={receipt} setMessage={setMessage} setSign={setSign} setRemote={setRemote} setPrTitle={setPrTitle} setPrBody={setPrBody} setDraft={setDraft} requestPreview={requestPreview} />

      {preview ? <section className="border border-orange/40 bg-surface p-2"><p className="text-[10px] font-semibold text-ink">{preview.title}</p><pre className="mt-1 whitespace-pre-wrap text-[9px] text-ink-3">{preview.detail}</pre><div className="mt-2 flex justify-end gap-0"><button type="button" onClick={() => setPreview(undefined)} className={DELIVERY_ICON_BUTTON} aria-label="取消 delivery" title="取消 delivery"><Icon name="close" size={16} /></button><button type="button" disabled={busy} onClick={() => void apply()} className={`${DELIVERY_ICON_BUTTON} border-orange text-orange hover:bg-orange/10`} aria-label={busy ? '正在送交核准' : '送交核准'} title={busy ? '正在送交核准' : '送交核准'}><Icon name={busy ? 'progress_activity' : 'approval'} size={16} className={busy ? 'animate-spin motion-reduce:animate-none' : undefined} /></button></div></section> : null}
      {error ? <p role="alert" className="whitespace-pre-wrap text-[9px] text-red">{error}</p> : null}
      {receipt?.status === 'applied' ? <div className="flex items-center justify-between gap-2 text-[9px] text-green"><p>{receipt.kind} 完成{receipt.commitOid ? ` · ${receipt.commitOid.slice(0, 12)}` : ''}</p>{commit?.workingRevision ? <button type="button" onClick={() => onOpenTarget?.({ kind: 'live-working-tree', workspaceId: target.workspaceId, revision: commit.workingRevision! }, 'Live working tree · committed')} className={`${DELIVERY_ICON_BUTTON} border-0 text-accent-ink`} aria-label="檢視剩餘變更" title="檢視剩餘變更"><Icon name="difference" size={16} /></button> : null}</div> : null}
    </div>
  </details>
}
