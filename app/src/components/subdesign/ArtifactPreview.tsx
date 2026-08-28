import { useEffect, useRef, useState } from 'react'
import type { SubDesignArtifact } from '../../agent/subdesign/types'
import type { SubDesignPinnedComment } from '../../agent/subdesign/pinnedComments.ts'
import { parsePinnedCommentPayload } from '../../agent/subdesign/pinnedComments.ts'
import { useProjectStore } from '../../store/projectStore'
import { useSubDesignPinnedCommentsStore } from '../../store/subDesignPinnedCommentsStore'
import { Icon } from '../Icon'
import type { SubDesignStreamingPresentation } from '../../agent/subdesign/streamingProjection.ts'
import { withPreviewCsp } from '../../agent/subdesign/artifactRendererCapabilities.ts'

/**
 * Pin 模式的唯讀擷取腳本：注入 sandboxed iframe，點擊時把 selector 路徑與
 * 文字 sample postMessage 給 host。iframe 內容不可信——host 端還會再做
 * schema validation，這裡只負責「指」的動作。
 */
const PIN_CAPTURE_SCRIPT = `<script>(function(){
  var enabled=true;
  document.addEventListener('click',function(e){
    if(!enabled)return;
    // 只接受真實使用者點擊：頁面 script 合成的 click（dispatchEvent）isTrusted=false，
    // 無法偽造 pin。這是本向量唯一的信任錨——token 在 iframe 內對頁面不可保密。
    if(!e.isTrusted)return;
    e.preventDefault();e.stopPropagation();
    var el=e.target;var parts=[];var node=el;
    while(node&&node!==document.body&&parts.length<6){
      var seg=String(node.tagName||'').toLowerCase();
      if(!seg)break;
      if(node.id)seg+='#'+String(node.id);
      else if(typeof node.className==='string'&&node.className.trim())seg+='.'+node.className.trim().split(/\\s+/).slice(0,2).join('.');
      parts.unshift(seg);node=node.parentElement;
    }
    window.parent.postMessage({type:'subdesign-pin',selector:parts.join('>'),text:String(el.textContent||'').trim().slice(0,80),region:{x:Math.round(e.clientX||0),y:Math.round(e.clientY||0)}},'*');
  },true);
})();</script>`

