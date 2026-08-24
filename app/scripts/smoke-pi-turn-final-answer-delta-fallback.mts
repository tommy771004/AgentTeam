import assert from 'node:assert/strict'
import { piTurnFinalAnswer } from '../src/agent/piHostRun.ts'

/**
 * The settled bubble must never be empty when the turn actually said
 * something. Two real shapes have eaten conclusions:
 *
 * 1. The final assistant message carries only thinking/toolCall blocks, so no
 *    assistant_message text survives the success projection.
 * 2. A multi-iteration Goal-based run keeps only the last iteration's result,
 *    which can be '' even though earlier turns streamed real text.
 *
 * In both, the streamed text_delta content is what the user already saw in
 * the feed — the answer must be rebuilt from it rather than replaced by a
 * "no text output" placeholder.
 */

// Shape 1: assistant messages exist but none carry usable text; deltas do.
const deltasOnly = [
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: '我先探索本地專案結構。\n\n' },
  },
  { type: 'tool_execution_start', toolName: 'grep', toolCallId: 'call_1' },
  { type: 'tool_execution_end', toolName: 'grep', isError: false },
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: '結論：Pi Core 由 Host 擁有迴圈。' },
  },
  // Final assistant message with only non-text blocks (thinking + tool call).
  {
    type: 'assistant_message',
    content: '',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '內部推理，不是輸出' },
        { type: 'toolCall', id: 'call_2', name: 'write', arguments: '{}' },
      ],
    },
  },
]
// The rebuild is per message, not per turn. The preamble and the conclusion
// are two different assistant messages — the tool call between them ends the
// first — so the answer is the LAST one. The preamble is not lost: it reached
// the user through the feed, which is where narration belongs. Welding them
// together is what put an opening line in the answer position to begin with
// (see .scratch/turn-record-fidelity/issues/02-interrupted-turn-keeps-its-boundary.md).
assert.equal(piTurnFinalAnswer(deltasOnly), '結論：Pi Core 由 Host 擁有迴圈。')

// Shape 2: no assistant_message items at all (interrupted/parked projection).
const noMessages = [
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: '部分輸出' },
  },
]
assert.equal(piTurnFinalAnswer(noMessages), '部分輸出')

// The last complete assistant message still wins over streamed deltas.
const conclusionWins = [
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: '我先探索本地專案結構。' },
  },
  { type: 'assistant_message', content: '結論：完成。' },
]
assert.equal(piTurnFinalAnswer(conclusionWins), '結論：完成。')

// Thinking deltas are narration, never the answer.
const thinkingOnly = [
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: '內部思考' },
  },
]
assert.equal(piTurnFinalAnswer(thinkingOnly), '')

// Genuinely silent turn stays silent.
assert.equal(piTurnFinalAnswer([]), '')
assert.equal(piTurnFinalAnswer([{ type: 'tool_execution_start', toolName: 'ls' }]), '')

console.log('piTurnFinalAnswer rebuilds the answer from streamed deltas when no assistant message text survives')
