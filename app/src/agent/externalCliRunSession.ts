/**
 * Host-neutral contract for a durable external CLI run.
 *
 * The Electron supervisor supplies process authority and the renderer only
 * consumes the snapshot/event projection.  Keeping this contract free of
 * Electron, React, and provider SDK imports makes the lifecycle deterministic
 * in shipped-module smokes as well as in the desktop host.
 */

export type ExternalCliAdapter =
  | 'codex'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'cursor'
  | 'opencode'
  | (string & {})

export type ExternalCliRunPhase =
  | 'starting'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type ExternalCliTerminalClassification =
  | 'success'
  | 'startup-timeout'
  | 'idle-timeout'
  | 'absolute-timeout'
  | 'operation-timeout'
  | 'connector-authentication-required'
  | 'permission-denied'
  | 'user-cancelled'
  | 'process-exit-failure'
  | 'transport-failure'
  | 'interrupted'

export type ExternalCliRunPolicy = {
  /** Maximum time before the first valid lifecycle event. */
  startupMs: number
  /** Meaningful activity deadline while not waiting for a person. */
  idleMs: number
  /** Independent upper bound for the complete process session. */
  absoluteMs: number
  /** Bound for one adapter/MCP operation; never the whole session. */
  operationMs: number
  /** Maximum observation/yield window; yielding never kills the process. */
  yieldMs: number
  /** Existing unattended HITL/safety bound. */
  unattendedWaitMs: number
  /** Retained output head and tail sizes. */
  outputHeadBytes: number
  outputTailBytes: number
}

/** Ten minutes of idle and one hour total are the interactive defaults. */
export const DEFAULT_EXTERNAL_CLI_RUN_POLICY: Readonly<ExternalCliRunPolicy> = Object.freeze({
  startupMs: 60_000,
  idleMs: 600_000,
  absoluteMs: 3_600_000,
  operationMs: 300_000,
  yieldMs: 5_000,
  unattendedWaitMs: 45_000,
  outputHeadBytes: 40_000,
  outputTailBytes: 40_000,
})

const POLICY_LIMITS: Record<keyof ExternalCliRunPolicy, { min: number; max: number }> = {
  startupMs: { min: 1, max: 600_000 },
  idleMs: { min: 1, max: 7_200_000 },
  absoluteMs: { min: 1, max: 14_400_000 },
  operationMs: { min: 1, max: 1_800_000 },
  yieldMs: { min: 1, max: 60_000 },
  unattendedWaitMs: { min: 1, max: 120_000 },
  outputHeadBytes: { min: 0, max: 250_000 },
  outputTailBytes: { min: 0, max: 250_000 },
}

function boundedNumber(
  value: unknown,
  fallback: number,
  limits: { min: number; max: number },
): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(limits.max, Math.max(limits.min, number))
}

/** Normalize an immutable policy snapshot at admission. */
export function normalizeExternalCliRunPolicy(
  policy?: Partial<ExternalCliRunPolicy>,
): ExternalCliRunPolicy {
  const source = policy || {}
  const normalized = {} as ExternalCliRunPolicy
  for (const key of Object.keys(POLICY_LIMITS) as Array<keyof ExternalCliRunPolicy>) {
    normalized[key] = boundedNumber(
      source[key],
      DEFAULT_EXTERNAL_CLI_RUN_POLICY[key],
      POLICY_LIMITS[key],
    )
  }
  // A safety cap shorter than an idle window is valid but not useful. Keep
  // both values as requested while never weakening either deadline.
  return Object.freeze(normalized)
}

