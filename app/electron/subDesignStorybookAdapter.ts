import {
  STORYBOOK_PINNED_VERSION,
  getStorybookContext,
  storybookAvailability,
  toProviderEvidence,
  type RawStorybookResponse,
} from '../src/agent/subdesign/providers/storybookProvider.ts'
import type { SubDesignPluginExecutionRequest, SubDesignPluginExecutionProjection } from '../src/agent/subdesign/pluginExecution.ts'
import type { ProviderEvidence, ProviderExecutionReceipt } from '../src/agent/subdesign/providers/providerContract.ts'
import { createHash } from 'node:crypto'

export type StorybookAdapterOutcome = {
  receipt: ProviderExecutionReceipt
  evidence: readonly ProviderEvidence[]
  context?: NonNullable<SubDesignPluginExecutionProjection['context']>
}

function safeEndpoint(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:') return null
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return null
    url.username = ''
    url.password = ''
    url.pathname = '/index.json'
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function normalizeIndexPayload(raw: unknown): RawStorybookResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  if (Array.isArray(record.components)) return { components: record.components, version: typeof record.version === 'string' ? record.version : undefined }
  const entries = record.entries && typeof record.entries === 'object' && !Array.isArray(record.entries)
    ? Object.values(record.entries as Record<string, unknown>)
    : []
  const components = entries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .filter((entry) => entry.type === 'story' || entry.type === 'docs')
    .map((entry) => ({
      id: entry.id,
      title: entry.title || entry.name,
      docs: typeof entry.description === 'string' ? entry.description : undefined,
      controls: Array.isArray(entry.controls) ? entry.controls : undefined,
    }))
  return { components, version: typeof record.v === 'number' ? String(record.v) : undefined }
}

export async function executeStorybookContextAdapter(input: {
  request: SubDesignPluginExecutionRequest
  runId: string
  signal: AbortSignal
  timeoutMs: number
}): Promise<StorybookAdapterOutcome> {
  const startedAt = new Date().toISOString()
  const config = input.request.providerConfig
  const finish = (kind: ProviderExecutionReceipt['kind'], summary: string): ProviderExecutionReceipt => ({
    providerId: 'storybook',
    runId: input.runId,
    stageId: input.request.stageId,
    kind,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
  })
  const availability = storybookAvailability(config?.enabled)
  if (!availability.available) return { receipt: finish('blocked', availability.reason), evidence: [] }
  if (!config) return { receipt: finish('blocked', 'Storybook provider config 缺失。'), evidence: [] }
  if (config.resolvedVersion !== STORYBOOK_PINNED_VERSION) {
    return { receipt: finish('blocked', `Storybook version 必須固定為 ${STORYBOOK_PINNED_VERSION}。`), evidence: [] }
  }
  const endpoint = safeEndpoint(config.endpoint)
  if (!endpoint) return { receipt: finish('blocked', 'Storybook endpoint 必須是 localhost HTTP。'), evidence: [] }
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(input.timeoutMs, 60_000)))
  const signal = AbortSignal.any([input.signal, timeout])
  try {
    const response = await fetch(endpoint, { signal, headers: { accept: 'application/json' }, redirect: 'error' })
    if (!response.ok) return { receipt: finish('blocked', `Storybook unavailable: HTTP ${response.status}`), evidence: [] }
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > 1_048_576) return { receipt: finish('blocked', 'Storybook response 超過 1 MiB 上限。'), evidence: [] }
    const body = await response.text()
    if (new TextEncoder().encode(body).length > 1_048_576) return { receipt: finish('blocked', 'Storybook response 超過 1 MiB 上限。'), evidence: [] }
    const raw = normalizeIndexPayload(JSON.parse(body))
    const sourceFingerprint = createHash('sha256').update(body).digest('hex')
    const result = getStorybookContext(input.request.pluginId, raw, sourceFingerprint)
    if (!result.evidence.components.length) return { receipt: finish('blocked', 'Storybook 沒有可用 stories；將使用 local artifacts。'), evidence: [] }
    const evidence = toProviderEvidence(result.evidence, input.runId)
    return {
      receipt: finish('success', `${result.evidence.summary}${result.fromCache ? ' · cache' : ''}`),
      evidence: [evidence],
      context: {
        kind: 'storybook-components',
        summary: result.evidence.summary,
        providerVersion: result.evidence.version,
        capturedAt: result.evidence.capturedAt,
        components: result.evidence.components,
        sourceFingerprint: result.evidence.sourceFingerprint,
        truncated: result.evidence.truncated,
      },
    }
  } catch (error) {
    if (input.signal.aborted) return { receipt: finish('cancelled', 'Storybook context collection cancelled.'), evidence: [] }
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? `Storybook timeout after ${input.timeoutMs}ms；將使用 local artifacts。`
      : `Storybook unavailable；將使用 local artifacts。${error instanceof Error ? ` ${error.message}` : ''}`
    return { receipt: finish('blocked', reason), evidence: [] }
  }
}
