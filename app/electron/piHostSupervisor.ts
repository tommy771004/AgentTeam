import type { PiHostEvent, PiHostMessage, PiHostRequest, PiHostResponse } from './piHostProtocol.ts'
import type { PiTurnSettlement } from '../src/agent/piHostRun.ts'

export type PiHostStatus =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'ready'; protocolVersion: number; capabilities: string[] }
  | { state: 'crashed'; exitCode: number | null; signal?: number }
  | { state: 'error'; message: string }

type PiHostChild = {
  on(event: string, listener: (...args: any[]) => void): unknown
  postMessage(message: unknown): void
  kill(): void
}
type PiHostFork = () => PiHostChild
type PiHostSupervisorOptions = {
  requestTimeoutMs?: number
  turnIdleTimeoutMs?: number
}
type PendingRequest = {
  resolve: (response: PiHostResponse) => void
  reject: (error: Error) => void
  method: PiHostRequest['method']
  runId?: string
  timeoutMs: number
  timer?: ReturnType<typeof setTimeout>
}

export class PiHostSupervisor {
  private readonly fork: PiHostFork
  private readonly requestTimeoutMs: number
  private readonly turnIdleTimeoutMs: number
  private child: PiHostChild | null = null
  private nextRequestId = 1
  private statusValue: PiHostStatus = { state: 'stopped' }
  private stopping = false
  private restartAttempts = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private readonly eventListeners = new Set<(event: PiHostEvent) => void>()
  private readonly pending = new Map<string | number, PendingRequest>()

  constructor(fork: PiHostFork, options: PiHostSupervisorOptions = {}) {
    this.fork = fork
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.turnIdleTimeoutMs = options.turnIdleTimeoutMs ?? 5 * 60_000
  }

  status(): PiHostStatus {
    return this.statusValue
  }

