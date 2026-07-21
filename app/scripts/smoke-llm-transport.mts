/**
 * Loop Runner deepening — ticket 01: LlmTransport seam.
 * Seam: setLlmTransport(t?) injects below sanitize → gate inside chatCompletionWithTools;
 *   undefined restores the default window.subagents.llm.chat / fetch selection.
 * Run: node --experimental-strip-types scripts/smoke-llm-transport.mts
 */
import assert from 'node:assert/strict'
import {
  chatCompletionWithTools,
  DEFAULT_LLM_SETTINGS,
  setLlmTransport,
  type LlmTransportRequest,
} from '../src/agent/llm.ts'
import { PROTECTED_EXCLUSION_MARKER } from '../src/agent/outbound/textSanitize.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  } finally {
    setLlmTransport(undefined)
  }
}

console.log('smoke-llm-transport')

const baseSettings = {
  ...DEFAULT_LLM_SETTINGS,
  enabled: true,
  apiKey: 'test-key',
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:9',
}

await test('fake transport receives the call and its result flows back unchanged', async () => {
  let calls = 0
  let received: LlmTransportRequest | null = null
  setLlmTransport(async (req) => {
    calls++
    received = req
    return { content: 'from-fake', tokensUsed: 7, model: 'fake-model', toolCalls: [] }
  })
  const r = await chatCompletionWithTools(
    { ...baseSettings, outboundGuardDeploy: 'off' as const },
    [{ role: 'user', content: 'hi' }],
    [],
  )
  assert.equal(calls, 1, 'transport must be called exactly once')
  assert.equal(r.content, 'from-fake')
  assert.equal(r.tokensUsed, 7)
  assert.ok(received, 'transport must receive a request')
  assert.equal(received!.body.model, 'test-model')
})

await test('seam sits below sanitize → gate: fake sees redacted body under required protection', async () => {
  let receivedText = ''
  setLlmTransport(async (req) => {
    receivedText = JSON.stringify(req.body.messages)
    return { content: 'ok', tokensUsed: 0, model: 'fake-model', toolCalls: [] }
  })
  const secret = 'sk-live-ABCDEFG1234567890'
  await chatCompletionWithTools(
    { ...baseSettings, outboundGuardDeploy: 'required' as const },
    [{ role: 'user', content: `api_key: ${secret}` }],
    [],
  )
  assert.ok(!receivedText.includes(secret), 'raw secret must not reach the transport')
  assert.ok(
    receivedText.includes(PROTECTED_EXCLUSION_MARKER),
    'redaction marker must be present in what the transport receives',
  )
})

await test('setLlmTransport(undefined) restores default window.subagents.llm.chat selection', async () => {
  setLlmTransport(undefined)
  let ipcCalls = 0
  const g = globalThis as typeof globalThis & {
    window?: { subagents?: { llm?: { chat: (body: unknown) => Promise<unknown> } } }
  }
  const prevWindow = g.window
  g.window = {
    subagents: {
      llm: {
        chat: async () => {
          ipcCalls++
          return { content: 'from-ipc', tokensUsed: 3, model: 'ipc-model', toolCalls: [] }
        },
      },
    },
  }
  try {
    const r = await chatCompletionWithTools(
      { ...baseSettings, outboundGuardDeploy: 'off' as const },
      [{ role: 'user', content: 'hi again' }],
      [],
    )
    assert.equal(ipcCalls, 1, 'default transport must pick window.subagents.llm.chat when present')
    assert.equal(r.content, 'from-ipc')
  } finally {
    g.window = prevWindow
  }
})

console.log(`\n${passed} tests passed`)