export type ExternalCliClock = {
  now(): number
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

const SYSTEM_CLOCK: ExternalCliClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    // A live session must not keep a headless smoke/process alive on its own;
    // Electron still owns the process and cancellation path.
    const unref = (timer as unknown as { unref?: () => void }).unref
    unref?.call(timer)
    return timer
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

type FakeTimer = { id: number; at: number; callback: () => void }

/** Deterministic clock used by the public lifecycle smoke and integration tests. */
export class FakeExternalCliClock implements ExternalCliClock {
  private current = 0
  private nextId = 1
  private timers = new Map<number, FakeTimer>()

  now(): number {
    return this.current
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++
    this.timers.set(id, { id, at: this.current + Math.max(0, delayMs), callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.timers.delete(handle)
  }

  /** Advance time and run all due callbacks in timestamp order. */
  advance(delayMs: number): void {
    const target = this.current + Math.max(0, delayMs)
    while (true) {
      const next = [...this.timers.values()]
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!next) break
      this.timers.delete(next.id)
      this.current = next.at
      next.callback()
    }
    this.current = target
  }
}

export type ExternalCliProcessTermination = {
  confirmed: boolean
  detail?: string
}

/** Process boundary owned by Electron; never implemented by the renderer. */
export type ExternalCliProcessTransport = {
  processId?: string
  providerSessionId?: string
  isAlive?: () => boolean
  terminateTree: () => Promise<ExternalCliProcessTermination> | ExternalCliProcessTermination
  sendInput?: (input: string) => Promise<boolean> | boolean
  sendApproval?: (approved: boolean) => Promise<boolean> | boolean
}

export type ExternalCliLifecycleEventInput =
  | { type: 'process_started'; processId?: string; providerSessionId?: string; detail?: string }
  | { type: 'model_activity'; detail?: string; delta?: string }
  | { type: 'tool_started'; tool?: string; operation?: string; detail?: string }
  | { type: 'tool_completed'; tool?: string; operation?: string; detail?: string; ok?: boolean }
  | { type: 'provider_activity'; detail?: string; providerSessionId?: string }
  | { type: 'process_output'; channel: 'stdout' | 'stderr'; detail: string }
  | { type: 'diagnostic'; detail: string; severity?: 'info' | 'warning' | 'error' }
  | {
      type: 'connector_authentication_required'
      connector?: string
      server?: string
      operation?: string
      required?: boolean
      detail?: string
    }
  | { type: 'waiting_for_user'; detail?: string }
  | { type: 'waiting_for_approval'; detail?: string }
  | { type: 'input_received'; detail?: string }
  | { type: 'approval_received'; approved: boolean; detail?: string }
  | { type: 'operation_timeout'; operation?: string; detail?: string }
  | { type: 'process_exit'; code: number | null; signal?: string; detail?: string }

export type ExternalCliLifecycleEvent = ExternalCliLifecycleEventInput & {
  sequence: number
  runId: string
  at: number
  phase: ExternalCliRunPhase
}

export type ExternalCliOutputSnapshot = {
  head: string
  tail: string
  omitted: boolean
  omittedBytes: number
  totalBytes: number
}

export type ExternalCliTerminal = {
  classification: ExternalCliTerminalClassification
  phase: Extract<ExternalCliRunPhase, 'completed' | 'failed' | 'cancelled' | 'interrupted'>
  at: number
  code?: number | null
  signal?: string
  reason?: string
  terminationConfirmed?: boolean
  providerSessionId?: string
}

export type ExternalCliSessionSnapshot = {
  runId: string
  conversationId: string
  adapter: ExternalCliAdapter
  phase: ExternalCliRunPhase
  active: boolean
  startedAt: number
  firstValidLifecycleAt?: number
  lastMeaningfulActivityAt?: number
  processId?: string
  providerSessionId?: string
  eventCursor: number
  oldestEventCursor: number
  policy: ExternalCliRunPolicy
  unattended: boolean
  waitingDetail?: string
  output: ExternalCliOutputSnapshot
  events: ExternalCliLifecycleEvent[]
  terminal: ExternalCliTerminal | null
}

export type ExternalCliSettlement = ExternalCliTerminal & { runId: string }

export type ExternalCliRunSessionOptions = {
  runId: string
  conversationId: string
  adapter: ExternalCliAdapter
  clock?: ExternalCliClock
  policy?: Partial<ExternalCliRunPolicy>
  unattended?: boolean
  processId?: string
  providerSessionId?: string
  transport?: ExternalCliProcessTransport
  onEvent?: (event: ExternalCliLifecycleEvent) => void
  onSettlement?: (settlement: ExternalCliSettlement) => void
}

const MAX_EVENTS = 1_000
const MAX_DETAIL = 600

function safeText(value: unknown, max = MAX_DETAIL): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .trim()
  return text ? text.slice(0, max) : undefined
}

function classifyTerminalPhase(classification: ExternalCliTerminalClassification): ExternalCliTerminal['phase'] {
  if (classification === 'success') return 'completed'
  if (classification === 'user-cancelled') return 'cancelled'
  if (classification === 'interrupted') return 'interrupted'
  return 'failed'
}

function isMeaningful(event: ExternalCliLifecycleEventInput): boolean {
  switch (event.type) {
    case 'diagnostic':
      return event.severity === 'error'
    case 'process_output':
      return Boolean(event.detail.trim())
    case 'process_started':
    case 'model_activity':
    case 'tool_started':
    case 'tool_completed':
    case 'provider_activity':
    case 'connector_authentication_required':
    case 'input_received':
    case 'approval_received':
    case 'operation_timeout':
    case 'process_exit':
      return true
    case 'waiting_for_user':
    case 'waiting_for_approval':
      return false
  }
}

function isValidLifecycle(event: ExternalCliLifecycleEventInput): boolean {
  switch (event.type) {
    case 'diagnostic':
      return false
    case 'process_output':
      return Boolean(event.detail.trim())
    case 'model_activity':
      return Boolean(event.detail?.trim() || event.delta?.trim())
    case 'tool_started':
    case 'tool_completed':
      return Boolean(event.tool?.trim() || event.operation?.trim() || event.detail?.trim())
    default:
      return true
  }
}

function outputSnapshot(
  text: string,
  policy: ExternalCliRunPolicy,
  retainedTotalBytes = utf8ByteLength(text),
): ExternalCliOutputSnapshot {
  const totalBytes = Math.max(retainedTotalBytes, utf8ByteLength(text))
  if (totalBytes <= policy.outputHeadBytes + policy.outputTailBytes) {
    return { head: text, tail: '', omitted: false, omittedBytes: 0, totalBytes }
  }
  const head = takeUtf8Bytes(text, policy.outputHeadBytes)
  const tail = policy.outputTailBytes ? takeUtf8Bytes(text, policy.outputTailBytes, true) : ''
  const kept = utf8ByteLength(head) + utf8ByteLength(tail)
  const omittedBytes = Math.max(0, totalBytes - kept)
  return {
    head,
    tail,
    omitted: omittedBytes > 0,
    omittedBytes,
    totalBytes,
  }
}

/** Count UTF-8 bytes without relying on Node's Buffer in renderer-safe code. */
function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) || 0
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

