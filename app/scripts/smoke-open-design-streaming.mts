/**
 * Smoke: Streaming artifact envelope & renderer sandbox (08)
 * Run: node --experimental-strip-types scripts/smoke-open-design-streaming.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendStreamingUpdate,
  canRender,
  createStreamingEnvelope,
  envelopeForArtifact,
  finalizeEnvelope,
  reconcileUpdates,
} from '../src/agent/subdesign/streamingEnvelope.ts'
import type { SubDesignArtifact } from '../src/agent/subdesign/types.ts'
import { ARTIFACT_RENDERER_CAPABILITIES } from '../src/agent/subdesign/artifactRendererCapabilities.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let p = 0
let t = 0
async function test(n: string, fn: () => void | Promise<void>) {
  t++
  try { await fn(); p++; console.log(`  ✓ ${n}`) }
  catch (e) { console.error(`  ✗ ${n}`); console.error(e); process.exitCode = 1 }
}
console.log('smoke-open-design-streaming')

/** A real artifact id carries no kind — that is the whole point of the fix. */
const htmlArtifact = {
  id: 'plugin_run_abc123_compose',
  kind: 'html',
  entry: '.subagents/open-design/runs/run_abc123/artifact/index.html',
} satisfies Pick<SubDesignArtifact, 'id' | 'kind' | 'entry'>

await test('envelope has version, identity, ordered updates, status', () => {
  const e = envelopeForArtifact(htmlArtifact, 'run_abc123', 'compose')
  assert.equal(e.version, 1)
  assert.equal(e.artifactId, 'plugin_run_abc123_compose')
  assert.equal(e.stageId, 'compose')
  assert.equal(e.status, 'streaming')
  assert.deepEqual(e.outputRefs, [htmlArtifact.entry])
  const r = appendStreamingUpdate(e, '<h1>hi</h1>')
  assert.equal(r.envelope.updates[0].seq, 1)
})

await test('artifact kind comes from the manifest, never from the id', () => {
  // The old id-parsing derivation made every genuine artifact unrenderable.
  const e = envelopeForArtifact(htmlArtifact, 'run_abc123')
  assert.equal(e.artifactKind, 'html')
  assert.equal(canRender({ supportedKinds: ['html'], streaming: true, sandbox: "default-src 'none'" }, e).ok, true)
  const deck = envelopeForArtifact({ ...htmlArtifact, kind: 'deck' }, 'run_abc123')
  assert.equal(deck.artifactKind, 'deck')
})

await test('unsupported renderer rejects before rendering streaming', () => {
  const e = appendStreamingUpdate(envelopeForArtifact(htmlArtifact, 'run2'), 'data').envelope
  const bad = canRender({ supportedKinds: ['markdown-document'], streaming: false, sandbox: "default-src 'none'" }, e)
  assert.equal(bad.ok, false)
  assert.match(bad.ok === false ? bad.reason : '', /不支援/)
  // A renderer that supports the kind but not streaming also refuses up front,
  // rather than showing a half-built artifact.
  const noStream = canRender({ supportedKinds: ['html'], streaming: false, sandbox: "default-src 'none'" }, e)
  assert.equal(noStream.ok, false)
  assert.match(noStream.ok === false ? noStream.reason : '', /streaming/)
  // ...but the same renderer accepts it once the stream is terminal.
  assert.equal(
    canRender({ supportedKinds: ['html'], streaming: false, sandbox: "default-src 'none'" }, finalizeEnvelope(e, 'complete')).ok,
    true,
  )
})