  onEvent(listener: (event: PiHostEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async start(): Promise<PiHostStatus> {
    if (this.statusValue.state === 'ready') return this.statusValue
    this.stopping = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    this.statusValue = { state: 'starting' }
    const child = this.fork()
    this.child = child
    child.on('message', (message: PiHostMessage) => {
      if ('event' in message) {
        const runId = typeof message.payload === 'object' && message.payload && 'runId' in message.payload
          ? String((message.payload as { runId?: unknown }).runId || '')
          : ''
        if (runId) this.refreshTurnDeadline(runId)
        this.eventListeners.forEach((listener) => listener(message as unknown as PiHostEvent))
        return
      }
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(message)
    })
    child.on('exit', (code: number | null, signal?: number) => {
      this.child = null
      if (this.stopping) {
        this.statusValue = { state: 'stopped' }
        return
      }
      this.statusValue = { state: 'crashed', exitCode: code, signal }
      for (const waiter of this.pending.values()) {
        if (waiter.timer) clearTimeout(waiter.timer)
        waiter.reject(new Error('Pi Core Host exited'))
      }
      this.pending.clear()
      this.scheduleRestart()
    })
    child.on('error', (error: Error) => {
      this.statusValue = { state: 'error', message: error.message }
    })

    const response = await this.request('initialize', { protocolVersion: 2, client: 'subagents-electron' })
    if (response.error || !response.result) {
      const message = response.error?.message || 'Pi Core Host did not initialize'
      this.statusValue = { state: 'error', message }
      throw new Error(message)
    }
    this.statusValue = {
      state: 'ready',
      protocolVersion: response.result.protocolVersion ?? 1,
      capabilities: response.result.capabilities ? [...response.result.capabilities] : [],
    }
    this.restartAttempts = 0
    return this.statusValue
  }

  async health(): Promise<PiHostResponse['result']> {
    const response = await this.request('health/get', {})
    if (response.error || !response.result) throw new Error(response.error?.message || 'Pi Host health failed')
    return response.result
  }

  async getSettings(): Promise<NonNullable<PiHostResponse['result']>['settings']> {
    const result = await this.getSettingsSnapshot()
    return result.settings
  }

  async getSettingsSnapshot(): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('settings/get', {})
    if (response.error || !response.result?.settings) throw new Error(response.error?.message || 'Pi Host settings failed')
    return response.result
  }

  async updateSettings(patch: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['settings']> {
    const result = await this.updateSettingsSnapshot(patch)
    return result.settings
  }

  async updateSettingsSnapshot(patch: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('settings/update', patch)
    if (response.error || !response.result?.settings) throw new Error(response.error?.message || 'Pi Host settings update failed')
    return response.result
  }

  async profile(role?: Record<string, unknown>, taskOverride?: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['profile']> {
    const response = await this.request('settings/profile', { role: role || {}, taskOverride: taskOverride || {} })
    if (response.error || !response.result?.profile) throw new Error(response.error?.message || 'Pi Host profile failed')
    return response.result.profile
  }

  async createSession(title?: string, threadId?: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/create', {
      ...(title ? { title } : {}),
      ...(threadId ? { threadId } : {}),
    })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session creation failed')
    return response.result
  }

  async createChildSession(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/create', input)
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Child Pi session creation failed')
    return response.result
  }

  /** One bounded page of a session's Turn Record, addressed by `seq`. */
  async readSessionRecord(sessionId: string, before?: number, limit?: number): Promise<NonNullable<PiHostResponse['result']>['page']> {
    const response = await this.request('sessions/record', {
      sessionId,
      ...(before === undefined ? {} : { before }),
      ...(limit === undefined ? {} : { limit }),
    })
    if (response.error || !response.result?.page) throw new Error(response.error?.message || 'Pi record page failed')
    return response.result.page
  }

  async listSessions(): Promise<NonNullable<PiHostResponse['result']>['sessions']> {
    const response = await this.request('sessions/list', {})
    if (response.error || !response.result?.sessions) throw new Error(response.error?.message || 'Pi session listing failed')
    return response.result.sessions
  }

  async listQueuedRuns(): Promise<NonNullable<PiHostResponse['result']>['queue']> {
    const response = await this.request('runs/list', {})
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queue listing failed')
    return response.result.queue
  }

  async enqueueRun(input: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['queue']> {
    const response = await this.request('runs/enqueue', input)
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queue admission failed')
    return response.result.queue
  }

  async cancelQueuedRun(runId: string): Promise<NonNullable<PiHostResponse['result']>['queue']> {
    const response = await this.request('runs/cancel', { runId })
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queued run cancellation failed')
    return response.result.queue
  }

  async claimQueuedRun(runId?: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/claim', runId ? { runId } : {})
    if (response.error || !response.result?.runId && !response.result?.queue) throw new Error(response.error?.message || 'Pi queue claim failed')
    return response.result
  }

  async settleQueuedRun(runId: string, settlement: PiTurnSettlement): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('runs/settle', { runId, settlement })
    if (response.error || !response.result?.queue) throw new Error(response.error?.message || 'Pi queue settlement failed')
    return response.result
  }

  async listResources(): Promise<NonNullable<PiHostResponse['result']>['resources']> {
    const response = await this.request('resources/list', {})
    if (response.error || !response.result?.resources) throw new Error(response.error?.message || 'Pi resource listing failed')
    return response.result.resources
  }

  async reloadResources(resources: unknown[]): Promise<NonNullable<PiHostResponse['result']>['resources']> {
    const response = await this.request('resources/reload', { resources })
    if (response.error || !response.result?.resources) throw new Error(response.error?.message || 'Pi resource reload failed')
    return response.result.resources
  }

  async listMemories(): Promise<NonNullable<PiHostResponse['result']>['memories']> {
    const response = await this.request('memory/list', {})
    if (response.error || !response.result?.memories) throw new Error(response.error?.message || 'Pi memory listing failed')
    return response.result.memories
  }

  async addMemory(memory: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['memories']> {
    const response = await this.request('memory/add', { memory })
    if (response.error || !response.result?.memories) throw new Error(response.error?.message || 'Pi memory write failed')
    return response.result.memories
  }

  async deleteMemory(id: string): Promise<NonNullable<PiHostResponse['result']>['memories']> {
    const response = await this.request('memory/delete', { id })
    if (response.error || !response.result?.memories) throw new Error(response.error?.message || 'Pi memory deletion failed')
    return response.result.memories
  }

  async clearMemories(): Promise<NonNullable<PiHostResponse['result']>['memories']> {
    const response = await this.request('memory/clear', {})
    if (response.error || !response.result?.memories) throw new Error(response.error?.message || 'Pi memory clear failed')
    return response.result.memories
  }

  async recallMemory(query: string, project?: string, limit?: number): Promise<NonNullable<PiHostResponse['result']>['memories']> {
    const response = await this.request('memory/recall', { query, ...(project ? { project } : {}), ...(limit === undefined ? {} : { limit }) })
    if (response.error || !response.result?.memories) throw new Error(response.error?.message || 'Pi memory recall failed')
    return response.result.memories
  }

  async listCapabilities(): Promise<NonNullable<PiHostResponse['result']>['items']> {
    const response = await this.request('capabilities/list', {})
    if (response.error || !response.result?.items) throw new Error(response.error?.message || 'Pi capability listing failed')
    return response.result.items
  }

  async loadCapability(id: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('capabilities/load', { id })
    if (response.error || !response.result?.loaded) throw new Error(response.error?.message || 'Pi capability load failed')
    return response.result
  }

  async searchCapabilities(query: string): Promise<NonNullable<PiHostResponse['result']>['items']> {
    const response = await this.request('capabilities/search', { query })
    if (response.error || !response.result?.items) throw new Error(response.error?.message || 'Pi capability search failed')
    return response.result.items
  }

  async listExtensions(): Promise<NonNullable<PiHostResponse['result']>['extensions']> {
    const response = await this.request('extensions/list', {})
    if (response.error || !response.result?.extensions) throw new Error(response.error?.message || 'Pi extension listing failed')
    return response.result.extensions
  }

  async mutateExtension(method: 'extensions/install' | 'extensions/update' | 'extensions/reload' | 'extensions/set-enabled' | 'extensions/uninstall', params: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request(method, params)
    if (response.error || (!response.result?.extension && method !== 'extensions/uninstall')) throw new Error(response.error?.message || 'Pi extension operation failed')
    return response.result || {}
  }

  async forkSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/fork', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session fork failed')
    return response.result
  }