/** Keep a complete code point at each edge while respecting a byte budget. */
function takeUtf8Bytes(text: string, maxBytes: number, fromEnd = false): string {
  if (maxBytes <= 0 || !text) return ''
  const chars = Array.from(text)
  const picked: string[] = []
  let bytes = 0
  const source = fromEnd ? chars.reverse() : chars
  for (const char of source) {
    const nextBytes = utf8ByteLength(char)
    if (bytes + nextBytes > maxBytes) break
    picked.push(char)
    bytes += nextBytes
  }
  return fromEnd ? picked.reverse().join('') : picked.join('')
}

export class ExternalCliRunSession {
  private readonly clock: ExternalCliClock
  private readonly policy: ExternalCliRunPolicy
  private readonly transport?: ExternalCliProcessTransport
  private readonly onEvent?: (event: ExternalCliLifecycleEvent) => void
  private readonly onSettlement?: (settlement: ExternalCliSettlement) => void
  private readonly eventLog: ExternalCliLifecycleEvent[] = []
  private readonly runId: string
  private readonly conversationId: string
  private readonly adapter: ExternalCliAdapter
  private readonly unattended: boolean
  private output = ''
  private outputTotalBytes = 0
  private phase: ExternalCliRunPhase = 'starting'
  private startedAt: number
  private firstValidLifecycleAt: number | undefined
  private lastMeaningfulActivityAt: number | undefined
  private processId: string | undefined
  private providerSessionId: string | undefined
  private waitingDetail: string | undefined
  private sequence = 0
  private started = false
  private terminal: ExternalCliTerminal | null = null
  private deadlineHandle: unknown
  private absoluteHandle: unknown
  private unattendedWaitHandle: unknown
  private terminationRequested = false
  private cancellationRequested = false
  private cancellationPromise?: Promise<ExternalCliSettlement>

  constructor(options: ExternalCliRunSessionOptions) {
    this.clock = options.clock || SYSTEM_CLOCK
    this.policy = normalizeExternalCliRunPolicy(options.policy)
    this.transport = options.transport
    this.onEvent = options.onEvent
    this.onSettlement = options.onSettlement
    this.runId = options.runId
    this.conversationId = options.conversationId
    this.adapter = options.adapter
    this.unattended = options.unattended === true
    this.processId = options.processId || options.transport?.processId
    this.providerSessionId = options.providerSessionId || options.transport?.providerSessionId
    this.startedAt = this.clock.now()
  }

  start(): ExternalCliSessionSnapshot {
    if (this.started) return this.snapshot()
    this.started = true
    this.startedAt = this.clock.now()
    this.emit({ type: 'provider_activity', detail: 'external session admitted' })
    this.scheduleDeadline(this.policy.startupMs)
    this.scheduleAbsoluteDeadline()
    return this.snapshot()
  }

