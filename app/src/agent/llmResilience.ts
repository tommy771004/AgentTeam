/**
 * LLM 呼叫韌性層 — retry/backoff + per-provider circuit breaker。
 *
 * Breaker 演算法參考 Grok Build `xai-circuit-breaker`:
 * sliding-window-with-min-samples — `samples >= minSamples && errorRate >= threshold`
 * 才 trip;open 冷卻結束轉 half-open 放一次探測,成功即 close、失敗重新 open。
 *
 * 純邏輯、時鐘可注入;smoke-caps.mjs 鏡射同一狀態機驗證。
 * open 時 fail-fast 丟 LlmCircuitOpenError,engine 既有的
 * 「LLM step failed → simulation」路徑會接手降級,不會卡住重試。
 */

export interface BreakerConfig {
  /** 統計錯誤率的滑動視窗(ms) */
  windowMs: number
  /** 視窗內至少要有幾筆樣本才允許 trip(避免單一錯誤誤殺) */
  minSamples: number
  /** 視窗內錯誤率 ≥ 此值才 trip(0–1) */
  errorRateThreshold: number
  /** open 後多久允許 half-open 探測(ms) */
  cooldownMs: number
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  windowMs: 60_000,
  minSamples: 5,
  errorRateThreshold: 0.5,
  cooldownMs: 30_000,
}

export type BreakerState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private readonly cfg: BreakerConfig
  private readonly now: () => number
  private samples: Array<{ at: number; ok: boolean }> = []
  private state: BreakerState = 'closed'
  private openedAt = 0
  private probing = false

  constructor(cfg?: Partial<BreakerConfig>, now: () => number = Date.now) {
    this.cfg = { ...DEFAULT_BREAKER_CONFIG, ...cfg }
    this.now = now
  }

  private evict(at: number) {
    const cutoff = at - this.cfg.windowMs
    while (this.samples.length && this.samples[0].at < cutoff) this.samples.shift()
  }

  /** 呼叫前檢查;open 冷卻中回 false,冷卻結束轉 half-open 放一次探測。 */
  allowRequest(): boolean {
    const at = this.now()
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (at - this.openedAt >= this.cfg.cooldownMs) {
        this.state = 'half-open'
        this.probing = true
        return true
      }
      return false
    }
    // half-open:探測中不再放行第二個請求
    if (this.probing) return false
    this.probing = true
    return true
  }

  record(ok: boolean): void {
    const at = this.now()
    if (this.state === 'half-open') {
      this.probing = false
      if (ok) {
        this.state = 'closed'
        this.samples = []
      } else {
        this.state = 'open'
        this.openedAt = at
      }
      return
    }
    this.samples.push({ at, ok })
    this.evict(at)
    if (this.state === 'closed') {
      const n = this.samples.length
      if (n >= this.cfg.minSamples) {
        const errors = this.samples.filter((s) => !s.ok).length
        if (errors / n >= this.cfg.errorRateThreshold) {
          this.state = 'open'
          this.openedAt = at
        }
      }
    }
  }

  currentState(): BreakerState {
    // 讓 UI/log 讀到冷卻結束的狀態,但不佔用探測名額
    if (this.state === 'open' && this.now() - this.openedAt >= this.cfg.cooldownMs) {
      return 'half-open'
    }
    return this.state
  }

  /** open 剩餘冷卻毫秒(非 open 回 0) */
  cooldownRemainingMs(): number {
    if (this.state !== 'open') return 0
    return Math.max(0, this.cfg.cooldownMs - (this.now() - this.openedAt))
  }

  snapshot(): { state: BreakerState; samples: number; errorRate: number } {
    const n = this.samples.length
    const errors = this.samples.filter((s) => !s.ok).length
    return {
      state: this.currentState(),
      samples: n,
      errorRate: n ? errors / n : 0,
    }
  }
}

export class LlmCircuitOpenError extends Error {
  readonly providerKey: string
  readonly retryInMs: number

