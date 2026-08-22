import { useEffect, useMemo, useRef, useState } from 'react'
import type { SubDesignArtifact } from '../../agent/subdesign/types'
import type { SubDesignPinnedComment } from '../../agent/subdesign/pinnedComments.ts'
import { parsePinnedCommentPayload } from '../../agent/subdesign/pinnedComments.ts'
import { useProjectStore } from '../../store/projectStore'
import { useSubDesignPinnedCommentsStore } from '../../store/subDesignPinnedCommentsStore'
import { Icon } from '../Icon'
import type { StreamingEnvelope } from '../../agent/subdesign/streamingEnvelope.ts'
import { canRender as canRenderStreaming, reconcileUpdates } from '../../agent/subdesign/streamingEnvelope.ts'
import { ARTIFACT_RENDERER_CAPABILITIES, withPreviewCsp } from '../../agent/subdesign/artifactRendererCapabilities.ts'

/**
 * Pin 模式的唯讀擷取腳本：注入 sandboxed iframe，點擊時把 selector 路徑與
 * 文字 sample postMessage 給 host。iframe 內容不可信——host 端還會再做
 * schema validation，這裡只負責「指」的動作。
 */
const PIN_CAPTURE_SCRIPT = `<script>(function(){
  var enabled=false;
  window.addEventListener('message',function(event){
    if(event&&event.data&&event.data.type==='subdesign-pin-mode'){enabled=event.data.enabled===true}
  });
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

export function ArtifactPreview({
  artifact,
  mode = 'preview',
  envelope,
  onSubmitPinnedComments,
}: {
  artifact: SubDesignArtifact | null
  mode?: 'preview' | 'source'
  envelope?: StreamingEnvelope | null
  /** Pin 模式送出：由 ProjectStudio 接到 workspaceController.submitPinnedComments。 */
  onSubmitPinnedComments?: (pins: SubDesignPinnedComment[]) => Promise<boolean>
}) {
  const projectRoot = useProjectStore((state) => state.root)
  const pinnedComments = useSubDesignPinnedCommentsStore()
  const deckContainerRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deckScale, setDeckScale] = useState(1)
  const [pinMode, setPinMode] = useState(false)
  const [submittingPins, setSubmittingPins] = useState(false)

  const artifactId = artifact?.id || ''
  const draftPins = artifactId ? pinnedComments.draftByArtifactId[artifactId] || [] : []

  // Host 端接收 iframe 的 pin 點擊；payload 在 submit 前還會再過一次 schema validation。
  useEffect(() => {
    if (!artifactId) return
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; selector?: unknown; text?: unknown; region?: unknown } | null
      if (!data || data.type !== 'subdesign-pin') return
      const parse = parsePinnedCommentPayload({ pins: [{ selector: data.selector, text: data.text, region: data.region }] })
      if (!parse.ok) return
      pinnedComments.addDraft(artifactId, parse.pins[0])
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [artifactId, pinnedComments])

  const submitPins = async () => {
    if (!artifactId || !draftPins.length || !onSubmitPinnedComments) return
    setSubmittingPins(true)
    try {
      const ok = await onSubmitPinnedComments(draftPins)
      if (ok) {
        pinnedComments.clearDrafts(artifactId)
        setPinMode(false)
      }
    } finally {
      setSubmittingPins(false)
    }
  }

  // Streaming envelope is the secondary source — manifest remains canonical
  const streamContent = useMemo(() => {
    if (!envelope) return ''
    const reconciled = reconcileUpdates(envelope.updates)
    return reconciled.map((update) => update.content || '').join('')
  }, [envelope])

  // Renderer capability gate — unsupported streaming is rejected before render
  const streamingGate: { ok: true } | { ok: false; reason: string } = (() => {
    if (!envelope || !artifact) return { ok: true as const }
    const caps = ARTIFACT_RENDERER_CAPABILITIES[artifact.renderer]
    if (!caps) return { ok: false as const, reason: '未知 renderer' }
    return canRenderStreaming(caps, envelope)
  })()

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
    if (streamingGate.ok && streamContent) {
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
  }, [artifact, projectRoot, streamContent, streamingGate.ok])

  // Content is visible by default — never gate on entrance animation (opacity 0)
  const displayContent = streamingGate.ok && streamContent ? streamContent : content
  const statusBadge = (() => {
    if (!envelope) return artifact ? 'complete' : null
    return envelope.status
  })()

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
              onClick={() => setPinMode((current) => !current)}
              className={`inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[9px] font-semibold transition-colors ${pinMode ? 'bg-primary/15 text-primary' : 'border border-white/10 text-outline hover:text-on-surface'}`}
            >
              <Icon name="push_pin" size={12} />{pinMode ? '點擊元素加 pin…' : 'Pin 修正'}
            </button>
          ) : null}
        </div>
      </div>
      {pinMode && draftPins.length ? (
        <div className="border-b border-white/[0.06] bg-primary/[0.04] px-4 py-2">
          <p className="text-[9px] font-semibold text-outline">即將送出的 scoped 修正（{draftPins.length}）</p>
          <ul className="mt-1 flex flex-col gap-1">
            {draftPins.map((pin, index) => (
              <li key={`${pin.selector}-${index}`} className="flex min-w-0 items-center gap-2 text-[10px]">
                <span className="truncate font-mono text-accent-ink">{pin.selector}</span>
                <span className="min-w-0 truncate text-on-surface-variant">{pin.text}</span>
                <button type="button" aria-label={`移除 pin ${index + 1}`} onClick={() => pinnedComments.clearDrafts(artifactId)} className="ml-auto shrink-0 text-[9px] text-error hover:underline">全部清除</button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={submittingPins}
            onClick={() => void submitPins()}
            className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-45"
          >
            <Icon name={submittingPins ? 'progress_activity' : 'send'} size={12} className={submittingPins ? 'animate-spin' : ''} />
            {submittingPins ? '送出中…' : '送出修正（單次 runTask）'}
          </button>
        </div>
      ) : null}
      {!artifact ? <div className="grid min-h-[380px] place-items-center px-4 text-center text-[12px] text-outline">選擇一個 artifact 查看安全 preview。</div> : null}
      {streamingGate && 'ok' in streamingGate && !streamingGate.ok ? (
        <div className="m-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[12px] text-amber-700">
          {streamingGate.reason} — 已顯示靜態備援預覽。
        </div>
      ) : null}
      {envelope && envelope.status === 'error' ? <div className="m-4 rounded-xl border border-error/30 bg-error/10 px-3 py-3 text-[12px] text-error">{envelope.error || '串流失敗'}</div> : null}
      {loading ? <div className="grid min-h-[500px] place-items-center text-[11px] text-outline">讀取 artifact…</div> : null}
      {error ? <div className="m-4 rounded-xl border border-error/30 bg-error/10 px-3 py-3 text-[12px] text-error">{error}</div> : null}
      {!loading && !error && artifact && displayContent ? (
        mode === 'source' ? (
          <pre className="max-h-[680px] min-h-[500px] overflow-auto whitespace-pre-wrap break-words bg-surface-container-lowest p-4 font-mono text-[11px] leading-relaxed text-on-surface-variant custom-scrollbar">{displayContent}</pre>
        ) : artifact.renderer === 'deck-html' ? (
          <div ref={deckContainerRef} className="w-full overflow-hidden bg-black" style={{ height: `${900 * deckScale}px` }}>
            <iframe
              title={`${artifact.title} preview`}
              sandbox="allow-scripts"
              srcDoc={pinMode ? withPinCapture(withPreviewCsp(displayContent, artifact.renderer)) : withPreviewCsp(displayContent, artifact.renderer)}
              className="block h-[900px] w-[1600px] origin-top-left border-0 bg-white"
              style={{ transform: `scale(${deckScale})` }}
            />
          </div>
        ) : artifact.renderer === 'html' ? (
          <div ref={deckContainerRef}>
            <iframe title={`${artifact.title} preview`} sandbox="allow-scripts" srcDoc={pinMode ? withPinCapture(withPreviewCsp(displayContent, artifact.renderer)) : withPreviewCsp(displayContent, artifact.renderer)} className="h-[min(54vh,560px)] min-h-[460px] w-full border-0 bg-white" />
          </div>
        ) : (
          <pre className="m-4 max-h-[620px] min-h-[460px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-container-lowest p-3 text-[12px] leading-relaxed text-on-surface-variant">{displayContent}</pre>
        )
      ) : null}
    </section>
  )
}