  async resetSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/reset', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session reset failed')
    return response.result
  }

  async archiveSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/archive', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session archive failed')
    return response.result
  }

  async compactSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/compact', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session compaction failed')
    return response.result
  }

  async executeTool(tool: 'read' | 'grep' | 'find' | 'ls' | 'write' | 'edit' | 'bash' | 'code' | 'mcp', params: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request(`tools/${tool}`, params)
    if (response.error || !response.result?.tool) throw new Error(response.error?.message || `Pi ${tool} failed`)
    return response.result
  }

  async listTools(): Promise<string[]> {
    const response = await this.request('tools/list', {})
    if (response.error || !response.result?.builtinTools) throw new Error(response.error?.message || 'Pi tool listing failed')
    return response.result.builtinTools
  }

  async submitTurn(sessionId: string, prompt: string, runId?: string, cwd?: string, profile?: Record<string, unknown>, orchestration?: { contextPolicy?: Record<string, unknown>; pattern?: string; maxIterations?: number; definitionOfDone?: string; timeoutMs?: number; mode?: 'steer' | 'queue'; queue?: boolean; pluginExecution?: unknown }): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/submit', { sessionId, prompt, ...(runId ? { runId } : {}), ...(cwd ? { cwd } : {}), ...(profile ? { profile } : {}), ...(orchestration || {}) })
    if (response.error || !response.result?.settlement) throw new Error(response.error?.message || 'Pi turn failed')
    return response.result
  }

  async cancelTurn(runId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/cancel', { runId })
    if (response.error || response.result?.settlement !== 'cancelled') throw new Error(response.error?.message || 'Pi turn cancellation failed')
    return response.result
  }

  /**
   * Ask a turn to park at its next tool boundary.
   *
   * Unlike `cancelTurn` this never severs a tool that is already running, so a
   * write or a shell command completes and reports its own evidence.
   */
  async interruptTurn(runId: string, reason: 'user' | 'timeout' = 'user'): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/interrupt', { runId, reason })
    if (response.error || response.result?.settlement !== 'interrupted') throw new Error(response.error?.message || 'Pi turn interrupt failed')
    return response.result
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    for (const waiter of this.pending.values()) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.reject(new Error('Pi Core Host stopped'))
    }
    this.pending.clear()
    this.child?.kill()
    this.child = null
    this.statusValue = { state: 'stopped' }
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer || this.restartAttempts >= 3) return
    const attempt = this.restartAttempts
    this.restartAttempts += 1
    const delayMs = Math.min(100 * (2 ** attempt), 2_000)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.stopping || this.statusValue.state !== 'crashed') return
      void this.start().catch(() => this.scheduleRestart())
    }, delayMs)
  }

  private request(method: PiHostRequest['method'], params: Record<string, unknown>): Promise<PiHostResponse> {
    const child = this.child
    if (!child) return Promise.reject(new Error('Pi Core Host is not running'))
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timeoutMs = method === 'turn/submit' ? this.turnIdleTimeoutMs : this.requestTimeoutMs
      const waiter: PendingRequest = {
        resolve,
        reject,
        method,
        runId: typeof params.runId === 'string' ? params.runId : undefined,
        timeoutMs,
      }
      this.pending.set(id, waiter)
      this.armDeadline(id, waiter)
      child.postMessage({ id, method, params })
    })
  }

  private armDeadline(id: string | number, waiter: PendingRequest): void {
    if (waiter.timer) clearTimeout(waiter.timer)
    waiter.timer = setTimeout(() => {
      if (this.pending.get(id) !== waiter) return
      this.pending.delete(id)
      waiter.reject(new Error(`Pi Core Host ${waiter.method} timed out after ${waiter.timeoutMs}ms`))
      if (waiter.method === 'turn/submit' && waiter.runId && this.child) {
        this.child.postMessage({
          id: this.nextRequestId++,
          method: 'turn/cancel',
          params: { runId: waiter.runId },
        })
      }
    }, waiter.timeoutMs)
  }

  private refreshTurnDeadline(runId: string): void {
    for (const [id, waiter] of this.pending) {
      if (waiter.method === 'turn/submit' && waiter.runId === runId) this.armDeadline(id, waiter)
    }
  }
}
