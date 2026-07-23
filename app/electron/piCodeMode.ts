import * as vm from 'node:vm'

export type PiCodeModeResult = {
  settlement: 'success' | 'failed' | 'cancelled'
  content: string
  toolCallCount: number
  logs: string[]
}

export type PiCodeModeInput = {
  runId: string
  code: string
  activeTools: string[]
  maxToolCalls?: number
  timeoutMs?: number
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>
}

const activeRuns = new Map<string, { cancelled: boolean; timedOut: boolean; cancel: (reason?: Error, timedOut?: boolean) => void }>()
const FORBIDDEN_SOURCE = /\b(?:process|require|module|global|globalThis|Buffer|Deno|fetch|XMLHttpRequest|WebSocket|fs|net|child_process|worker_threads|import|eval|Function|constructor|__proto__|prototype)\b/i

export async function runPiCodeMode(input: PiCodeModeInput): Promise<PiCodeModeResult> {
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 90_000, 5_000), 300_000)
  const maxToolCalls = Math.min(Math.max(input.maxToolCalls ?? 25, 1), 100)
  const logs: string[] = []
  let toolCallCount = 0
  if (!input.code.trim()) return { settlement: 'failed', content: 'run_code requires non-empty code.', toolCallCount, logs }
  if (FORBIDDEN_SOURCE.test(input.code)) return { settlement: 'failed', content: 'CodeMode source references a blocked host/global API.', toolCallCount, logs }

  const run = { cancelled: false, timedOut: false, cancel: (_reason?: Error, _timedOut?: boolean) => undefined }
  activeRuns.set(input.runId, run)
  let rejectCancellation: ((error: Error) => void) | undefined
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject })
  run.cancel = (reason = new Error('Pi CodeMode cancelled'), timedOut = false) => {
    if (run.cancelled) return
    run.cancelled = true
    run.timedOut = timedOut
    rejectCancellation?.(reason)
  }
  const allowedTools = new Set(input.activeTools)
  const tools = new Proxy(Object.create(null) as Record<string, unknown>, {
    get: (_target, property) => async (args: Record<string, unknown> = {}) => {
      const name = String(property)
      if (run.cancelled) throw new Error('Pi CodeMode cancelled')
      if (!allowedTools.has(name)) throw new Error(`Tool «${name}» is not active in this Pi turn.`)
      if (toolCallCount >= maxToolCalls) throw new Error(`run_code tool budget exhausted (${maxToolCalls}).`)
      toolCallCount += 1
      logs.push(`run_code → tools.${name}`)
      return input.callTool(name, args)
    },
  })
  const context = vm.createContext({
    tools,
    log: (...values: unknown[]) => logs.push(values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').slice(0, 2_000)),
  }, { name: `pi-codemode-${input.runId}` })
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const script = new vm.Script(`(async () => {\n${input.code}\n})()`, { filename: `pi-codemode-${input.runId}.js` })
    const result = script.runInContext(context, { timeout: timeoutMs, displayErrors: false }) as Promise<unknown>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const timeoutError = new Error(`Pi CodeMode timed out after ${timeoutMs}ms`)
        run.cancel(timeoutError, true)
        reject(timeoutError)
      }, timeoutMs)
    })
    const value = await Promise.race([result, cancellation, timeoutPromise])
    const content = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
    clearTimeout(timeoutHandle)
    return { settlement: 'success', content, toolCallCount, logs }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { settlement: run.cancelled && !run.timedOut ? 'cancelled' : 'failed', content: message, toolCallCount, logs }
  } finally {
    clearTimeout(timeoutHandle)
    activeRuns.delete(input.runId)
  }
}

export function cancelPiCodeMode(runId: string): boolean {
  const run = activeRuns.get(runId)
  if (!run) return false
  run.cancel()
  return true
}