  /** Feed one provider/process lifecycle event into the Host-owned session. */
  observe(input: ExternalCliLifecycleEventInput): ExternalCliSessionSnapshot {
    // Once cancellation has been requested, provider/process callbacks may
    // still arrive while the host waits for tree termination. They cannot win
    // the cancellation race or settle the run as a late success.
    if (this.terminal || this.cancellationRequested) return this.snapshot()
    if (!this.started) this.start()

    // Meaningful provider/process lifecycle signals cross the first-valid-
    // event boundary. Diagnostics alone are not: stderr may be emitted by a
    // wrapper before the adapter is actually live.
    if (isValidLifecycle(input)) this.markStarted()

    if (input.type === 'process_started') {
      this.processId = safeText(input.processId, 160) || this.processId
      this.providerSessionId = safeText(input.providerSessionId, 200) || this.providerSessionId
    }
    if (input.type === 'provider_activity' && input.providerSessionId) {
      this.providerSessionId = safeText(input.providerSessionId, 200) || this.providerSessionId
    }
    if (input.type === 'waiting_for_user' || input.type === 'waiting_for_approval') {
      this.waitingDetail = safeText(input.detail)
      this.phase = input.type === 'waiting_for_user' ? 'waiting_for_user' : 'waiting_for_approval'
      this.clearDeadline()
      this.emit({ ...input, detail: safeText(input.detail) })
      if (this.unattended) this.scheduleUnattendedDenial()
      return this.snapshot()
    }

    if (input.type === 'input_received' || input.type === 'approval_received') {
      this.waitingDetail = undefined
      this.clearUnattendedWait()
      this.phase = 'running'
      this.markMeaningfulActivity()
      this.emit({ ...input, detail: safeText(input.detail) })
      this.scheduleDeadline(this.policy.idleMs)
      return this.snapshot()
    }

    if (input.type === 'connector_authentication_required') {
      this.markMeaningfulActivity()
      this.emit({
        ...input,
        connector: safeText(input.connector, 120),
        server: safeText(input.server, 160),
        operation: safeText(input.operation, 160),
        detail: safeText(input.detail),
      })
      if (input.required) {
        this.settle('connector-authentication-required', {
          reason: safeText(input.detail || input.server || input.connector),
        })
      } else {
        this.scheduleActivityDeadline()
      }
      return this.snapshot()
    }

    if (input.type === 'process_output') {
      const rawDetail = typeof input.detail === 'string' ? input.detail : ''
      const detail = safeText(rawDetail, 20_000) || ''
      // Keep the retained text bounded and redacted, but count the original
      // UTF-8 payload so truncation evidence remains honest even when one
      // provider chunk is larger than the redaction/detail bound.
      this.appendOutput(detail, utf8ByteLength(rawDetail))
      if (isMeaningful({ ...input, detail })) this.markMeaningfulActivity()
      // Streamed parser events carry the full bounded chunk separately; the
      // durable session log keeps only a short redacted diagnostic excerpt.
      this.emit({ ...input, detail: safeText(detail) || '' })
      if (this.phase === 'starting') this.phase = 'running'
      if (this.phase !== 'waiting_for_user' && this.phase !== 'waiting_for_approval') {
        this.scheduleActivityDeadline()
      }
      return this.snapshot()
    }

    if (isMeaningful(input)) this.markMeaningfulActivity()
    if (input.type === 'operation_timeout') {
      this.emit({ ...input, operation: safeText(input.operation, 160), detail: safeText(input.detail) })
      this.settle('operation-timeout', { reason: safeText(input.detail || input.operation) })
      return this.snapshot()
    }
    if (input.type === 'process_exit') {
      if (input.code === 0 && !input.signal) this.settle('success', { code: 0 })
      else this.settle('process-exit-failure', { code: input.code, signal: safeText(input.signal, 80), reason: safeText(input.detail) })
      return this.snapshot()
    }
    if (input.type === 'diagnostic') {
      this.emit({ ...input, detail: safeText(input.detail) || 'diagnostic' })
    } else if (input.type === 'process_started') {
      this.emit({
        ...input,
        processId: safeText(input.processId, 160),
        providerSessionId: safeText(input.providerSessionId, 200),
        detail: safeText(input.detail),
      })
    } else if (input.type === 'provider_activity') {
      this.emit({
        ...input,
        providerSessionId: safeText(input.providerSessionId, 200),
        detail: safeText(input.detail),
      })
    } else if (input.type === 'model_activity') {
      this.emit({
        ...input,
        detail: safeText(input.detail),
        delta: safeText(input.delta, MAX_DETAIL),
      })
    } else if (input.type === 'tool_started' || input.type === 'tool_completed') {
      this.emit({
        ...input,
        tool: safeText(input.tool, 160),
        operation: safeText(input.operation, 160),
        detail: safeText(input.detail),
      })
    }
    this.scheduleActivityDeadline()
    return this.snapshot()
  }

