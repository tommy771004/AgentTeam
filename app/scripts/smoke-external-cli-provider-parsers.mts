import assert from 'node:assert/strict'
import { parseProviderJsonEvent } from '../electron/externalCliProviderParsers.ts'
import { createCliStreamParser, type LocalCliKind, type LocalCliStreamEvent } from '../electron/localCliRunner.ts'

function parse(kind: LocalCliKind, event: Record<string, unknown>, assembledText = '') {
  const events: Array<Omit<LocalCliStreamEvent, 'runId'>> = []
  let answer = assembledText
  const result = parseProviderJsonEvent({
    kind,
    event,
    assembledText,
    appendText: (text) => { answer += text; events.push({ kind: 'text', channel: 'text', delta: text }); return text },
    emit: (value) => events.push(value),
    onProviderSession: (value) => events.push({ kind: 'status', providerSessionId: value }),
  })
  return { result, events, answer }
}

assert.equal(parse('grok', { type: 'thought', data: 'bounded reasoning' }).events[0]?.kind, 'thought')
assert.equal(parse('gemini', { response: 'Gemini answer' }).answer, 'Gemini answer')
assert.equal(parse('claude', { type: 'assistant', message: { content: [{ type: 'text', text: 'Claude answer' }] } }).answer, 'Claude answer')
assert.equal(parse('cursor', { type: 'approval_required', reason: 'write file' }).events[0]?.sessionPhase, 'waiting_for_approval')
assert.equal(parse('codex', { type: 'input_required', prompt: 'Choose' }).events[0]?.sessionPhase, 'waiting_for_user')

const codex = parse('codex', { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'src/a.ts', additions: 3, deletions: 1 }] } })
assert.deepEqual(codex.events[0], { kind: 'file', title: '已編輯 a.ts', detail: 'src/a.ts', path: 'src/a.ts', paths: ['src/a.ts'], added: 3, removed: 1, action: 'edit' })

const terminal = parse('claude', { type: 'result', is_error: true, error: 'auth expired' })
assert.deepEqual(terminal.events[0], { kind: 'error', title: 'CLI 錯誤', detail: 'auth expired', ok: false })

const bounded = parse('codex', { type: 'error', message: 'x'.repeat(1000), session_id: 's'.repeat(500) })
assert.equal(bounded.events[0]?.providerSessionId?.length, 200)
assert.equal(bounded.events[1]?.detail?.length, 400)

const streamed: Array<Omit<LocalCliStreamEvent, 'runId'>> = []
const stream = createCliStreamParser('codex', (event) => streamed.push(event))
stream.push('\u001b[32m{"type":"item.completed","item":{"type":"agent_', 'stdout')
stream.push('message","text":"interleaved answer"}}\u001b[0m\n', 'stdout')
stream.push('{"type":"error","message":"stderr event', 'stderr')
stream.push(' remains separate"}\n', 'stderr')
assert.equal(stream.getAssembledText(), 'interleaved answer')
assert.equal(streamed.some((event) => event.kind === 'error' && event.detail === 'stderr event remains separate'), true)

console.log('external CLI provider parsers preserve captured activity, waiting, diagnostics, and terminal events')
