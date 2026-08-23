/**
 * Feed ⇄ context isolation (item 6 — hermes stream_events invariant).
 *
 * hermes states it explicitly: streaming events describe TRANSPORT, never
 * CONTEXT. What a surface chooses to render must never diverge from — or leak
 * into — the bytes stored in conversation history. The renderer's equivalent
 * contract: `runActivityStore` is an ephemeral presentation layer. Its events,
 * draft text, and thoughts are disposable; the Pi Host session transcript is
 * the only durable history. This smoke pins that boundary from both sides so a
 * future "helpful" persistence cannot quietly reunite them.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const storeSrc = await readFile(resolve(import.meta.dirname, '../src/store/runActivityStore.ts'), 'utf8')
const activitySrc = await readFile(resolve(import.meta.dirname, '../src/agent/piHostActivity.ts'), 'utf8')

// ── The feed store owns no durable history ──
assert.doesNotMatch(storeSrc, /from '.*chatHistory/, 'the ephemeral feed must not import chat history writers')
assert.doesNotMatch(storeSrc, /from '.*threadStore/, 'the ephemeral feed must not import the thread store')
assert.doesNotMatch(storeSrc, /localStorage|sessionStorage/, 'the ephemeral feed must not persist to web storage')
assert.match(storeSrc, /Ephemeral — not persisted/, 'the header contract statement must stay')

// The projection seam may translate host events into feed rows, nothing more.
assert.doesNotMatch(activitySrc, /from '.*chatHistory/, 'the host→feed translator must not touch history')
assert.doesNotMatch(activitySrc, /from '.*threadStore/, 'the host→feed translator must not touch threads')

// ── Functional: terminal digests stay bounded and never reopen ──
const { useRunActivityStore } = await import('../src/store/runActivityStore.ts')
const store = useRunActivityStore.getState()
store.clear()
store.begin('iso_run', 'iso_thread')
for (let i = 0; i < 200; i += 1) {
  store.push({ kind: 'tool', runId: 'iso_run', title: `工具 ${i}`, callId: `c${i}` })
  store.appendText(`第 ${i} 段草稿。`, 'iso_run')
}
store.end('iso_run', '完成')
const sealed = useRunActivityStore.getState().getPresentation('iso_run')
assert.ok(sealed?.terminal, 'a finished run keeps a bounded digest')
assert.ok((sealed?.events.length || 0) <= 40, `digest events stay bounded (got ${sealed?.events.length})`)
assert.ok((sealed?.draftText.length || 0) <= 8_000, 'digest draft stays bounded')
// Late arrivals must not mutate the sealed digest.
const frozen = sealed?.events.length ?? 0
store.push({ kind: 'tool', runId: 'iso_run', title: '遲到的工具事件', callId: 'late' })
assert.equal(useRunActivityStore.getState().getPresentation('iso_run')?.events.length, frozen, 'sealed digests are immutable')

console.log('smoke-feed-context-isolation: all assertions passed')