  /** Return a bounded observation snapshot. This never terminates the process. */
  yieldObservation(): ExternalCliSessionSnapshot & { live: boolean; observationExpiresAt: number } {
    if (!this.terminal && !this.cancellationRequested) {
      this.emit({ type: 'provider_activity', detail: 'observation yielded' })
    }
    const snapshot = this.snapshot()
    return {
      ...snapshot,
      live: snapshot.active,
      observationExpiresAt: this.clock.now() + this.policy.yieldMs,
    }
  }

  eventsAfter(cursor = 0): ExternalCliLifecycleEvent[] {
    const acknowledged = Number.isFinite(cursor) ? Math.max(0, cursor) : 0
    return this.eventLog.filter((event) => event.sequence > acknowledged).map((event) => ({ ...event }))
  }

  reconnect(cursor = 0): {
    snapshot: ExternalCliSessionSnapshot
    events: ExternalCliLifecycleEvent[]
    replayGap: boolean
  } {
    const acknowledged = Number.isFinite(cursor) ? Math.max(0, cursor) : 0
    const snapshot = this.snapshot()
    const oldest = this.eventLog[0]?.sequence
    const replayGap = oldest !== undefined && acknowledged < oldest - 1
    if (replayGap) {
      // The acknowledged cursor predates the bounded event log. Returning the
      // retained snapshot as the replay source is the only honest way to
      // rebuild current state without duplicating a partial prefix.
      return { snapshot, events: [], replayGap: true }
    }
    // The projection is the state at reconnect time; retain only events the
    // caller already acknowledged so merging snapshot.events with replay does
    // not duplicate a lifecycle record.
    snapshot.events = snapshot.events.filter((event) => event.sequence <= acknowledged)
    return { snapshot, events: this.eventsAfter(acknowledged), replayGap: false }
  }

  provideInput(input: string, expectedProviderSessionId?: string): Promise<boolean> {
    if (this.terminal || this.cancellationRequested || this.phase !== 'waiting_for_user') return Promise.resolve(false)
    if (expectedProviderSessionId && expectedProviderSessionId !== this.providerSessionId) {
      return Promise.resolve(false)
    }
    // The value is sent only through the Host transport. Do not persist or
    // echo it in lifecycle metadata, but do preserve a user's actual answer
    // (including strings that merely resemble credentials).
    const safe = typeof input === 'string' ? input.slice(0, 4_000) : ''
    const send = this.transport?.sendInput
    const result = send ? send(safe) : true
    return Promise.resolve(result).then((ok) => {
      if (ok) this.observe({ type: 'input_received', detail: 'user input delivered' })
      return ok
    })
  }

  provideApproval(approved: boolean, expectedProviderSessionId?: string): Promise<boolean> {
    if (this.terminal || this.cancellationRequested || this.phase !== 'waiting_for_approval') return Promise.resolve(false)
    if (expectedProviderSessionId && expectedProviderSessionId !== this.providerSessionId) {
      return Promise.resolve(false)
    }
    const send = this.transport?.sendApproval
    const result = send ? send(approved) : true
    return Promise.resolve(result).then((ok) => {
      if (ok) this.observe({ type: 'approval_received', approved })
      return ok
    })
  }

  /** Arm one scoped tool/MCP timeout without changing the session's idle clock. */
  armOperationTimeout(operation: string, timeoutMs = this.policy.operationMs): () => void {
    if (this.terminal || this.cancellationRequested) return () => undefined
    let active = true
    const handle = this.clock.setTimeout(() => {
      if (!active || this.terminal || this.cancellationRequested) return
      this.observe({ type: 'operation_timeout', operation: safeText(operation, 160), detail: 'operation timeout' })
    }, boundedNumber(timeoutMs, this.policy.operationMs, POLICY_LIMITS.operationMs))
    return () => {
      active = false
      this.clock.clearTimeout(handle)
    }
  }

  /** Cancel through the one process-tree authority and settle exactly once. */
  async cancel(reason = 'user cancellation'): Promise<ExternalCliSettlement> {
    if (this.terminal) return this.settlementValue()
    if (this.cancellationPromise) return this.cancellationPromise
    // Set this before invoking the transport. A fake or platform transport
    // may synchronously deliver a final process-exit callback while asking it
    // to terminate; cancellation must remain the authoritative outcome.
    this.cancellationRequested = true
    this.clearAllTimers()
    this.cancellationPromise = (async () => {
      let termination: ExternalCliProcessTermination = { confirmed: true }
      try {
        this.terminationRequested = true
        const result = await this.transport?.terminateTree()
        if (result) termination = result
      } catch (error) {
        termination = { confirmed: false, detail: error instanceof Error ? error.message : String(error) }
      }
      if (!termination.confirmed) {
        this.settle('transport-failure', {
          reason: safeText(termination.detail || reason),
          terminationConfirmed: false,
        })
      } else {
        this.settle('user-cancelled', { reason: safeText(reason), terminationConfirmed: true })
      }
      return this.settlementValue()
    })()
    return this.cancellationPromise
  }

