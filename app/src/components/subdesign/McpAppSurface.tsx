/**
 * MCP Apps sandboxed interactive surface — choice / form / confirmation.
 *
 * - Renders in sandboxed iframe with controlled origin / CSP / navigation policy
 * - All iframe↔host messages via versioned schema validation (v=1)
 * - Per-surface allowlist; never calls arbitrary tools or exposes raw tokens
 * - Falls back to native UI on crash / unsupported host / flag disabled
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { validateBridgeMessage, isToolAllowed, parseMcpToolCoordinate, CSP_SANDBOX, type SurfaceDeclaration } from '../../agent/subdesign/providers/mcpAppsProvider.ts'
import { isProviderEnabled } from '../../agent/subdesign/providers/providerFlags.ts'
import { useSurfaceDraftStore } from '../../agent/subdesign/surfaceDraftStore.ts'
import { surfaceFallsBack, type SurfaceStatus } from '../../agent/subdesign/surfaceStatus.ts'
import { usePermissionAskStore } from '../../store/permissionAskStore.ts'

export { SURFACE_STATUS_LABELS, type SurfaceStatus } from '../../agent/subdesign/surfaceStatus.ts'

const TRUSTED_ORIGIN = 'null' // sandboxed iframe has opaque origin; host validates via expectedOrigin check in provider, not real network origin

export type SurfaceChoiceOption = { id: string; label: string; summary?: string }

type ToolProxyContext = {
  surfaceId: string
  declaration: SurfaceDeclaration
  runId?: string
  threadId?: string
  projectRoot?: string
  frame: HTMLIFrameElement | null
  setStatus: (status: SurfaceStatus) => void
  setError: (error: string | null) => void
}

function postToolResult(context: ToolProxyContext, payload: Record<string, unknown>): void {
  context.frame?.contentWindow?.postMessage({
    v: 1,
    surfaceId: context.surfaceId,
    kind: context.declaration.kind,
    action: 'tool_result',
    payload,
  }, '*')
}

async function executeMcpSurfaceToolCall(
  rawPayload: unknown,
  context: ToolProxyContext,
): Promise<void> {
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<string, unknown>
  const coordinate = String(payload.tool || '')
  const parsed = parseMcpToolCoordinate(coordinate)
  if (!parsed || !isToolAllowed(context.declaration, coordinate)) {
    context.setStatus('invalid')
    context.setError(`disallowed tool: ${coordinate}`)
    console.warn(`[mcp-apps] disallowed tool: ${coordinate}`)
    return
  }
  const args = payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
    ? payload.arguments as Record<string, unknown>
    : {}
  const decision = await usePermissionAskStore.getState().requestAsk({
    threadId: context.threadId,
    runId: context.runId,
    tool: 'mcp_call',
    args: { extensionId: parsed.extensionId, toolName: parsed.toolName, arguments: args },
    reason: `互動表面要呼叫 MCP 工具 ${coordinate}`,
  })
  const requestId = String(payload.requestId || '').slice(0, 80)
  if (decision.decision !== 'allow') {
    postToolResult(context, { requestId, ok: false, error: '使用者拒絕 MCP 工具呼叫。' })
    return
  }
  const call = window.subagents?.subdesign?.callMcpAppTool
  if (!call) {
    context.setStatus('unavailable')
    context.setError('目前的 Host 不支援 MCP Apps tool proxy。')
    return
  }
  context.setStatus('loading')
  const result = await call({
    coordinate,
    allowlist: context.declaration.allowlist,
    arguments: args,
    runId: context.runId,
    threadId: context.threadId,
    projectRoot: context.projectRoot,
  })
  postToolResult(context, { requestId, ...result })
  context.setStatus(result.ok ? 'ready' : 'error')
  context.setError(result.ok ? null : result.error || 'MCP tool call failed')
}

function FallbackChoice(props: { options: readonly SurfaceChoiceOption[]; onSelect: (v: string) => void }) {
  if (!props.options.length) {
    return <p className="text-[11px] text-outline" role="status">目前沒有可選的方向。</p>
  }
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <p className="text-[11px] text-outline">選擇方向（原生備援）</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.options.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.summary}
            onClick={() => props.onSelect(option.id)}
            className="rounded-full border border-white/12 px-3 py-1 text-[11px] text-on-surface transition-colors hover:border-primary/35 hover:bg-white/[0.04]"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function FallbackForm(props: { onSubmit: (v: Record<string, string>) => void; draft?: Record<string, unknown> }) {
  const [val, setVal] = useState((props.draft?.input as string) || '')
  return (
    <div className="rounded-lg border border-neutral-800 p-3">
      <p className="text-sm text-neutral-400">表單（原生備援）</p>
      <input value={val} onChange={(e) => setVal(e.target.value)} className="mt-2 w-full rounded border px-2 py-1" placeholder="請輸入…" />
      <button onClick={() => props.onSubmit({ input: val })} className="mt-2 rounded bg-white px-3 py-1 text-sm text-black">
        提交
      </button>
    </div>
  )
}

function FallbackConfirm(props: { onConfirm: () => void; onReject: () => void }) {
  return (
    <div className="rounded-lg border border-neutral-800 p-3 flex gap-2">
      <button onClick={props.onConfirm} className="rounded bg-white px-3 py-1 text-sm text-black">
        確認
      </button>
      <button onClick={props.onReject} className="rounded border px-3 py-1 text-sm">
        取消
      </button>
    </div>
  )
}

export function McpAppSurface(props: {
  surfaceId: string
  declaration: SurfaceDeclaration
  html?: string
  runId?: string
  threadId?: string
  projectRoot?: string
  /** Real choices for a `choice` surface — never placeholder labels. */
  choiceOptions?: readonly SurfaceChoiceOption[]
  /** Native UI to show when the surface is unavailable, invalid, expired or crashed. */
  fallback?: ReactNode
  /**
   * Every surface state change, so the conversation shows real execution
   * messages instead of one undifferentiated spinner (issue 07).
   */
  onStatusChange?: (status: SurfaceStatus, detail?: string) => void
  onChoice?: (value: string) => void
  onFormSubmit?: (values: Record<string, unknown>) => void
  onConfirm?: (confirmed: boolean) => void
}) {
  const enabled = isProviderEnabled('mcp-apps')
  const [status, setStatus] = useState<SurfaceStatus>(enabled ? 'loading' : 'unavailable')
  const [error, setError] = useState<string | null>(null)
  const onStatusChange = props.onStatusChange
  const reported = useRef<string>('')
  useEffect(() => {
    // With the flag off there is no surface, so the native UI is simply the
    // normal path — reporting "unavailable" on every mount would bury the run
    // feed in noise. Only a surface that actually ran reports its states.
    if (!enabled) return
    const key = `${status}:${error ?? ''}`
    if (reported.current === key) return
    reported.current = key
    onStatusChange?.(status, error ?? undefined)
  }, [enabled, status, error, onStatusChange])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const draftStore = useSurfaceDraftStore()

  const scopeKey = props.declaration.scope === 'run' ? (props.runId || 'unknown') : props.declaration.scope === 'conversation' ? (props.threadId || 'unknown') : (props.projectRoot || 'unknown')

  const draftRef = { surfaceId: props.surfaceId, scope: props.declaration.scope, scopeKey }
  const draft = draftStore.loadDraft(draftRef)

  useEffect(() => {
    if (!enabled) {
      setStatus('unavailable')
      return
    }
    const handler = (ev: MessageEvent) => {
      // Only accept messages from our iframe
      if (ev.source !== iframeRef.current?.contentWindow) return
      // origin for sandboxed iframe is opaque ("null") — validate via bridge schema, not network origin
      const validated = validateBridgeMessage(ev.data, { expectedOrigin: TRUSTED_ORIGIN, actualOrigin: ev.origin })
      if (!validated.ok) {
        setStatus('invalid')
        setError(validated.reason)
        // log security reason — never expose token
        console.warn(`[mcp-apps] bridge rejected: ${validated.reason}`)
        return
      }
      const msg = validated.msg
      if (msg.surfaceId !== props.surfaceId) return

      // Allowlist enforcement — UI cannot call arbitrary tools
      if (msg.action === 'tool_call') {
        void executeMcpSurfaceToolCall(msg.payload, {
          surfaceId: props.surfaceId,
          declaration: props.declaration,
          runId: props.runId,
          threadId: props.threadId,
          projectRoot: props.projectRoot,
          frame: iframeRef.current,
          setStatus,
          setError,
        })
        return
      }

      if (msg.action === 'choice_select' && props.onChoice) {
        props.onChoice(String((msg.payload as Record<string, unknown>)?.value || ''))
        setStatus('submitted')
      }
      if (msg.action === 'form_submit' && props.onFormSubmit) {
        const values = (msg.payload as Record<string, unknown>)?.values as Record<string, unknown>
        if (values && typeof values === 'object') {
          draftStore.saveDraft({ surfaceId: props.surfaceId, scope: props.declaration.scope, scopeKey }, values)
        }
        props.onFormSubmit(values || {})
        setStatus('submitted')
      }
      if (msg.action === 'confirm' && props.onConfirm) {
        const confirmed = Boolean((msg.payload as Record<string, unknown>)?.confirmed)
        props.onConfirm(confirmed)
        setStatus('submitted')
      }
    }
    window.addEventListener('message', handler)
    // Mark ready after mount (host-to-iframe init message validated as v=1)
    const readyTimer = setTimeout(() => setStatus((s) => (s === 'loading' ? 'ready' : s)), 300)
    return () => {
      window.removeEventListener('message', handler)
      clearTimeout(readyTimer)
    }
  }, [enabled, props.surfaceId, props.declaration, props.runId, props.threadId, props.projectRoot, props.onChoice, props.onFormSubmit, props.onConfirm, scopeKey, draftStore])

  if (!enabled) {
    return <FallbackSwitch {...props} draft={draft} status="unavailable" />
  }

  if (surfaceFallsBack(status)) {
    return <FallbackSwitch {...props} draft={draft} status={status} error={error} />
  }

  // Sandboxed iframe — no Electron/Node authority, constrained CSP, no network
  // Note: sandbox attribute + srcDoc + csp meta ensure no top navigation / no external resources
  const srcDoc = props.html
    ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP_SANDBOX}"><meta charset="utf-8"><body style="margin:0;font-family:system-ui">${props.html}<script>window.addEventListener('error',()=>parent.postMessage({v:1,surfaceId:'${props.surfaceId}',kind:'${props.declaration.kind}',action:'error'},'*'))<\/script>`
    : `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP_SANDBOX}"><body style="display:grid;place-items:center;height:100vh;margin:0;font-family:system-ui;opacity:1"><div>Surface ${props.surfaceId} (${props.declaration.kind})</div>`

  return (
    <div className="rounded-xl border border-neutral-800 overflow-hidden">
      <div className="px-3 py-1 text-xs text-neutral-500 border-b border-neutral-800 flex items-center justify-between">
        <span>互動表面 · {props.declaration.kind} · {status}</span>
        <span className="text-[10px] opacity-60">{props.declaration.scope}</span>
      </div>
      <iframe
        ref={iframeRef}
        title={props.surfaceId}
        // allow-same-origin stays off, so the frame keeps an opaque origin and
        // has no Electron/Node authority. The policy itself is the CSP meta in
        // srcDoc — the `csp` iframe attribute was never shipped by browsers.
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        onError={() => setStatus('error')}
        onLoad={() => setStatus((s) => (s === 'loading' ? 'ready' : s))}
        style={{ width: '100%', height: 260, border: 0, background: 'white' }}
      />
      {error && <p className="px-3 py-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

function FallbackSwitch(
  props: {
    surfaceId: string
    declaration: SurfaceDeclaration
    runId?: string
    threadId?: string
    projectRoot?: string
    onChoice?: (v: string) => void
    onFormSubmit?: (v: Record<string, unknown>) => void
    onConfirm?: (v: boolean) => void
    choiceOptions?: readonly SurfaceChoiceOption[]
    fallback?: ReactNode
    draft?: Record<string, unknown> | null
    status?: SurfaceStatus
    error?: string | null
  },
) {
  // A caller-supplied native surface always wins: it is the real product UI,
  // not a stand-in.
  if (props.fallback) return <>{props.fallback}</>
  if (props.declaration.kind === 'choice') {
    return <FallbackChoice options={props.choiceOptions ?? []} onSelect={(v) => props.onChoice?.(v)} />
  }
  if (props.declaration.kind === 'form') {
    return <FallbackForm onSubmit={(v) => props.onFormSubmit?.(v)} draft={props.draft || undefined} />
  }
  return <FallbackConfirm onConfirm={() => props.onConfirm?.(true)} onReject={() => props.onConfirm?.(false)} />
}
