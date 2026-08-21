import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'
import type { SubDesignPluginExecutionProjection, SubDesignPluginExecutionRequest } from '../src/agent/subdesign/pluginExecution.ts'
import { harnessAvailability, HARNESS_PINNED_VERSION, harnessToEvidence, normalizeHarnessFixture } from '../src/agent/subdesign/providers/harnessProvider.ts'
import type { ProviderEvidence, ProviderExecutionReceipt } from '../src/agent/subdesign/providers/providerContract.ts'
import type { ProviderAttachmentPayload } from './subDesignProviderAttachments.ts'

type McpContent = { type?: string; text?: string; data?: string; mimeType?: string }
type McpCallResult = { content?: McpContent[]; isError?: boolean }
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

class HarnessMcpClient {
  private nextId = 1
  private pending = new Map<number, Pending>()
  readonly child: ChildProcessWithoutNullStreams

  constructor(binaryPath: string, cwd: string) {
    this.child = spawn(binaryPath, [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', (line) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } }
      try { message = JSON.parse(line) as typeof message } catch { return }
      if (typeof message.id !== 'number') return
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(redact(message.error.message)))
      else waiter.resolve(message.result)
    })
    const rejectAll = (reason: string) => {
      for (const waiter of this.pending.values()) waiter.reject(new Error(reason))
      this.pending.clear()
    }
    this.child.once('error', (error) => rejectAll(redact(error.message)))
    this.child.once('exit', () => rejectAll('harness-mcp exited'))
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async call(name: string, args: Record<string, unknown>): Promise<McpContent[]> {
    const result = await this.request('tools/call', { name, arguments: args }) as McpCallResult
    const content = Array.isArray(result?.content) ? result.content : []
    if (result?.isError) throw new Error(redact(content.find((item) => item.type === 'text')?.text || `${name} failed`))
    return content
  }

  close() {
    this.child.stdin.end()
    if (!this.child.killed) this.child.kill('SIGTERM')
  }
}

function redact(value: unknown): string {
  return String(value || '')
    .replace(/(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]')
    .replace(/\b(?:sk|pk|api|token|secret)[-_][a-zA-Z0-9_-]{12,}\b/g, '[redacted-token]')
    .slice(0, 1_000)
}

function textJson(content: McpContent[]): Record<string, unknown> {
  const text = content.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('harness-mcp returned no JSON text')
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('harness-mcp returned malformed JSON')
  return value as Record<string, unknown>
}

function safeTargetUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.toString()
  } catch { return null }
}

function parseEvents(raw: unknown): { steps: unknown[]; frictionEvents: unknown[] } {
  if (typeof raw !== 'string') return { steps: [], frictionEvents: [] }
  const steps = new Map<number, Record<string, unknown>>()
  const frictionEvents: unknown[] = []
  for (const line of raw.split('\n').slice(0, 1_000)) {
    let event: Record<string, unknown>
    try { event = JSON.parse(line) as Record<string, unknown> } catch { continue }
    const step = typeof event.step === 'number' ? event.step : 0
    if (event.kind === 'tool_call' && step > 0) steps.set(step, { action: redact(event.tool), observation: redact(event.observation || event.intent), capturedAt: event.ts })
    if (event.kind === 'tool_result' && step > 0 && steps.has(step) && event.success === false) steps.get(step)!.friction = redact(event.error || 'action failed')
    if (event.kind === 'friction') frictionEvents.push({ type: redact(event.frictionKind), detail: redact(event.detail), step, capturedAt: event.ts })
  }
  return { steps: [...steps.entries()].sort(([a], [b]) => a - b).map(([, value]) => value), frictionEvents }
}

function outcome(value: unknown): 'success' | 'failure' | 'blocked' {
  return value === 'success' || value === 'failure' || value === 'blocked' ? value : 'failure'
}

