/**
 * MCP Apps sandboxed interactive surface — choice / form / confirmation.
 *
 * - Renders in sandboxed iframe with controlled origin / CSP / navigation policy
 * - All iframe↔host messages via versioned schema validation (v=1)
 * - Per-surface allowlist; never calls arbitrary tools or exposes raw tokens
 * - Falls back to native UI on crash / unsupported host / flag disabled
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { validateBridgeMessage, isToolAllowed, parseMcpToolCoordinate, CSP_SANDBOX, type SurfaceDeclaration } from '../../agent/subdesign/providers/mcpAppsProvider.ts'
import { isProviderEnabled } from '../../agent/subdesign/providers/providerFlags.ts'
import { useSurfaceDraftStore } from '../../agent/subdesign/surfaceDraftStore.ts'
import { surfaceFallsBack, type SurfaceStatus } from '../../agent/subdesign/surfaceStatus.ts'
import { usePermissionAskStore } from '../../store/permissionAskStore.ts'
import {
  createHostSurfaceSessionRepository,
  createSurfaceSession,
  resolveSurfaceSessionRef,
  transitionSurfaceSession,
  type SurfaceSessionEvent,
  type SurfaceSessionSnapshot,
} from '../../agent/subdesign/surfaceSession.ts'

export { SURFACE_STATUS_LABELS, type SurfaceStatus } from '../../agent/subdesign/surfaceStatus.ts'

const TRUSTED_ORIGIN = 'null' // sandboxed iframe has opaque origin; host validates via expectedOrigin check in provider, not real network origin

export type SurfaceChoiceOption = { id: string; label: string; summary?: string }
type SubmissionResult = void | boolean | Promise<void | boolean>
export type SurfaceFallbackActions = {
  choose: (value: string) => void
  submitForm: (values: Record<string, unknown>) => void
  confirm: (confirmed: boolean) => void
}

type ToolProxyContext = {
  surfaceId: string
  surfaceToken: string | null
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

function parseSurfaceToolRequest(rawPayload: unknown, declaration: SurfaceDeclaration): {
  ok: true
  coordinate: string
  parsed: NonNullable<ReturnType<typeof parseMcpToolCoordinate>>
  arguments: Record<string, unknown>
  requestId: string
} | { ok: false; coordinate: string } {
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<string, unknown>
  const coordinate = String(payload.tool || '')
  const parsed = parseMcpToolCoordinate(coordinate)
  if (!parsed || !isToolAllowed(declaration, coordinate)) return { ok: false, coordinate }
  const arguments_ = payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
    ? payload.arguments as Record<string, unknown>
    : {}
  return {
    ok: true,
    coordinate,
    parsed,
    arguments: arguments_,
    requestId: String(payload.requestId || '').slice(0, 80),
  }
}

async function executeMcpSurfaceToolCall(
  rawPayload: unknown,
  context: ToolProxyContext,
): Promise<void> {
  const request = parseSurfaceToolRequest(rawPayload, context.declaration)
  if (!request.ok) {
    context.setStatus('invalid')
    context.setError(`disallowed tool: ${request.coordinate}`)
    console.warn(`[mcp-apps] disallowed tool: ${request.coordinate}`)
    return
  }
  const { coordinate, parsed, arguments: args, requestId } = request
  const call = window.subagents?.subdesign?.callMcpAppTool
  if (!call || !context.surfaceToken) {
    context.setStatus('unavailable')
    context.setError('目前的 Host 不支援 MCP Apps tool proxy。')
    return
  }
  context.setStatus('loading')
  const challenge = await call({
    surfaceToken: context.surfaceToken,
    coordinate,
    arguments: args,
  })
  if (!challenge.approvalRequired || !challenge.approvalToken) {
    postToolResult(context, { requestId, ...challenge })
    context.setStatus(challenge.ok ? 'ready' : 'error')
    context.setError(challenge.ok ? null : challenge.error || 'Host 未建立 MCP tool approval challenge')
    return
  }
  const decision = await usePermissionAskStore.getState().requestAsk({
    threadId: context.threadId,
    runId: context.runId,
    tool: 'mcp_call',
    args: { extensionId: parsed.extensionId, toolName: parsed.toolName, arguments: args },
    reason: `互動表面要呼叫 MCP 工具 ${coordinate}`,
  })
  const result = await call({
    surfaceToken: context.surfaceToken,
    coordinate,
    approvalToken: challenge.approvalToken,
    approvalDecision: decision.decision === 'allow' ? 'allow' : 'deny',
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
  fallback?: ReactNode | ((actions: SurfaceFallbackActions) => ReactNode)
  /**
   * Every surface state change, so the conversation shows real execution
   * messages instead of one undifferentiated spinner (issue 07).
   */
  onStatusChange?: (status: SurfaceStatus, detail?: string) => void
  onChoice?: (value: string) => SubmissionResult
  onFormSubmit?: (values: Record<string, unknown>) => SubmissionResult
  onConfirm?: (confirmed: boolean) => SubmissionResult
  expiresAt?: string
}) {
  const enabled = isProviderEnabled('mcp-apps')
  const resolution = useMemo(() => resolveSurfaceSessionRef(props.surfaceId, props.declaration, {
    runId: props.runId,
    threadId: props.threadId,
    projectRoot: props.projectRoot,
  }), [props.surfaceId, props.declaration, props.runId, props.threadId, props.projectRoot])
  const repository = useMemo(() => createHostSurfaceSessionRepository(props.projectRoot), [props.projectRoot])
  const [status, setStatus] = useState<SurfaceStatus>(enabled && resolution.ok && props.html ? 'loading' : 'unavailable')
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
  const [hostSurfaceToken, setHostSurfaceToken] = useState<string | null>(null)
  const persistenceQueue = useRef<Promise<unknown>>(Promise.resolve())
  const session = useRef<SurfaceSessionSnapshot | null>(resolution.ok
    ? createSurfaceSession(resolution.ref, props.declaration.kind, { expiresAt: props.expiresAt })
    : null)
  const drafts = useSurfaceDraftStore((state) => state.drafts)
  const saveDraft = useSurfaceDraftStore((state) => state.saveDraft)
  const clearDraft = useSurfaceDraftStore((state) => state.clearDraft)
  const draftRef = resolution.ok ? resolution.ref : null
  const draft = draftRef
    ? drafts.find((candidate) => candidate.surfaceId === draftRef.surfaceId && candidate.scope === draftRef.scope && candidate.scopeKey === draftRef.scopeKey)?.values ?? null
    : null
  const { onChoice, onConfirm, onFormSubmit } = props

  const transition = useCallback((event: SurfaceSessionEvent) => {
    const current = session.current
    if (!current) return
    const next = transitionSurfaceSession(current, event)
    session.current = next
    setStatus(next.status)
    persistenceQueue.current = persistenceQueue.current.then(() => repository.save(next))
  }, [repository])

  useEffect(() => {
    const register = window.subagents?.subdesign?.registerMcpAppSurface
    if (!enabled || !resolution.ok || !props.html || !register) {
      setHostSurfaceToken(null)
      return
    }
    let disposed = false
    let token: string | undefined
    void register({
      surfaceId: props.surfaceId,
      declaration: props.declaration,
      runId: props.runId,
      threadId: props.threadId,
      projectRoot: props.projectRoot,
      expiresAt: props.expiresAt,
    }).then((result) => {
      if (disposed) {
        if (result.token) void window.subagents?.subdesign?.unregisterMcpAppSurface?.(result.token)
        return
      }
      if (!result.ok || !result.token) {
        setError(result.error || 'Host 無法註冊 MCP App surface。')
        transition({ type: 'unavailable' })
        return
      }
      token = result.token
      setHostSurfaceToken(token)
    })
    return () => {
      disposed = true
      setHostSurfaceToken(null)
      if (token) void window.subagents?.subdesign?.unregisterMcpAppSurface?.(token)
    }
  }, [enabled, props.declaration, props.expiresAt, props.html, props.projectRoot, props.runId, props.surfaceId, props.threadId, resolution, transition])

  const submit = useCallback(async (values: Record<string, unknown>, callback?: () => SubmissionResult) => {
    if (!draftRef || !callback) return
    saveDraft(draftRef, values)
    transition({ type: 'draft', values })
    try {
      const accepted = await callback()
      if (accepted === false) return
      clearDraft(draftRef)
      transition({ type: 'submitted', values })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      transition({ type: 'error' })
    }
  }, [clearDraft, draftRef, saveDraft, transition])

  const actions = useMemo<SurfaceFallbackActions>(() => ({
    choose: (value) => { void submit({ value }, onChoice ? () => onChoice(value) : undefined) },
    submitForm: (values) => { void submit(values, onFormSubmit ? () => onFormSubmit(values) : undefined) },
    confirm: (confirmed) => { void submit({ confirmed }, onConfirm ? () => onConfirm(confirmed) : undefined) },
  }), [onChoice, onConfirm, onFormSubmit, submit])

  useEffect(() => {
    if (!enabled || !resolution.ok || !props.html) {
      if (!resolution.ok) setError(resolution.reason)
      if (enabled && resolution.ok && !props.html) transition({ type: 'unavailable' })
      else setStatus('unavailable')
      return
    }
    session.current = createSurfaceSession(resolution.ref, props.declaration.kind, { expiresAt: props.expiresAt })
    void repository.load(resolution.ref).then((restored) => {
      if (!restored) return
      if (restored.draft) saveDraft(resolution.ref, restored.draft)
      if (restored.status === 'submitted') {
        session.current = restored
        setStatus('submitted')
      } else if (session.current) {
        session.current = { ...session.current, draft: restored.draft }
      }
    })
    if (props.expiresAt && Date.parse(props.expiresAt) <= Date.now()) {
      transition({ type: 'expired' })
      return
    }
    const handler = (ev: MessageEvent) => {
      // Only accept messages from our iframe
      if (ev.source !== iframeRef.current?.contentWindow) return
      // origin for sandboxed iframe is opaque ("null") — validate via bridge schema, not network origin
      const validated = validateBridgeMessage(ev.data, { expectedOrigin: TRUSTED_ORIGIN, actualOrigin: ev.origin })
      if (!validated.ok) {
        transition({ type: 'invalid' })
        setError(validated.reason)
        // log security reason — never expose token
        console.warn(`[mcp-apps] bridge rejected: ${validated.reason}`)
        return
      }
      const msg = validated.msg
      if (msg.surfaceId !== props.surfaceId) return
      if (msg.action === 'ready') {
        transition({ type: 'ready' })
        return
      }
      if (msg.action === 'error') {
        setError('MCP Apps iframe 發生執行錯誤。')
        transition({ type: 'error' })
        return
      }

      // Allowlist enforcement — UI cannot call arbitrary tools
      if (msg.action === 'tool_call') {
        void executeMcpSurfaceToolCall(msg.payload, {
          surfaceId: props.surfaceId,
          surfaceToken: hostSurfaceToken,
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

      if (msg.action === 'choice_select') {
        actions.choose(String((msg.payload as Record<string, unknown>)?.value || ''))
      }
      if (msg.action === 'form_submit') {
        const values = (msg.payload as Record<string, unknown>)?.values as Record<string, unknown>
        actions.submitForm(values || {})
      }
      if (msg.action === 'confirm') {
        const confirmed = Boolean((msg.payload as Record<string, unknown>)?.confirmed)
        actions.confirm(confirmed)
      }
    }
    window.addEventListener('message', handler)
    const readyTimer = setTimeout(() => {
      if (session.current?.status !== 'loading') return
      setError('MCP Apps iframe ready handshake 逾時。')
      transition({ type: 'unavailable' })
    }, 2_000)
    const expiryTimer = props.expiresAt ? setTimeout(() => transition({ type: 'expired' }), Math.max(0, Date.parse(props.expiresAt) - Date.now())) : undefined
    return () => {
      window.removeEventListener('message', handler)
      clearTimeout(readyTimer)
      if (expiryTimer) clearTimeout(expiryTimer)
    }
  }, [actions, enabled, hostSurfaceToken, props.surfaceId, props.declaration, props.html, props.expiresAt, props.projectRoot, props.runId, props.threadId, resolution, repository, saveDraft, transition])

  if (!enabled) {
    return <FallbackSwitch {...props} actions={actions} draft={draft} status="unavailable" />
  }

  if (surfaceFallsBack(status)) {
    return <FallbackSwitch {...props} actions={actions} draft={draft} status={status} error={error} />
  }

  // Sandboxed iframe — no Electron/Node authority, constrained CSP, no network
  // Note: sandbox attribute + srcDoc + csp meta ensure no top navigation / no external resources
  const srcDoc = props.html
    ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP_SANDBOX}"><meta charset="utf-8"><body style="margin:0;font-family:&quot;Segoe WPC&quot;,&quot;Segoe UI&quot;,-apple-system,BlinkMacSystemFont,&quot;SF Pro Text&quot;,&quot;SF Pro Display&quot;,system-ui,sans-serif">${props.html}<script>window.addEventListener('error',()=>parent.postMessage({v:1,surfaceId:'${props.surfaceId}',kind:'${props.declaration.kind}',action:'error'},'*'));parent.postMessage({v:1,surfaceId:'${props.surfaceId}',kind:'${props.declaration.kind}',action:'ready'},'*')</script>`
    : `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP_SANDBOX}"><body style="display:grid;place-items:center;height:100vh;margin:0;font-family:&quot;Segoe WPC&quot;,&quot;Segoe UI&quot;,-apple-system,BlinkMacSystemFont,&quot;SF Pro Text&quot;,&quot;SF Pro Display&quot;,system-ui,sans-serif;opacity:1"><div>Surface ${props.surfaceId} (${props.declaration.kind})</div>`

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
        onError={() => transition({ type: 'error' })}
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
    onChoice?: (v: string) => SubmissionResult
    onFormSubmit?: (v: Record<string, unknown>) => SubmissionResult
    onConfirm?: (v: boolean) => SubmissionResult
    choiceOptions?: readonly SurfaceChoiceOption[]
    fallback?: ReactNode | ((actions: SurfaceFallbackActions) => ReactNode)
    actions: SurfaceFallbackActions
    draft?: Record<string, unknown> | null
    status?: SurfaceStatus
    error?: string | null
  },
) {
  // A caller-supplied native surface always wins: it is the real product UI,
  // not a stand-in.
  if (typeof props.fallback === 'function') return <>{props.fallback(props.actions)}</>
  if (props.fallback) return <>{props.fallback}</>
  if (props.declaration.kind === 'choice') {
    return <FallbackChoice options={props.choiceOptions ?? []} onSelect={props.actions.choose} />
  }
  if (props.declaration.kind === 'form') {
    return <FallbackForm onSubmit={props.actions.submitForm} draft={props.draft || undefined} />
  }
  return <FallbackConfirm onConfirm={() => props.actions.confirm(true)} onReject={() => props.actions.confirm(false)} />
}
