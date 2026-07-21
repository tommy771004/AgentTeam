/**
 * Company Classification Endpoint — ticket 08.
 * Seam: callCompanyClassifier with injectable fetch (exact URL, retries, additive only).
 * Run: node --experimental-strip-types scripts/smoke-company-classifier.mts
 */
import assert from 'node:assert/strict'
import {
  callCompanyClassifier,
  mergeAdditiveExclusions,
  syntheticClassifierTestRequest,
  type FetchLike,
} from '../src/agent/outbound/companyClassifier.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-company-classifier')

function mockFetch(handler: (url: string, init: Parameters<FetchLike>[1]) => Promise<{
  ok: boolean
  status: number
  json?: unknown
  text?: string
}>): FetchLike {
  return async (url, init) => {
    const r = await handler(url, init)
    return {
      ok: r.ok,
      status: r.status,
      headers: { get: () => null },
      json: async () => r.json,
      text: async () => r.text || '',
    }
  }
}

const endpoint = 'https://classify.corp.example/v1'
const baseReq = {
  providerId: 'llm:test',
  sourceKind: 'prompt' as const,
  sourceName: 'user',
  chunk: 'hello',
  locator: { startLine: 1, endLine: 2 },
}

await test('POSTs exact URL without appending route; redirect denied via redirect:error', async () => {
  let seen = ''
  let redirectMode = ''
  const r = await callCompanyClassifier({
    endpointUrl: endpoint,
    request: baseReq,
    fetchImpl: mockFetch(async (url, init) => {
      seen = url
      redirectMode = init.redirect
      return { ok: true, status: 200, json: { exclusions: [{ startLine: 3, endLine: 3 }] } }
    }),
  })
  assert.equal(seen, endpoint)
  assert.equal(redirectMode, 'error')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.exclusions[0].startLine, 3)
})

await test('response cannot remove baseline — invalid schema fails closed', async () => {
  const r = await callCompanyClassifier({
    endpointUrl: endpoint,
    request: baseReq,
    fetchImpl: mockFetch(async () => ({
      ok: true,
      status: 200,
      json: { exclusions: [], removeExclusions: ['baseline.api-key'] },
    })),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.status, 'config_error')
})

await test('retries only transient 5xx up to 3 total attempts', async () => {
  let n = 0
  const r = await callCompanyClassifier({
    endpointUrl: endpoint,
    request: baseReq,
    sleep: async () => {},
    fetchImpl: mockFetch(async () => {
      n++
      return { ok: false, status: 503, text: 'busy' }
    }),
  })
  assert.equal(n, 3)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /baseline|unavailable|attempts/i)
})

await test('4xx auth does not retry', async () => {
  let n = 0
  const r = await callCompanyClassifier({
    endpointUrl: endpoint,
    request: baseReq,
    auth: { type: 'bearer', token: 'x' },
    fetchImpl: mockFetch(async () => {
      n++
      return { ok: false, status: 401, text: 'nope' }
    }),
  })
  assert.equal(n, 1)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.status, 'config_error')
})

await test('HTTP requires allowPlaintextHttp; HTTPS default ok', async () => {
  const denied = await callCompanyClassifier({
    endpointUrl: 'http://classify.corp.example/v1',
    request: baseReq,
    fetchImpl: mockFetch(async () => ({ ok: true, status: 200, json: { exclusions: [] } })),
  })
  assert.equal(denied.ok, false)

  const allowed = await callCompanyClassifier({
    endpointUrl: 'http://classify.corp.example/v1',
    request: baseReq,
    allowPlaintextHttp: true,
    fetchImpl: mockFetch(async () => ({ ok: true, status: 200, json: { exclusions: [] } })),
  })
  assert.equal(allowed.ok, true)
  if (allowed.ok) assert.equal(allowed.transport, 'http')
})

await test('mergeAdditiveExclusions never drops baseline entries', () => {
  const base = [{ startLine: 1, endLine: 1 }]
  const merged = mergeAdditiveExclusions(base, [{ startLine: 5, endLine: 5 }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].startLine, 1)
})

await test('synthetic connection test has no user project content', () => {
  const t = syntheticClassifierTestRequest('llm:x')
  assert.match(t.chunk, /SYNTHETIC/)
  assert.doesNotMatch(t.chunk, /\/Users\/|password|api_key/i)
  assert.equal(t.sourceName, 'connection-test')
})

await test('missing endpoint degrades to baseline path', async () => {
  const r = await callCompanyClassifier({
    endpointUrl: '',
    request: baseReq,
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.status, 'degraded')
})

console.log(`\n${passed} tests passed`)