  /** Record a cancellation already performed by the host kill path. */
  cancelObserved(reason = 'user cancellation'): ExternalCliSettlement {
    if (this.terminal) return this.settlementValue()
    this.cancellationRequested = true
    this.clearAllTimers()
    this.terminationRequested = true
    this.settle('user-cancelled', { reason: safeText(reason), terminationConfirmed: true })
    return this.settlementValue()
  }

  /** Mark a lost Electron/process session as interrupted, never as success. */
  markInterrupted(reason = 'host or provider process lost'): ExternalCliSettlement {
    if (this.terminal) return this.settlementValue()
    this.clearAllTimers()
    this.requestTermination()
    this.settle('interrupted', { reason: safeText(reason) })
    return this.settlementValue()
  }

  recoveryDecision(input: { adapterSupportsResume: boolean; replaySafeCheckpoint: boolean }) {
    return evaluateExternalCliRecovery({
      providerSessionId: this.providerSessionId,
      adapterSupportsResume: input.adapterSupportsResume,
      replaySafeCheckpoint: input.replaySafeCheckpoint,
    })
  }

  forceTimeout(classification: Extract<ExternalCliTerminalClassification, 'startup-timeout' | 'idle-timeout' | 'absolute-timeout'>): ExternalCliSettlement {
    if (this.terminal) return this.settlementValue()
    this.clearAllTimers()
    this.requestTermination()
    this.settle(classification, { reason: classification })
    return this.settlementValue()
  }

  /** Settle an adapter/transport fault without mislabeling it as provider exit. */
  failTransport(reason = 'external CLI transport failed'): ExternalCliSettlement {
    if (this.terminal) return this.settlementValue()
    this.clearAllTimers()
    this.requestTermination()
    this.settle('transport-failure', { reason: safeText(reason), terminationConfirmed: false })
    return this.settlementValue()
  }

  snapshot(): ExternalCliSessionSnapshot {
    return {
      runId: this.runId,
      conversationId: this.conversationId,
      adapter: this.adapter,
      phase: this.phase,
      active: this.terminal === null,
      startedAt: this.startedAt,
      firstValidLifecycleAt: this.firstValidLifecycleAt,
      lastMeaningfulActivityAt: this.lastMeaningfulActivityAt,
      processId: this.processId,
      providerSessionId: this.providerSessionId,
      eventCursor: this.sequence,
      oldestEventCursor: this.eventLog[0]?.sequence || this.sequence,
      policy: this.policy,
      unattended: this.unattended,
      waitingDetail: this.waitingDetail,
      output: outputSnapshot(this.output, this.policy, this.outputTotalBytes),
      events: this.eventLog.map((event) => ({ ...event })),
      terminal: this.terminal ? { ...this.terminal } : null,
    }
  }

  private markStarted() {
    if (this.firstValidLifecycleAt === undefined) this.firstValidLifecycleAt = this.clock.now()
    this.phase = 'running'
    this.markMeaningfulActivity()
  }

  private markMeaningfulActivity() {
    if (this.phase === 'waiting_for_user' || this.phase === 'waiting_for_approval') return
    this.lastMeaningfulActivityAt = this.clock.now()
  }

  private appendOutput(detail: string, sourceBytes = utf8ByteLength(detail)) {
    this.outputTotalBytes += Math.max(sourceBytes, utf8ByteLength(detail))
    const retainedLimit = this.policy.outputHeadBytes + this.policy.outputTailBytes
    if (retainedLimit <= 0) {
      this.output = ''
      return
    }
    const combined = this.output + detail
    if (utf8ByteLength(combined) <= retainedLimit) {
      this.output = combined
      return
    }
    this.output = [
      takeUtf8Bytes(combined, this.policy.outputHeadBytes),
      this.policy.outputTailBytes ? takeUtf8Bytes(combined, this.policy.outputTailBytes, true) : '',
    ].join('')
  }