  constructor(providerKey: string, retryInMs: number) {
    super(
      `LLM circuit open for ${providerKey} — provider 近期錯誤率過高,暫停呼叫 ${Math.ceil(retryInMs / 1000)}s 後自動探測(降級路徑接手)`,
    )
    this.name = 'LlmCircuitOpenError'
    this.providerKey = providerKey
    this.retryInMs = retryInMs
  }
}

/** 從錯誤訊息判斷是否可重試(429/408/5xx 或網路層錯誤)。 */
export function isRetryableLlmError(message: string): boolean {
  const m = /HTTP (\d{3})/.exec(message)
  if (m) {
    const status = Number(m[1])
    return status === 429 || status === 408 || status >= 500
  }
  return /network|failed to fetch|fetch failed|timeout|timed out|econn|enotfound|eai_again|socket|und_err|aborted/i.test(
    message,
  )
}

/** 解析 llm.ts 內嵌的 `(retry-after:Ns)` 提示。 */
export function parseRetryAfterMs(message: string): number | undefined {
  const m = /retry-after:(\d+)s/.exec(message)
  if (!m) return undefined
  const s = Number(m[1])
  return s > 0 ? s * 1000 : undefined
}

/**
 * 指數退避:attempt 0/1/2 → 2s/4s/8s(+jitter ≤250ms,封頂 16s);
 * server 給 Retry-After 時優先(封頂 30s)。
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterMs?: number,
  jitter: () => number = Math.random,
): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000)
  const exp = 2000 * 2 ** Math.max(0, attempt)
  return Math.min(exp, 16_000) + Math.floor(jitter() * 250)
}

/** provider 級 breaker key(同 baseUrl 共用一個 breaker)。 */
export function breakerKey(baseUrl: string | undefined, provider?: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  return base || provider || 'default'
}

const registry = new Map<string, CircuitBreaker>()

export function breakerFor(key: string): CircuitBreaker {
  let b = registry.get(key)
  if (!b) {
    b = new CircuitBreaker()
    registry.set(key, b)
  }
  return b
}

/** Settings 頁/診斷用:所有 provider breaker 現況。 */
export function allBreakerSnapshots(): Array<{
  key: string
  state: BreakerState
  samples: number
  errorRate: number
}> {
  return [...registry.entries()].map(([key, b]) => ({ key, ...b.snapshot() }))
}

/** 測試隔離用。 */
export function resetBreakers(): void {
  registry.clear()
}

export interface ResilienceOptions {
  /** 含首次呼叫的最大嘗試次數(1 = 不重試) */
  maxAttempts?: number
  breakerEnabled?: boolean
  /** retry / breaker 事件回報(進 run log) */
  onEvent?: (message: string) => void
  /** 測試注入 */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 包住一次 LLM 呼叫:breaker gate → 呼叫 → 記錄樣本 → 可重試錯誤退避重試。
 * 不可重試錯誤(400/401/403…)原樣拋出,不消耗重試額度。
 */
export async function callWithResilience<T>(
  key: string,
  attempt: () => Promise<T>,
  opts?: ResilienceOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(6, opts?.maxAttempts ?? 3))
  const breakerEnabled = opts?.breakerEnabled !== false
  const sleep = opts?.sleep || defaultSleep
  const breaker = breakerFor(key)

  let lastError: unknown = null
  for (let i = 0; i < maxAttempts; i++) {
    if (breakerEnabled && !breaker.allowRequest()) {
      const err = new LlmCircuitOpenError(key, breaker.cooldownRemainingMs())
      opts?.onEvent?.(err.message)
      throw err
    }
    try {
      const result = await attempt()
      breaker.record(true)
      return result
    } catch (e) {
      breaker.record(false)
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      if (!isRetryableLlmError(msg) || i === maxAttempts - 1) throw e
      const backoff = computeBackoffMs(i, parseRetryAfterMs(msg))
      opts?.onEvent?.(
        `LLM 呼叫失敗(${msg.slice(0, 120)});${Math.round(backoff / 1000)}s 後重試(${i + 2}/${maxAttempts})`,
      )
      await sleep(backoff)
    }
  }
  // maxAttempts ≥ 1 保證迴圈內必 return 或 throw;此行僅為型別完備
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
