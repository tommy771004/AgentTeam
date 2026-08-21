import type { SubDesignPluginExecutionProjection, SubDesignPluginExecutionRequest } from '../src/agent/subdesign/pluginExecution.ts'
import { cdtAvailability, CDT_PINNED_VERSION, cdtToProviderEvidence, normalizeCdtFixtureRaw } from '../src/agent/subdesign/providers/chromeDevToolsProvider.ts'
import type { ProviderEvidence, ProviderExecutionReceipt } from '../src/agent/subdesign/providers/providerContract.ts'
import type { ProviderAttachmentPayload } from './subDesignProviderAttachments.ts'

export type { ProviderAttachmentPayload } from './subDesignProviderAttachments.ts'
export type ChromeDevToolsAdapterOutcome = {
  receipt: ProviderExecutionReceipt
  evidence: readonly ProviderEvidence[]
  findings?: NonNullable<SubDesignPluginExecutionProjection['findings']>
  attachments?: ProviderAttachmentPayload[]
  partial?: boolean
}

type CdpTarget = { type?: string; url?: string; webSocketDebuggerUrl?: string }
type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }

function loopbackUrl(value: unknown, protocols: readonly string[]): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return null
    if (url.username || url.password) return null
    url.search = ''
    url.hash = ''
    return url
  } catch { return null }
}

function endpointRoute(base: URL, pathname: string): URL {
  const next = new URL(base)
  next.pathname = pathname
  return next
}

function redactObservedText(value: unknown): string {
  return String(value || '')
    .replace(/(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]')
    .replace(/\b(?:sk|pk|api|token|secret)[-_][a-zA-Z0-9_-]{12,}\b/g, '[redacted-token]')
    .slice(0, 500)
}

async function readJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' }, redirect: 'error' })
  if (!response.ok) throw new Error(`CDP discovery HTTP ${response.status}`)
  const body = await response.text()
  if (new TextEncoder().encode(body).length > 512 * 1024) throw new Error('CDP discovery response exceeds 512 KiB')
  return JSON.parse(body)
}