function withPinCapture(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${PIN_CAPTURE_SCRIPT}</body>`)
  return `${html}${PIN_CAPTURE_SCRIPT}`
}

type PendingPinTarget = Pick<SubDesignPinnedComment, 'selector' | 'region'> & { sample: string }

function PendingPinEditor({ active, target, value, onChange, onCancel, onConfirm }: {
  active: boolean
  target: PendingPinTarget | null
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!active || !target) return null
  return (
    <form className="border-b border-white/[0.06] bg-surface-container-low px-4 py-3" onSubmit={(event) => { event.preventDefault(); onConfirm() }}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon name="push_pin" size={13} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] text-accent-ink">{target.selector}</p>
          {target.sample ? <p className="mt-0.5 truncate text-[10px] text-outline">元素文字：{target.sample}</p> : null}
        </div>
      </div>
      <label htmlFor="subdesign-pin-comment" className="mt-2 block text-[10px] font-semibold text-on-surface">留言內容</label>
      <textarea
        id="subdesign-pin-comment"
        value={value}
        maxLength={1000}
        rows={3}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        placeholder="說明這個元素要如何修改"
        className="mt-1 w-full resize-y rounded-lg border border-white/[0.1] bg-surface-container-lowest px-2.5 py-2 text-[11px] leading-relaxed text-on-surface outline-none transition-colors placeholder:text-outline/60 focus:border-primary/50"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-7 px-2 text-[10px] text-outline transition-colors hover:text-on-surface">取消</button>
        <button type="submit" disabled={!value.trim()} className="h-7 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-40">加入修正</button>
      </div>
    </form>
  )
}

function PinDraftReview({ active, pins, confirming, submitting, onClear, onReview, onBack, onSubmit }: {
  active: boolean
  pins: SubDesignPinnedComment[]
  confirming: boolean
  submitting: boolean
  onClear: () => void
  onReview: () => void
  onBack: () => void
  onSubmit: () => void
}) {
  if (!active || !pins.length) return null
  return (
    <div className="border-b border-white/[0.06] bg-primary/[0.04] px-4 py-2">
      <div className="flex items-center gap-3">
        <p className="text-[10px] font-semibold text-outline">即將送出的 scoped 修正（{pins.length}）</p>
        <button type="button" onClick={onClear} className="ml-auto text-[10px] text-error transition-colors hover:text-on-surface">清除草稿</button>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {pins.map((pin, index) => (
          <li key={`${pin.selector}-${index}`} className="flex min-w-0 items-center gap-2 text-[10px]">
            <span className="truncate font-mono text-accent-ink">{pin.selector}</span>
            <span className="min-w-0 truncate text-on-surface-variant">{pin.text}</span>
          </li>
        ))}
      </ul>
      {confirming ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="確認送出 pinned comments">
          <span className="mr-auto text-[10px] text-on-surface">確認以單次 runTask 送出這 {pins.length} 項修正？</span>
          <button type="button" disabled={submitting} onClick={onBack} className="h-7 px-2 text-[10px] text-outline transition-colors hover:text-on-surface">返回編輯</button>
          <button type="button" disabled={submitting} onClick={onSubmit} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-45">
            <Icon name={submitting ? 'progress_activity' : 'send'} size={12} className={submitting ? 'animate-spin' : ''} />
            {submitting ? '送出中…' : '確認送出'}
          </button>
        </div>
      ) : (
        <button type="button" onClick={onReview} className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90">
          <Icon name="fact_check" size={12} />檢查並送出
        </button>
      )}
    </div>
  )
}

function PinAuditHistory({ records }: { records: ReturnType<typeof useSubDesignPinnedCommentsStore.getState>['records'] }) {
  if (!records.length) return null
  return (
    <details className="border-b border-white/[0.06] px-4 py-2 text-[10px]">
      <summary className="cursor-pointer text-outline transition-colors hover:text-on-surface">最近送出的 Pin 修正（{records.length}）</summary>
      <ol className="mt-2 space-y-2">
        {records.map((record) => (
          <li key={record.id} className="text-on-surface-variant">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-outline">
              <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time>
              <span>revision {record.revision}</span>
              <span>{record.pins.length} 項</span>
            </div>
            <p className="mt-0.5 line-clamp-2">{record.pins.map((pin) => pin.text).join('；')}</p>
          </li>
        ))}
      </ol>
    </details>
  )
}

function streamDisplayContent(streaming?: SubDesignStreamingPresentation | null): string {
  return streaming && !streaming.useStaticFallback ? streaming.content : ''
}

function StreamingNotices({ streaming }: { streaming?: SubDesignStreamingPresentation | null }) {
  if (!streaming) return null
  return (
    <>
      {streaming.fallbackReason ? (
        <div className="m-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[12px] text-amber-700">
          {streaming.fallbackReason} — 已顯示靜態備援預覽。
        </div>
      ) : null}
      {streaming.status === 'error' ? <div className="m-4 rounded-xl border border-error/30 bg-error/10 px-3 py-3 text-[12px] text-error">{streaming.error || '串流失敗'}</div> : null}
    </>
  )
}

function StreamingActivity({ streaming }: { streaming?: SubDesignStreamingPresentation | null }) {
  if (!streaming?.activity.length) return null
  return (
    <details className="border-b border-white/[0.06] px-4 py-2 text-[10px]">
      <summary className="cursor-pointer text-outline transition-colors hover:text-on-surface">
        執行活動（{streaming.activity.length}）
      </summary>
      <ol className="mt-2 space-y-1.5">
        {streaming.activity.map((item) => (
          <li key={`${item.seq}:${item.kind}`} className="flex gap-2 text-on-surface-variant">
            <span className="shrink-0 text-outline">#{item.seq}</span>
            <span>{item.summary}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

export function ArtifactPreview({
  artifact,
  mode = 'preview',
  streaming,
  onSubmitPinnedComments,
}: {
  artifact: SubDesignArtifact | null
  mode?: 'preview' | 'source'
  streaming?: SubDesignStreamingPresentation | null
  /** Pin 模式送出：由 ProjectStudio 接到 workspaceController.submitPinnedComments。 */
  onSubmitPinnedComments?: (pins: SubDesignPinnedComment[]) => Promise<{ ok: boolean; warning?: string; error?: string }>
}) {
  const projectRoot = useProjectStore((state) => state.root)
  const pinnedComments = useSubDesignPinnedCommentsStore()
  const deckContainerRef = useRef<HTMLDivElement>(null)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deckScale, setDeckScale] = useState(1)
  const [pinMode, setPinMode] = useState(false)
  const [submittingPins, setSubmittingPins] = useState(false)
  const [pendingTarget, setPendingTarget] = useState<(Pick<SubDesignPinnedComment, 'selector' | 'region'> & { sample: string }) | null>(null)
  const [pinText, setPinText] = useState('')
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [submitNotice, setSubmitNotice] = useState<{ tone: 'error' | 'notice'; text: string } | null>(null)

  const artifactId = artifact?.id || ''
  const draftPins = artifactId ? pinnedComments.draftByArtifactId[artifactId] || [] : []
  const auditRecords = artifactId ? pinnedComments.findByArtifactId(artifactId).slice(0, 3) : []

  // Host 端接收 iframe 的 pin 點擊；payload 在 submit 前還會再過一次 schema validation。
  useEffect(() => {
    if (!artifactId) return
    const handler = (event: MessageEvent) => {
      if (!previewFrameRef.current || event.source !== previewFrameRef.current.contentWindow) return
      const data = event.data as { type?: string; selector?: unknown; text?: unknown; region?: unknown } | null
      if (!data || data.type !== 'subdesign-pin') return
      const parse = parsePinnedCommentPayload({ pins: [{ selector: data.selector, text: 'pending-target', region: data.region }] })
      if (!parse.ok) return
      setPendingTarget({
        selector: parse.pins[0].selector,
        region: parse.pins[0].region,
        sample: String(data.text || '').trim().slice(0, 120),
      })
      setPinText('')
      setConfirmingSubmit(false)
      setSubmitNotice(null)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [artifactId, pinnedComments])

  const confirmPin = () => {
    if (!pendingTarget) return
    const parse = parsePinnedCommentPayload({ pins: [{ ...pendingTarget, text: pinText }] })
    if (!parse.ok) {
      setSubmitNotice({ tone: 'error', text: parse.errors.join('；') })
      return
    }
    pinnedComments.addDraft(artifactId, parse.pins[0])
    setPendingTarget(null)
    setPinText('')
    setSubmitNotice(null)
  }

  const submitPins = async () => {
    if (!artifactId || !draftPins.length || !onSubmitPinnedComments) return
    setSubmittingPins(true)
    try {
      const result = await onSubmitPinnedComments(draftPins)
      if (result.ok) {
        pinnedComments.clearDrafts(artifactId)
        setPinMode(false)
        setConfirmingSubmit(false)
        setSubmitNotice({ tone: result.warning ? 'error' : 'notice', text: result.warning || 'Pin 修正已送出。' })
      } else {
        setSubmitNotice({ tone: 'error', text: result.error || 'Pin 修正送出失敗。' })
      }
    } finally {
      setSubmittingPins(false)
    }
  }

  // Streaming envelope is the secondary source — manifest remains canonical
  const streamContent = streamDisplayContent(streaming)

  useEffect(() => {
    const container = deckContainerRef.current
    if (!container || artifact?.renderer !== 'deck-html' || mode !== 'preview') return
    const updateScale = () => setDeckScale(Math.min(1, container.clientWidth / 1600))
    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(container)
    return () => observer.disconnect()
  }, [artifact?.renderer, content, streamContent, mode])

  // Host snapshot is source of truth for recovery — envelope content is projected onto Host-stored artifact
  useEffect(() => {
    let cancelled = false
    if (!artifact) {
      setContent('')
      setError(null)
      return
    }
    // If we have a live streaming envelope, prefer its assembled content over disk read
    if (streamContent) {
      // Do not create second canonical artifact state — envelope is ephemeral projection
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const subdesignApi = window.subagents?.subdesign
        const workspaceApi = window.subagents?.tools
        const result = subdesignApi?.readArtifact
          ? await subdesignApi.readArtifact({ entry: artifact.entry, projectRoot: projectRoot || undefined })
          : workspaceApi?.workspaceRead
            ? await workspaceApi.workspaceRead(artifact.entry, projectRoot || undefined)
            : import.meta.env.DEV && artifact.entry.startsWith('/')
              ? await fetch(artifact.entry).then(async (response) => ({
                  ok: response.ok,
                  content: await response.text(),
                  error: response.ok ? undefined : `HTTP ${response.status}`,
                }))
              : { ok: false, content: '', error: 'Preview 需要 Electron artifact API。' }
        if (!result.ok) throw new Error(result.content || ('error' in result ? String(result.error || '') : '') || '讀取 artifact 失敗。')
        if (!cancelled) setContent(result.content)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [artifact, projectRoot, streamContent])

  // Content is visible by default — never gate on entrance animation (opacity 0)
  const displayContent = streamContent || content
  const statusBadge = streaming?.status || artifact?.status || null

  return (
    <section className={`${artifact?.renderer === 'deck-html' ? '' : 'min-h-[420px]'} overflow-hidden rounded-xl bg-surface-container-low/25`} aria-label={artifact?.title || 'Artifact preview'}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-semibold text-on-surface"><Icon name="preview" size={15} className="text-primary" /><span className="truncate">{artifact?.title || 'Artifact preview'}</span></div>
        <div className="flex items-center gap-2">
          {statusBadge ? <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] text-outline">{statusBadge}</span> : null}
          {artifact ? <span className="text-[9px] text-outline">sandboxed · revision {artifact.revision}</span> : null}
          {artifact && mode === 'preview' && onSubmitPinnedComments ? (
            <button
              type="button"
              aria-pressed={pinMode}
              onClick={() => {
                setPinMode((current) => !current)
                setPendingTarget(null)
                setPinText('')
                setConfirmingSubmit(false)
                setSubmitNotice(null)
              }}
              className={`inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[9px] font-semibold transition-colors ${pinMode ? 'bg-primary/15 text-primary' : 'border border-white/10 text-outline hover:text-on-surface'}`}
            >
              <Icon name="push_pin" size={12} />{pinMode ? '點擊元素加 pin…' : 'Pin 修正'}
            </button>
          ) : null}
        </div>
      </div>
      <PendingPinEditor active={pinMode} target={pendingTarget} value={pinText} onChange={setPinText} onCancel={() => { setPendingTarget(null); setPinText('') }} onConfirm={confirmPin} />
      <PinDraftReview active={pinMode} pins={draftPins} confirming={confirmingSubmit} submitting={submittingPins} onClear={() => pinnedComments.clearDrafts(artifactId)} onReview={() => setConfirmingSubmit(true)} onBack={() => setConfirmingSubmit(false)} onSubmit={() => void submitPins()} />
      {submitNotice ? <div role={submitNotice.tone === 'error' ? 'alert' : 'status'} className={`border-b border-white/[0.06] px-4 py-2 text-[10px] ${submitNotice.tone === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>{submitNotice.text}</div> : null}
      <PinAuditHistory records={auditRecords} />
      <StreamingActivity streaming={streaming} />
      {!artifact ? <div className="grid min-h-[380px] place-items-center px-4 text-center text-[12px] text-outline">選擇一個 artifact 查看安全 preview。</div> : null}
      <StreamingNotices streaming={streaming} />
      {loading ? <div className="grid min-h-[500px] place-items-center text-[11px] text-outline">讀取 artifact…</div> : null}
      {error ? <div className="m-4 rounded-xl border border-error/30 bg-error/10 px-3 py-3 text-[12px] text-error">{error}</div> : null}
      {!loading && !error && artifact && displayContent ? (
        mode === 'source' ? (
          <pre className="max-h-[680px] min-h-[500px] overflow-auto whitespace-pre-wrap break-words bg-surface-container-lowest p-4 font-mono text-[11px] leading-relaxed text-on-surface-variant custom-scrollbar">{displayContent}</pre>
        ) : artifact.renderer === 'deck-html' ? (
          <div ref={deckContainerRef} className="w-full overflow-hidden bg-black" style={{ height: `${900 * deckScale}px` }}>
            <iframe
              ref={previewFrameRef}
              title={`${artifact.title} preview`}
              sandbox="allow-scripts"
              srcDoc={pinMode ? withPinCapture(withPreviewCsp(displayContent, artifact.renderer)) : withPreviewCsp(displayContent, artifact.renderer)}
              className="block h-[900px] w-[1600px] origin-top-left border-0 bg-white"
              style={{ transform: `scale(${deckScale})` }}
            />
          </div>
        ) : artifact.renderer === 'html' ? (
          <div ref={deckContainerRef}>
            <iframe ref={previewFrameRef} title={`${artifact.title} preview`} sandbox="allow-scripts" srcDoc={pinMode ? withPinCapture(withPreviewCsp(displayContent, artifact.renderer)) : withPreviewCsp(displayContent, artifact.renderer)} className="h-[min(54vh,560px)] min-h-[460px] w-full border-0 bg-white" />
          </div>
        ) : (
          <pre className="m-4 max-h-[620px] min-h-[460px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-container-lowest p-3 text-[12px] leading-relaxed text-on-surface-variant">{displayContent}</pre>
        )
      ) : null}
    </section>
  )
}
