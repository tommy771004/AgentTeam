import type { PiHostRequest, PiHostResponse } from './piHostProtocol.ts'

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

export class PiHostSupervisor {
  private readonly fork: PiHostFork
  private child: PiHostChild | null = null
  private nextRequestId = 1
  private statusValue: PiHostStatus = { state: 'stopped' }
  private readonly pending = new Map<
    string | number,
    { resolve: (response: PiHostResponse) => void; reject: (error: Error) => void }
  >()

  constructor(fork: PiHostFork) {
    this.fork = fork
  }

  status(): PiHostStatus {
    return this.statusValue
  }

  async start(): Promise<PiHostStatus> {
    if (this.statusValue.state === 'ready') return this.statusValue
    this.statusValue = { state: 'starting' }
    const child = this.fork()
    this.child = child
    child.on('message', (message: PiHostResponse & { event?: string }) => {
      if (message.event) return
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      waiter.resolve(message)
    })
    child.on('exit', (code: number | null, signal?: number) => {
      this.child = null
      this.statusValue = { state: 'crashed', exitCode: code, signal }
      for (const waiter of this.pending.values()) waiter.reject(new Error('Pi Core Host exited'))
      this.pending.clear()
    })
    child.on('error', (error: Error) => {
      this.statusValue = { state: 'error', message: error.message }
    })

    const response = await this.request('initialize', { protocolVersion: 1, client: 'subagents-electron' })
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
    return this.statusValue
  }

  async health(): Promise<PiHostResponse['result']> {
    const response = await this.request('health/get', {})
    if (response.error || !response.result) throw new Error(response.error?.message || 'Pi Host health failed')
    return response.result
  }

  async getSettings(): Promise<NonNullable<PiHostResponse['result']>['settings']> {
    const response = await this.request('settings/get', {})
    if (response.error || !response.result?.settings) throw new Error(response.error?.message || 'Pi Host settings failed')
    return response.result.settings
  }

  async updateSettings(patch: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['settings']> {
    const response = await this.request('settings/update', patch)
    if (response.error || !response.result?.settings) throw new Error(response.error?.message || 'Pi Host settings update failed')
    return response.result.settings
  }

  async profile(role?: Record<string, unknown>, taskOverride?: Record<string, unknown>): Promise<NonNullable<PiHostResponse['result']>['profile']> {
    const response = await this.request('settings/profile', { role: role || {}, taskOverride: taskOverride || {} })
    if (response.error || !response.result?.profile) throw new Error(response.error?.message || 'Pi Host profile failed')
    return response.result.profile
  }

  async createSession(title?: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/create', title ? { title } : {})
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session creation failed')
    return response.result
  }

  async listSessions(): Promise<NonNullable<PiHostResponse['result']>['sessions']> {
    const response = await this.request('sessions/list', {})
    if (response.error || !response.result?.sessions) throw new Error(response.error?.message || 'Pi session listing failed')
    return response.result.sessions
  }

  async forkSession(sessionId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('sessions/fork', { sessionId })
    if (response.error || !response.result?.sessionId) throw new Error(response.error?.message || 'Pi session fork failed')
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

  async submitTurn(sessionId: string, prompt: string, runId?: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/submit', { sessionId, prompt, ...(runId ? { runId } : {}) })
    if (response.error || !response.result?.settlement) throw new Error(response.error?.message || 'Pi turn failed')
    return response.result
  }

  async cancelTurn(runId: string): Promise<NonNullable<PiHostResponse['result']>> {
    const response = await this.request('turn/cancel', { runId })
    if (response.error || response.result?.settlement !== 'cancelled') throw new Error(response.error?.message || 'Pi turn cancellation failed')
    return response.result
  }

  stop(): void {
    for (const waiter of this.pending.values()) waiter.reject(new Error('Pi Core Host stopped'))
    this.pending.clear()
    this.child?.kill()
    this.child = null
    this.statusValue = { state: 'stopped' }
  }

  private request(method: PiHostRequest['method'], params: Record<string, unknown>): Promise<PiHostResponse> {
    const child = this.child
    if (!child) return Promise.reject(new Error('Pi Core Host is not running'))
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ id, method, params })
    })
  }
}
