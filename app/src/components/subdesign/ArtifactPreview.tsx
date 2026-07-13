import { useEffect, useState } from 'react'
import type { SubDesignArtifact } from '../../agent/subdesign/types'
import { useProjectStore } from '../../store/projectStore'
import { Icon } from '../Icon'

function withPreviewCsp(content: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`
  if (/<head[^>]*>/i.test(content)) return content.replace(/<head[^>]*>/i, (head) => `${head}${csp}`)
  return `<!doctype html><html><head>${csp}</head><body>${content}</body></html>`
}

export function ArtifactPreview({ artifact }: { artifact: SubDesignArtifact | null }) {
  const projectRoot = useProjectStore((state) => state.root)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!artifact) {
      setContent('')
      setError(null)
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
  }, [artifact, projectRoot])

  return (
    <section className="app-panel min-h-[260px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3"><div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="preview" size={16} className="text-primary" /><span className="truncate">{artifact?.title || 'Artifact preview'}</span></div>{artifact ? <span className="text-[11px] text-outline">sandboxed · revision {artifact.revision}</span> : null}</div>
      {!artifact ? <div className="grid min-h-[220px] place-items-center px-4 text-center text-[12px] text-outline">選擇一個 artifact 查看安全 preview。</div> : null}
      {loading ? <div className="grid min-h-[220px] place-items-center text-[12px] text-outline">讀取 artifact…</div> : null}
      {error ? <div className="m-4 rounded-xl border border-error/30 bg-error/10 px-3 py-3 text-[12px] text-error">{error}</div> : null}
      {!loading && !error && artifact && content ? (
        artifact.renderer === 'html' || artifact.renderer === 'deck-html' ? (
          <iframe title={`${artifact.title} preview`} sandbox="allow-scripts" srcDoc={withPreviewCsp(content)} className="h-[360px] w-full border-0 bg-white" />
        ) : (
          <pre className="m-4 max-h-[340px] overflow-auto whitespace-pre-wrap rounded-xl bg-surface-container-lowest p-3 text-[12px] leading-relaxed text-on-surface-variant">{content}</pre>
        )
      ) : null}
    </section>
  )
}
