import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  appendPiPublicCommentaryGuidance,
  piAssistantTextSegments,
} from '../electron/piPublicCommentary.ts'
import { conversationAnswer, projectConversationRows } from '../src/agent/conversationProjection.ts'
import { runTimelineRows } from '../src/agent/liveTimeline.ts'
import { appendTurnRecord, parseTurnRecord } from '../src/agent/turnRecord.ts'

const commentarySignature = JSON.stringify({ v: 1, id: 'msg-commentary', phase: 'commentary' })
const finalSignature = JSON.stringify({ v: 1, id: 'msg-final', phase: 'final_answer' })

// OpenAI Codex Responses carries public assistant phases in the text block's
// signature. Thinking is private and must never be promoted into the public
// conversation merely because it contains a useful-looking progress label.
const commentary = piAssistantTextSegments([
  { type: 'thinking', thinking: 'Analyzing private chain of thought' },
  { type: 'text', text: '我先確認 Host protocol 的訊息邊界。', textSignature: commentarySignature },
  { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'electron/piHostProtocol.ts' } },
])
assert.deepEqual(commentary, [{ content: '我先確認 Host protocol 的訊息邊界。', phase: 'commentary' }])

const final = piAssistantTextSegments([
  { type: 'text', text: '已補上公開階段訊息的保存與投影。', textSignature: finalSignature },
])
assert.deepEqual(final, [{ content: '已補上公開階段訊息的保存與投影。', phase: 'final_answer' }])
assert.deepEqual(piAssistantTextSegments('舊 provider 的純文字訊息'), [{ content: '舊 provider 的純文字訊息' }])
assert.deepEqual(
  piAssistantTextSegments([{ type: 'text', text: '無效簽章仍保留公開文字', textSignature: '{broken' }]),
  [{ content: '無效簽章仍保留公開文字' }],
)

const guided = appendPiPublicCommentaryGuidance('base system prompt')
assert.match(guided, /public progress update/i)
assert.match(guided, /commentary/)
assert.equal(appendPiPublicCommentaryGuidance(guided), guided, 'Host guidance is idempotent')

const record = appendTurnRecord(undefined, [
  { kind: 'user-text', source: 'user', content: '檢查投影', turn: 1, step: 1, at: 1 },
  { kind: 'assistant-text', source: 'model', content: commentary[0].content, phase: commentary[0].phase, turn: 1, step: 1, at: 2 },
  { kind: 'tool-call', source: 'model', tool: 'read', callId: 'call-1', path: 'electron/piHostProtocol.ts', turn: 1, step: 1, at: 3 },
  { kind: 'tool-result', source: 'host', tool: 'read', callId: 'call-1', settlement: 'success', turn: 1, step: 1, at: 4 },
  { kind: 'assistant-text', source: 'model', content: final[0].content, phase: final[0].phase, turn: 1, step: 1, at: 5 },
])
const persisted = parseTurnRecord(JSON.parse(JSON.stringify(record))).record
const rows = projectConversationRows(persisted)
assert.deepEqual(rows.map((row) => row.kind), ['user', 'assistant', 'tool', 'tool', 'assistant'])
assert.deepEqual(
  rows.filter((row) => row.kind === 'assistant').map((row) => row.phase),
  ['commentary', 'final_answer'],
  'the durable projection preserves the provider-authored public phase',
)
assert.equal(conversationAnswer(persisted), final[0].content, 'only final_answer settles the published answer')

const commentaryOnly = appendTurnRecord(undefined, [{
  kind: 'assistant-text', source: 'model', content: '我還在檢查。', phase: 'commentary', turn: 1, step: 1, at: 1,
}])
assert.equal(conversationAnswer(commentaryOnly), undefined, 'commentary must never masquerade as a final answer')

const timeline = runTimelineRows({ rows: rows.map((row) => ({ ...row, step: 1 })), unloadedBefore: 0, steps: [] })
assert.deepEqual(
  timeline.filter((row) => row.kind === 'assistant').map((row) => row.phase),
  ['commentary', 'final_answer'],
  'live and replay timelines preserve the same public phases',
)

const root = resolve(import.meta.dirname, '..')
const runtimeSource = await readFile(resolve(root, 'electron/piCoreRuntime.ts'), 'utf8')
const protocolSource = await readFile(resolve(root, 'electron/piHostProtocol.ts'), 'utf8')
assert.match(runtimeSource, /appendPiPublicCommentaryGuidance\(event\.systemPrompt\)/,
  'Builtin Pi must receive the Host-owned public commentary contract')
assert.match(protocolSource, /piAssistantTextSegments\(message\.content\)/,
  'the Host must preserve provider assistant phases instead of flattening every text block')

console.log('pi public commentary contract is preserved from provider message to live/replay projection')