export async function executeHarnessGoalAdapter(input: {
  request: SubDesignPluginExecutionRequest
  runId: string
  projectRoot: string
  signal: AbortSignal
  timeoutMs: number
  onProgress?: (summary: string) => void
}): Promise<{
  receipt: ProviderExecutionReceipt
  evidence: readonly ProviderEvidence[]
  goalResult?: SubDesignPluginExecutionProjection['goalResult']
  attachments?: ProviderAttachmentPayload[]
}> {
  const startedAt = new Date().toISOString()
  const finish = (kind: ProviderExecutionReceipt['kind'], summary: string): ProviderExecutionReceipt => ({ providerId: 'harness', runId: input.runId, stageId: input.request.stageId, kind, startedAt, finishedAt: new Date().toISOString(), summary })
  const config = input.request.providerConfig
  const availability = harnessAvailability(config?.enabled, { platform: process.platform })
  if (!availability.available) return { receipt: finish('blocked', availability.reason), evidence: [] }
  if (!config) return { receipt: finish('blocked', 'Harness provider config 缺失。'), evidence: [] }
  if (config.resolvedVersion !== HARNESS_PINNED_VERSION) return { receipt: finish('blocked', `harness-mcp 必須固定為 ${HARNESS_PINNED_VERSION}。`), evidence: [] }
  const targetUrl = safeTargetUrl(config.targetUrl)
  if (!targetUrl || !config.goal?.trim() || !config.persona?.trim() || !config.artifactId) return { receipt: finish('blocked', 'Harness 需要 goal、persona、artifact 與安全的 HTTP(S) target URL。'), evidence: [] }
  const binaryPath = config.binaryPath?.trim() || 'harness-mcp'
  if (binaryPath.includes('/') && !isAbsolute(binaryPath)) return { receipt: finish('blocked', 'Harness binary path 必須是絕對路徑或 harness-mcp。'), evidence: [] }

  const client = new HarnessMcpClient(binaryPath, input.projectRoot)
  let harnessRunId = ''
  const abort = async () => {
    if (harnessRunId) await client.call('cancel_run', { run_id: harnessRunId }).catch(() => undefined)
    client.close()
  }
  input.signal.addEventListener('abort', () => { void abort() }, { once: true })
  const deadline = Date.now() + Math.max(1, Math.min(input.timeoutMs, 15 * 60_000))
  try {
    const initialized = await client.request('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'subagents-pi-host', version: '1' }, capabilities: {} }) as Record<string, unknown>
    const serverInfo = initialized.serverInfo as Record<string, unknown> | undefined
    if (serverInfo?.name !== 'harness-mcp' || serverInfo.version !== HARNESS_PINNED_VERSION) throw new Error(`harness-mcp identity/version mismatch; expected ${HARNESS_PINNED_VERSION}`)
    const started = textJson(await client.call('start_run', { goal: config.goal.trim(), persona: config.persona.trim(), platform: 'web', web_url: targetUrl, step_budget: Math.max(1, Math.min(config.stepBudget || 20, 80)), idle_timeout_seconds: 90 }))
    const startedData = started.started as Record<string, unknown> | undefined
    harnessRunId = String(startedData?.run_id || '')
    if (!harnessRunId) throw new Error('harness-mcp start_run returned no run_id')
    while (Date.now() < deadline) {
      if (input.signal.aborted) throw new DOMException('cancelled', 'AbortError')
      const status = textJson(await client.call('get_run_status', { run_id: harnessRunId }))
      input.onProgress?.(`Harness step ${Number(status.current_step || 0)} · ${redact(status.phase || 'running')} · ${Number(status.friction_count || 0)} friction`)
      if (status.finished === true) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (Date.now() >= deadline) {
      await client.call('cancel_run', { run_id: harnessRunId }).catch(() => undefined)
      return { receipt: finish('blocked', `Harness timeout after ${input.timeoutMs}ms；static/browser Critique 可繼續。`), evidence: [] }
    }
    const result = textJson(await client.call('get_run_result', { run_id: harnessRunId, include_log: true }))
    const events = parseEvents(result.events_jsonl)
    const normalized = normalizeHarnessFixture({ outcome: outcome(result.verdict), steps: events.steps, frictionEvents: events.frictionEvents, startedAt, finishedAt: result.completed_at }, input.runId, input.request.stageId, { artifactId: config.artifactId, goal: config.goal, persona: config.persona })
    const evidence = [harnessToEvidence(normalized)]
    const attachments: ProviderAttachmentPayload[] = [{ kind: 'replay', extension: 'json', name: 'harness-replay', content: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, harnessRunId, ...normalized }, null, 2)) }]
    const stepCount = Math.min(Number(result.step_count || normalized.steps.length), 3)
    for (let step = Math.max(1, Number(result.step_count || 0) - stepCount + 1); step <= Number(result.step_count || 0); step++) {
      const screenshot = await client.call('get_step_screenshot', { run_id: harnessRunId, step }).catch(() => [])
      const image = screenshot.find((item) => item.type === 'image' && item.mimeType === 'image/png' && typeof item.data === 'string')
      if (image?.data) attachments.push({ kind: 'screenshot', extension: 'png', name: `harness-step-${String(step).padStart(3, '0')}`, content: Uint8Array.from(Buffer.from(image.data, 'base64')) })
    }
    return { receipt: finish('success', `Harness ${normalized.outcome} · ${normalized.steps.length} steps · ${normalized.frictionEvents.length} friction`), evidence, goalResult: normalized, attachments }
  } catch (error) {
    if (input.signal.aborted) return { receipt: finish('cancelled', 'Harness session cancelled；late completion ignored.'), evidence: [] }
    return { receipt: finish('blocked', `Harness unavailable；static/browser Critique 可繼續。 ${redact(error instanceof Error ? error.message : error)}`), evidence: [] }
  } finally {
    client.close()
  }
}