  private emit(input: ExternalCliLifecycleEventInput) {
    const event = {
      ...input,
      runId: this.runId,
      sequence: ++this.sequence,
      at: this.clock.now(),
      phase: this.phase,
    } as ExternalCliLifecycleEvent
    this.eventLog.push(event)
    if (this.eventLog.length > MAX_EVENTS) this.eventLog.splice(0, this.eventLog.length - MAX_EVENTS)
    try {
      this.onEvent?.(event)
    } catch {
      /* event observers are projections, never an execution authority */
    }
  }

  private scheduleDeadline(delayMs: number) {
    this.clearDeadline()
    if (this.terminal) return
    const due = Math.max(0, delayMs)
    this.deadlineHandle = this.clock.setTimeout(() => {
      if (this.terminal) return
      const elapsed = this.clock.now() - this.startedAt
      if (elapsed >= this.policy.absoluteMs) {
        this.forceTimeout('absolute-timeout')
      } else if (this.firstValidLifecycleAt === undefined) {
        this.forceTimeout('startup-timeout')
      } else if (this.phase !== 'waiting_for_user' && this.phase !== 'waiting_for_approval') {
        this.forceTimeout('idle-timeout')
      }
    }, due)
  }

  private scheduleActivityDeadline() {
    if (this.firstValidLifecycleAt === undefined) return
    this.scheduleDeadline(this.policy.idleMs)
  }

  private scheduleAbsoluteDeadline() {
    if (this.absoluteHandle !== undefined) this.clock.clearTimeout(this.absoluteHandle)
    this.absoluteHandle = this.clock.setTimeout(() => {
      if (!this.terminal) this.forceTimeout('absolute-timeout')
    }, this.policy.absoluteMs)
  }

  private scheduleUnattendedDenial() {
    this.clearUnattendedWait()
    this.unattendedWaitHandle = this.clock.setTimeout(() => {
      if (this.phase === 'waiting_for_user' || this.phase === 'waiting_for_approval') {
        this.emit({ type: 'approval_received', approved: false, detail: 'unattended wait auto-denied' })
        this.settle('permission-denied', { reason: 'unattended wait auto-denied' })
      }
    }, this.policy.unattendedWaitMs)
  }

  private clearDeadline() {
    if (this.deadlineHandle !== undefined) this.clock.clearTimeout(this.deadlineHandle)
    this.deadlineHandle = undefined
  }

  private clearUnattendedWait() {
    if (this.unattendedWaitHandle !== undefined) this.clock.clearTimeout(this.unattendedWaitHandle)
    this.unattendedWaitHandle = undefined
  }

  private clearAllTimers() {
    this.clearDeadline()
    if (this.absoluteHandle !== undefined) this.clock.clearTimeout(this.absoluteHandle)
    this.absoluteHandle = undefined
    this.clearUnattendedWait()
  }

  private requestTermination() {
    if (this.terminationRequested) return
    this.terminationRequested = true
    try {
      const termination = this.transport?.terminateTree()
      if (termination && typeof (termination as Promise<unknown>).then === 'function') {
        void Promise.resolve(termination).catch(() => undefined)
      }
    } catch {
      /* interruption remains an honest non-success even if cleanup fails */
    }
  }

  private settle(
    classification: ExternalCliTerminalClassification,
    details: Pick<ExternalCliTerminal, 'code' | 'signal' | 'reason' | 'terminationConfirmed'> = {},
  ) {
    if (this.terminal) return
    this.clearAllTimers()
    if (
      classification === 'startup-timeout' ||
      classification === 'idle-timeout' ||
      classification === 'absolute-timeout' ||
      classification === 'operation-timeout' ||
      classification === 'connector-authentication-required' ||
      classification === 'permission-denied' ||
      classification === 'transport-failure' ||
      classification === 'interrupted'
    ) {
      this.requestTermination()
    }
    this.phase = classifyTerminalPhase(classification)
    this.terminal = {
      classification,
      phase: this.phase,
      at: this.clock.now(),
      ...details,
      providerSessionId: this.providerSessionId,
    }
    this.emit({
      type: 'process_exit',
      code: details.code ?? (classification === 'success' ? 0 : null),
      signal: details.signal,
      detail: classification,
    })
    const settlement = this.settlementValue()
    try {
      this.onSettlement?.(settlement)
    } catch {
      /* settlement observers cannot create a second settlement */
    }
  }

  private settlementValue(): ExternalCliSettlement {
    if (!this.terminal) {
      return {
        runId: this.runId,
        classification: 'interrupted',
        phase: 'interrupted',
        at: this.clock.now(),
        reason: 'settlement pending',
        providerSessionId: this.providerSessionId,
      }
    }
    return { runId: this.runId, ...this.terminal }
  }

}