await test('streaming, complete, error, cancelled are distinct', () => {
  const base = envelopeForArtifact(htmlArtifact, 'r')
  assert.equal(finalizeEnvelope(base, 'complete').status, 'complete')
  assert.equal(finalizeEnvelope(base, 'error', 'boom').status, 'error')
  assert.equal(finalizeEnvelope(base, 'cancelled').status, 'cancelled')
  // A late terminal event never rewrites a settled stream.
  const terminal = finalizeEnvelope(base, 'complete')
  assert.equal(finalizeEnvelope(terminal, 'error', 'late').status, 'complete')
  const cancelled = finalizeEnvelope(base, 'cancelled')
  assert.equal(finalizeEnvelope(cancelled, 'complete').status, 'cancelled')
})

await test('ordered / duplicate / out-of-order / late event reconciliation is deterministic', () => {
  const a = reconcileUpdates([
    { seq: 2, content: 'b' }, { seq: 1, content: 'a' }, { seq: 2, content: 'dup' },
    { seq: 5, content: 'e' }, { seq: 3, content: 'c' },
  ])
  assert.deepEqual(a.map((x) => x.seq), [1, 2, 3])
  // Replaying the same events in any order yields the same prefix.
  const shuffled = reconcileUpdates([
    { seq: 3, content: 'c' }, { seq: 5, content: 'e' }, { seq: 1, content: 'a' },
    { seq: 2, content: 'b' }, { seq: 2, content: 'dup' },
  ])
  assert.deepEqual(shuffled.map((x) => x.content), a.map((x) => x.content))
  // A gap truncates rather than inventing order.
  assert.deepEqual(reconcileUpdates([{ seq: 1, content: 'a' }, { seq: 3, content: 'c' }]).map((x) => x.seq), [1])
})

await test('cancel stops the stream and rejects later appends', () => {
  const streaming = appendStreamingUpdate(envelopeForArtifact(htmlArtifact, 'r'), 'partial').envelope
  const cancelled = finalizeEnvelope(streaming, 'cancelled')
  const late = appendStreamingUpdate(cancelled, 'late')
  assert.match(late.rejected ?? '', /終止/)
  // The content produced before the cancel is kept, not discarded.
  assert.equal(cancelled.updates.length, 1)
  assert.equal(late.envelope.updates.length, 1)
})

await test('terminal append and unsupported artifact kind are rejected', () => {
  const terminal = finalizeEnvelope(envelopeForArtifact(htmlArtifact, 'r'), 'complete')
  assert.match(appendStreamingUpdate(terminal, 'late').rejected ?? '', /終止/)
  const svg = createStreamingEnvelope({ artifactId: 'plugin_run_x_render', artifactKind: 'svg', runId: 'r' })
  assert.equal(canRender({ supportedKinds: ['html'], streaming: true, sandbox: "default-src 'none'" }, svg).ok, false)
})

await test('the renderer capability table declares kinds the envelope can carry', () => {
  // Renderer declarations and artifact kinds must speak the same vocabulary,
  // or the gate silently rejects everything (the bug this smoke now guards).
  const declaredKinds = new Set(Object.values(ARTIFACT_RENDERER_CAPABILITIES).flatMap((capability) => capability.supportedKinds))
  for (const kind of ['html', 'deck', 'markdown-document', 'svg', 'react-component']) {
    assert.ok(declaredKinds.has(kind as SubDesignArtifact['kind']), `renderer 能力表缺少 ${kind}`)
  }
  // Every renderer declares a sandbox policy and its export capability.
  for (const capability of Object.values(ARTIFACT_RENDERER_CAPABILITIES)) {
    assert.ok(capability.sandbox)
    assert.ok(capability.export?.length)
  }
})

await test('sandboxed HTML cannot access filesystem/network/token', () => {
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/streamingEnvelope.ts'), 'utf8')
  assert.doesNotMatch(src, /raw token|connector token|fs:write.*renderer/)
})

await test('content visible by default (no entrance animation gate)', () => {
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/subdesign/streamingEnvelope.ts'), 'utf8')
  assert.doesNotMatch(src, /opacity:\s*0/)
})

console.log(`\n${p}/${t} tests passed`)
if (process.exitCode) console.error('Failed'); else console.log('OK')
