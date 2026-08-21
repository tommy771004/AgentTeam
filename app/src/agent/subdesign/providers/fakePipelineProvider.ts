/**
 * Deterministic SubDesign pipeline provider.
 *
 * This is the SHIPPED default whenever no external provider is enabled, not a
 * test-only double: with Storybook / DevTools / Harness off, a contract-driven
 * stage still runs, produces a real artifact and adapter-issued evidence, and
 * settles through the normal path. It performs no external I/O, so its output
 * is reproducible — which is also why the smokes use it.
 *
 * Implements ProviderContract for a single pipeline stage, budget/timeout/
 * cancel aware. Provider success is never DoD met (see runners contract).
 */
import {
  type ProviderExecutionReceipt,
  type ProviderHandle,
  type ProviderOptions,
  type ProviderSession,
  checkOutputBudget,
  DEFAULT_OUTPUT_BUDGET_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  issueProviderEvidence,
} from './providerContract.ts'

export type FakePipelineInput = {
  stageId: string
  atoms?: string[]
  objective?: string
  /** Host-resolved plugin inputs; already validated against the contract. */
  inputs?: Record<string, string | number | boolean>
}

export function createFakePipelineProvider() {
  const active = new Map<string, { abort: AbortController; timeout?: ReturnType<typeof setTimeout> }>()

  function keyOf(runId: string, stageId: string) {
    return `${runId}:${stageId}`
  }

  async function checkAvailability(): Promise<{ available: true } | { available: false; reason: string }> {
    return { available: true }
  }

  function execute(input: FakePipelineInput, opts: ProviderOptions): ProviderSession {
    const abort = new AbortController()
    const external = opts.signal
    const onExternalAbort = () => abort.abort()
    external.addEventListener('abort', onExternalAbort, { once: true })

    const k = keyOf(opts.runId, input.stageId)
    active.set(k, { abort })

    const startedAt = new Date().toISOString()

    const promise = new Promise<ProviderExecutionReceipt>((resolve) => {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
      const budget = opts.outputBudgetBytes ?? DEFAULT_OUTPUT_BUDGET_BYTES
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        external.removeEventListener('abort', onExternalAbort)
        active.delete(k)
        resolve({
          providerId: 'fake-pipeline',
          runId: opts.runId,
          stageId: input.stageId,
          kind: 'blocked',
          startedAt,
          finishedAt: new Date().toISOString(),
          summary: `Provider timeout after ${timeoutMs}ms（stage=${input.stageId}）`,
        })
      }, timeoutMs)

      // Simulate async work
      const workMs = 10

      const finish = (kind: ProviderExecutionReceipt['kind'], summary: string, evidenceLocator?: string, artifactLocator?: string) => {
        clearTimeout(timer)
        external.removeEventListener('abort', onExternalAbort)
        active.delete(k)
        const rawSummary = summary
        const budgetCheck = checkOutputBudget(rawSummary, budget)
        resolve({
          providerId: 'fake-pipeline',
          runId: opts.runId,
          stageId: input.stageId,
          kind,
          startedAt,
          finishedAt: new Date().toISOString(),
          summary: budgetCheck.ok ? rawSummary : budgetCheck.truncated!,
          truncated: !budgetCheck.ok,
          evidenceLocator,
          artifactLocator,
        })
      }

      abort.signal.addEventListener('abort', () => {
        if (timedOut) return
        clearTimeout(timer)
        external.removeEventListener('abort', onExternalAbort)
        active.delete(k)
        resolve({
          providerId: 'fake-pipeline',
          runId: opts.runId,
          stageId: input.stageId,
          kind: 'cancelled',
          startedAt,
          finishedAt: new Date().toISOString(),
          summary: '已取消（provider session targeted cancel）',
        })
      })

      setTimeout(() => {
        if (abort.signal.aborted) return
        // Deterministic success path
        if (input.stageId === 'fail') {
          finish('failure', 'stage 失敗：模擬錯誤')
          return
        }
        if (input.stageId === 'blocked') {
          finish('blocked', 'stage blocked：缺少必要輸入')
          return
        }
        if (input.stageId === 'malformed-evidence') {
          // This still returns provider success, but evidence will be malformed and must be rejected by adapter guard
          finish('success', 'provider success 但 evidence 為 malformed', 'evidence/malformed.json', 'artifacts/stage.json')
          return
        }
        finish('success', `stage ${input.stageId} 完成`, `evidence/${opts.runId}/${input.stageId}.json`, `artifacts/${opts.runId}/${input.stageId}/entry.html`)
      }, workMs)
    })

    const evidence = promise.then((receipt) => {
      if (receipt.kind !== 'success' || input.stageId === 'malformed-evidence') return []
      return [issueProviderEvidence({
        evidenceId: `ev_${opts.runId}_${input.stageId}`,
        runId: opts.runId,
        stageId: input.stageId,
        providerId: 'fake-pipeline',
        kind: 'execution',
        summary: `adapter-issued evidence for ${input.stageId}`,
        capturedAt: new Date().toISOString(),
        projectRelativeLocator: `evidence/${opts.runId}/${input.stageId}.json`,
        severity: 'info',
      })]
    })

    const handle: ProviderHandle = {
      providerId: 'fake-pipeline',
      runId: opts.runId,
      stageId: input.stageId,
      cancel: async () => {
        const entry = active.get(k)
        if (!entry) return { cancelled: false, reason: 'no active session' }
        entry.abort.abort()
        return { cancelled: true }
      },
    }

    return { handle, promise, evidence }
  }

  async function cancel(runId: string, stageId?: string): Promise<{ cancelled: boolean }> {
    if (stageId) {
      const k = keyOf(runId, stageId)
      const entry = active.get(k)
      if (!entry) return { cancelled: false }
      entry.abort.abort()
      return { cancelled: true }
    }
    // cancel all for runId
    let cancelled = false
    for (const [k, entry] of active.entries()) {
      if (k.startsWith(`${runId}:`)) {
        entry.abort.abort()
        cancelled = true
      }
    }
    return { cancelled }
  }

  return { checkAvailability, execute, cancel, _active: active }
}

export const fakePipelineProvider = createFakePipelineProvider()
