/**
 * The current request must appear in the prompt exactly once.
 *
 * Stateless compatibility paths carry the objective in their own "當前請求"
 * / "Current request" slot, so the thread bubble holding the same text must
 * be cut from replayed chat history. Pi Host is stateful: it must consume its
 * native session history instead of receiving a second renderer-built copy.
 *
 * Run: node --experimental-strip-types scripts/smoke-current-objective-dedupe.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildChatHistoryContext,
  dropCurrentObjectiveFromHistory,
  type ChatHistoryBubble,
} from '../src/agent/chatHistory.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8')

let passed = 0
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log(`  ✓ ${name}`)
    })
    .catch((e) => {
      console.error(`  ✗ ${name}`)
      throw e
    })
}

console.log('smoke-current-objective-dedupe')

const OBJECTIVE = '幫我把 README 的安裝章節改寫成三步驟'

function conversation(): ChatHistoryBubble[] {
  return [
    { role: 'user', content: '先看一下專案結構' },
    { role: 'assistant', content: '結構如下…' },
    { role: 'user', content: OBJECTIVE },
  ]
}

await test('trailing user bubble equal to the objective is cut', () => {
  const out = dropCurrentObjectiveFromHistory(conversation(), OBJECTIVE)
  assert.equal(out.length, 2)
  assert.equal(out.at(-1)?.role, 'assistant')
})

await test('a merely similar trailing message is kept (strict equality, zero false cuts)', () => {
  const bubbles = conversation()
  bubbles[2] = { role: 'user', content: `${OBJECTIVE}（補充：保留原標題）` }
  const out = dropCurrentObjectiveFromHistory(bubbles, OBJECTIVE)
  assert.equal(out.length, 3, 'near-miss content must never be deleted')
  assert.equal(out.at(-1)?.content, `${OBJECTIVE}（補充：保留原標題）`)
})

await test('an equal message that is not the trailing turn is kept', () => {
  const bubbles: ChatHistoryBubble[] = [
    { role: 'user', content: OBJECTIVE },
    { role: 'assistant', content: '已完成第一次' },
  ]
  const out = dropCurrentObjectiveFromHistory(bubbles, OBJECTIVE)
  assert.equal(out.length, 2, 'an earlier identical request is real history')
})

await test('trailing assistant / empty objective / empty history are no-ops', () => {
  const assistantTail: ChatHistoryBubble[] = [{ role: 'assistant', content: OBJECTIVE }]
  assert.equal(dropCurrentObjectiveFromHistory(assistantTail, OBJECTIVE).length, 1)
  assert.equal(dropCurrentObjectiveFromHistory(conversation(), '').length, 3)
  assert.equal(dropCurrentObjectiveFromHistory([], OBJECTIVE).length, 0)
  assert.equal(dropCurrentObjectiveFromHistory(undefined, OBJECTIVE).length, 0)
})

await test('system bubbles after the request do not hide it from the cut', () => {
  const bubbles: ChatHistoryBubble[] = [
    ...conversation(),
    { role: 'system', content: '專案指引：AGENTS.md' },
  ]
  const out = dropCurrentObjectiveFromHistory(bubbles, OBJECTIVE)
  assert.equal(out.length, 3)
  assert.ok(!out.some((b) => b.role === 'user' && b.content === OBJECTIVE))
  assert.equal(out.at(-1)?.role, 'system', 'non-chat bubbles are left where they were')
})

await test('history block built from the cut list mentions the objective zero times', () => {
  const block = buildChatHistoryContext(
    dropCurrentObjectiveFromHistory(conversation(), OBJECTIVE),
  )
  assert.equal(block.split(OBJECTIVE).length - 1, 0)
})

await test('Pi turn context leaves conversation history to the Host session', async () => {
  const { buildPiTurnContext, withPiTurnContext } = await import('../src/agent/piTurnContext.ts')
  const settings = {
    referenceChatHistory: true,
    sessionRecallEnabled: false,
  } as unknown as import('../src/agent/types.ts').LlmSettings
  const ctx = await buildPiTurnContext({
    objective: OBJECTIVE,
    settings,
    bubbles: conversation(),
    temporary: true,
  })
  assert.equal(
    ctx.assembled.split(OBJECTIVE).length - 1,
    0,
    'the packet must not replay the current request',
  )
  const prompt = withPiTurnContext(OBJECTIVE, ctx.assembled)
  assert.equal(
    prompt.split(OBJECTIVE).length - 1,
    1,
    'the objective belongs to the 當前請求 slot alone',
  )
  assert.doesNotMatch(prompt, /先看一下專案結構/, 'renderer bubbles must not duplicate Host history')
})

await test('a later Pi turn does not flatten an earlier turn into system context', async () => {
  const { buildPiTurnContext, withPiTurnContext } = await import('../src/agent/piTurnContext.ts')
  const settings = {
    referenceChatHistory: true,
    sessionRecallEnabled: false,
  } as unknown as import('../src/agent/types.ts').LlmSettings
  const second = '接著幫我補上疑難排解章節'
  const bubbles: ChatHistoryBubble[] = [
    ...conversation(),
    { role: 'assistant', content: '已改寫完成' },
    { role: 'user', content: second },
  ]
  const ctx = await buildPiTurnContext({
    objective: second,
    settings,
    bubbles,
    temporary: true,
  })
  const prompt = withPiTurnContext(second, ctx.assembled)
  assert.equal(prompt.split(second).length - 1, 1, 'turn 2 request appears once')
  assert.equal(prompt.split(OBJECTIVE).length - 1, 0, 'turn 1 stays in native Host history')
})

await test('drift guard: only stateless execution paths replay renderer history', () => {
  const chatHistory = read('src/agent/chatHistory.ts')
  assert.match(
    chatHistory,
    /export function dropCurrentObjectiveFromHistory/,
    'the shared helper owns the guard',
  )

  const piTurnContext = read('src/agent/piTurnContext.ts')
  assert.doesNotMatch(piTurnContext, /buildChatHistoryContext|dropCurrentObjectiveFromHistory/,
    'Pi Host must use its native structured history, not a renderer transcript')
  assert.doesNotMatch(piTurnContext, /bubbles\?: ChatHistoryBubble\[\]/,
    'the Pi context contract must not accept renderer-owned conversation history')

  const runDispatch = read('src/agent/runDispatch.ts')
  // Both runDispatch paths must feed the helper's OUTPUT into their history
  // block — merely importing it would let a refactor drop the cut silently.
  assert.match(
    runDispatch,
    /const history = dropCurrentObjectiveFromHistory\(thread\.bubbles, raw\)/,
    'external CLI history is built from the cut list',
  )
  assert.match(
    runDispatch,
    /buildChatHistoryContext\(\s*\n\s*dropCurrentObjectiveFromHistory\(/,
    'legacy builtin history is built from the cut list',
  )
  assert.ok(
    !/currentWasStored/.test(runDispatch),
    'the old inline CLI guard must be gone, not duplicated beside the helper',
  )
  // Nobody may hand raw thread bubbles straight to the history builder again.
  assert.ok(
    !/buildChatHistoryContext\(\s*thread\.bubbles/.test(runDispatch),
    'no path may replay the untrimmed transcript',
  )
})

console.log(`\n${passed} tests passed`)