export type ExternalCliDiagnostic = {
  kind: 'diagnostic' | 'connector-authentication-required' | 'timeout'
  severity: 'info' | 'warning' | 'error'
  detail: string
  connector?: string
  server?: string
  operation?: string
  required?: boolean
  headlessHint: boolean
}

/** Normalize incidental provider output without allowing it to become root cause. */
export function classifyExternalCliDiagnostic(
  line: string,
  context: { adapter: ExternalCliAdapter; connector?: string; server?: string; operation?: string; required?: boolean; headless?: boolean },
): ExternalCliDiagnostic {
  const detail = safeText(line, MAX_DETAIL) || 'external CLI diagnostic'
  const auth = /authrequired|authentication\s+required|oauth|bearer\s+realm/i.test(detail)
  if (auth) {
    return {
      kind: 'connector-authentication-required',
      severity: context.required ? 'error' : 'warning',
      detail,
      connector: safeText(context.connector, 120),
      server: safeText(context.server, 160),
      operation: safeText(context.operation, 160),
      required: context.required === true,
      headlessHint: false,
    }
  }
  const timeout = /timeout|timed\s*out|逾時/i.test(detail)
  return {
    kind: timeout ? 'timeout' : 'diagnostic',
    severity: timeout ? 'error' : 'info',
    detail,
    headlessHint: timeout && context.headless === false,
  }
}

export function formatExternalCliTerminal(
  terminal: ExternalCliTerminal,
  options?: { headless?: boolean },
): string {
  const labels: Record<ExternalCliTerminalClassification, string> = {
    success: 'CLI 完成（未驗證內建 DoD）',
    'startup-timeout': 'CLI 啟動逾時',
    'idle-timeout': 'CLI 長時間沒有有效活動，已停止',
    'absolute-timeout': 'CLI 已達安全執行上限，已停止',
    'operation-timeout': 'CLI 工具操作逾時',
    'connector-authentication-required': '需要連接器驗證',
    'permission-denied': '未授權的互動要求已拒絕',
    'user-cancelled': '使用者取消 CLI',
    'process-exit-failure': 'CLI 程序失敗',
    'transport-failure': 'CLI 程序終止狀態無法確認',
    interrupted: 'CLI 執行被中斷，需要恢復判定',
  }
  const hint = options?.headless === false ? '；請確認使用 headless CLI adapter' : ''
  return `${labels[terminal.classification]}${terminal.classification.endsWith('timeout') ? hint : ''}`
}

export function evaluateExternalCliRecovery(input: {
  providerSessionId?: string
  adapterSupportsResume: boolean
  replaySafeCheckpoint: boolean
}): { interrupted: true; resumable: boolean; automaticRetry: boolean } {
  const resumable = Boolean(input.providerSessionId && input.adapterSupportsResume)
  return {
    interrupted: true,
    resumable,
    automaticRetry: resumable && input.replaySafeCheckpoint,
  }
}

export class ExternalCliRunSessionRegistry {
  private readonly sessions = new Map<string, ExternalCliRunSession>()
  private readonly interactions = new Map<string, Promise<unknown>>()

  create(options: ExternalCliRunSessionOptions): ExternalCliRunSession {
    const session = new ExternalCliRunSession(options)
    this.sessions.set(options.runId, session)
    return session
  }

  register(session: ExternalCliRunSession): void {
    this.sessions.set(session.snapshot().runId, session)
  }

  get(runId: string): ExternalCliRunSession | undefined {
    return this.sessions.get(runId)
  }

  remove(runId: string): void {
    this.sessions.delete(runId)
    this.interactions.delete(runId)
  }

  forConversation(conversationId: string): ExternalCliSessionSnapshot[] {
    return [...this.sessions.values()]
      .map((session) => session.snapshot())
      .filter((snapshot) => snapshot.conversationId === conversationId)
  }

  snapshots(): ExternalCliSessionSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot())
  }

  /** Host reloads only need live sessions; terminal history is already settled. */
  activeSnapshots(): ExternalCliSessionSnapshot[] {
    return this.snapshots().filter((snapshot) => snapshot.active)
  }

  async interact<T>(runId: string, operation: (session: ExternalCliRunSession) => Promise<T> | T): Promise<T> {
    const session = this.sessions.get(runId)
    if (!session) throw new Error(`external CLI session not found: ${runId}`)
    const previous = this.interactions.get(runId) || Promise.resolve()
    const current = previous.catch(() => undefined).then(() => operation(session))
    this.interactions.set(runId, current)
    try {
      return await current
    } finally {
      if (this.interactions.get(runId) === current) this.interactions.delete(runId)
    }
  }
}