async function collectCdp(input: { endpoint: URL; signal: AbortSignal; timeoutMs: number }): Promise<{
  raw: Record<string, unknown>
  attachments: ProviderAttachmentPayload[]
  partial: boolean
}> {
  const version = await readJson(endpointRoute(input.endpoint, '/json/version'), input.signal) as Record<string, unknown>
  if (String(version['Protocol-Version'] || '') !== CDT_PINNED_VERSION) throw new Error(`CDP protocol 必須固定為 ${CDT_PINNED_VERSION}`)
  const targets = await readJson(endpointRoute(input.endpoint, '/json/list'), input.signal)
  const pages = Array.isArray(targets)
    ? targets.filter((target): target is CdpTarget => Boolean(target && typeof target === 'object' && (target as CdpTarget).type === 'page' && !/^(?:about:blank|chrome:|devtools:)/.test(String((target as CdpTarget).url || ''))))
    : []
  if (pages.length !== 1) throw new Error(`受控 CDP endpoint 必須恰好提供 1 個 page target，目前為 ${pages.length}`)
  const wsUrl = loopbackUrl(pages[0].webSocketDebuggerUrl, ['ws:', 'wss:'])
  if (!wsUrl || wsUrl.hostname !== input.endpoint.hostname || wsUrl.port !== input.endpoint.port) throw new Error('CDP WebSocket target 不符合受控 loopback endpoint')

  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const raw: { console: unknown[]; network: unknown[]; performance: unknown[]; trace?: string } = { console: [], network: [], performance: [] }
  const rejectPending = (message: string) => {
    for (const waiter of pending.values()) waiter.reject(new Error(message))
    pending.clear()
  }
  const send = (method: string, params?: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }))
  })

  socket.addEventListener('message', (event) => {
    let message: CdpMessage
    try { message = JSON.parse(String(event.data)) as CdpMessage } catch { return }
    if (message.id) {
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(redactObservedText(message.error.message)))
      else waiter.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const args = Array.isArray(message.params.args) ? message.params.args as Array<Record<string, unknown>> : []
      raw.console.push({ level: 'error', message: redactObservedText(args.map((arg) => arg.value ?? arg.description ?? '').join(' ')), url: pages[0].url })
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails as Record<string, unknown> | undefined
      raw.console.push({ level: 'error', message: redactObservedText(detail?.text || 'runtime exception'), url: pages[0].url })
    }
    if (message.method === 'Network.loadingFailed') raw.network.push({ failed: true, url: 'request-failed' })
    if (message.method === 'Network.responseReceived') {
      const response = message.params?.response as Record<string, unknown> | undefined
      if (typeof response?.status === 'number' && response.status >= 400) raw.network.push({ status: response.status, url: response.url })
    }
  })
  socket.addEventListener('close', () => rejectPending('CDP socket closed'))
  socket.addEventListener('error', () => rejectPending('CDP socket error'))
  input.signal.addEventListener('abort', () => socket.close(), { once: true })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timeout')), input.timeoutMs)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed')) }, { once: true })
  })

  try {
    await Promise.all(['Runtime.enable', 'Network.enable', 'Performance.enable', 'Page.enable'].map((method) => send(method)))
    await send('Page.reload', { ignoreCache: true })
    await new Promise((resolve) => setTimeout(resolve, 250))
    const metrics = await send('Performance.getMetrics') as { metrics?: Array<{ name?: string; value?: number }> }
    const selectedMetrics = (metrics.metrics || []).filter((metric) => metric.name === 'TaskDuration' || metric.name === 'JSHeapUsedSize')
    raw.performance = selectedMetrics.map((metric) => ({ metric: metric.name, value: metric.value, threshold: metric.name === 'TaskDuration' ? 2 : 100 * 1024 * 1024 }))
    raw.trace = JSON.stringify({ url: String(pages[0].url || '').replace(/[?#].*$/, ''), metrics: selectedMetrics })
    const attachments: ProviderAttachmentPayload[] = [{ kind: 'trace', extension: 'json', content: new TextEncoder().encode(raw.trace) }]
    let partial = false
    try {
      const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }) as { data?: string }
      if (capture.data) attachments.unshift({ kind: 'screenshot', extension: 'png', content: Uint8Array.from(Buffer.from(capture.data, 'base64')) })
      else partial = true
    } catch { partial = true }
    return { raw, attachments, partial }
  } finally {
    socket.close()
    rejectPending('CDP collection complete')
  }
}

/** Pi Host-owned CDP collection; renderer never receives a socket or target selector. */
export async function executeChromeDevToolsEvidenceAdapter(input: { request: SubDesignPluginExecutionRequest; runId: string; signal: AbortSignal; timeoutMs: number }): Promise<ChromeDevToolsAdapterOutcome> {
  const startedAt = new Date().toISOString()
  const finish = (kind: ProviderExecutionReceipt['kind'], summary: string): ProviderExecutionReceipt => ({ providerId: 'chrome-devtools', runId: input.runId, stageId: input.request.stageId, kind, startedAt, finishedAt: new Date().toISOString(), summary })
  const config = input.request.providerConfig
  const availability = cdtAvailability(config?.enabled)
  if (!availability.available) return { receipt: finish('blocked', availability.reason), evidence: [] }
  if (!config) return { receipt: finish('blocked', 'Chrome DevTools provider config 缺失。'), evidence: [] }
  if (config.resolvedVersion !== CDT_PINNED_VERSION) return { receipt: finish('blocked', `CDP protocol 必須固定為 ${CDT_PINNED_VERSION}。`), evidence: [] }
  const endpoint = loopbackUrl(config.endpoint, ['http:'])
  if (!endpoint) return { receipt: finish('blocked', 'Chrome DevTools endpoint 必須是 localhost HTTP。'), evidence: [] }
  if (input.signal.aborted) return { receipt: finish('cancelled', 'Chrome DevTools collection cancelled.'), evidence: [] }
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, Math.min(input.timeoutMs, 60_000)))])
  try {
    const collected = await collectCdp({ endpoint, signal, timeoutMs: input.timeoutMs })
    const normalized = normalizeCdtFixtureRaw(collected.raw, input.runId, input.request.stageId, config.artifactId)
    const evidence = cdtToProviderEvidence(normalized.findings, input.runId, input.request.stageId)
    const blockerCount = normalized.findings.filter((finding) => finding.severity === 'blocker').length
    return { receipt: finish('success', `Chrome DevTools：${normalized.findings.length} findings · ${blockerCount} blockers${collected.partial ? ' · partial attachments' : ''}`), evidence, findings: normalized.findings, attachments: collected.attachments, partial: collected.partial }
  } catch (error) {
    if (input.signal.aborted) return { receipt: finish('cancelled', 'Chrome DevTools collection cancelled.'), evidence: [] }
    const detail = error instanceof Error ? redactObservedText(error.message) : ''
    const timedOut = signal.aborted || (error instanceof Error && /timeout/i.test(error.message))
    const status = timedOut ? `Chrome DevTools timeout after ${Math.min(input.timeoutMs, 60_000)}ms` : 'Chrome DevTools unavailable'
    return { receipt: finish('blocked', `${status}；不會將 Critique 標為通過。${detail ? ` ${detail}` : ''}`), evidence: [] }
  }
}
