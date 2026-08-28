type HostServiceRequest = {
  event: 'host/service-request'
  payload: { id: string; service: string; input: Record<string, unknown> }
}

type HostServiceResponse = {
  event: 'host/service-response'
  payload: { id: string; result?: unknown; error?: string }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let publish: ((message: HostServiceRequest) => void) | undefined
let sequence = 0
const pending = new Map<string, Pending>()

export function configurePiHostServiceTransport(sender: (message: HostServiceRequest) => void): void {
  publish = sender
}

export function resolvePiHostServiceResponse(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<HostServiceResponse>
  if (candidate.event !== 'host/service-response' || !candidate.payload?.id) return false
  const waiter = pending.get(candidate.payload.id)
  if (!waiter) return true
  pending.delete(candidate.payload.id)
  clearTimeout(waiter.timer)
  if (candidate.payload.error) waiter.reject(new Error(candidate.payload.error))
  else waiter.resolve(candidate.payload.result)
  return true
}

export function requestPiHostService<T>(service: string, input: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  if (!publish) return Promise.reject(new Error(`Host service unavailable: ${service}`))
  const id = `host_service_${Date.now()}_${++sequence}`
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Host service timed out: ${service}`))
    }, timeoutMs)
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
    publish!({ event: 'host/service-request', payload: { id, service, input } })
  })
}
