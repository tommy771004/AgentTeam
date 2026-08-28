import assert from 'node:assert/strict'
import { applyOpenDesignPack } from '../src/agent/openDesign/packApplication.ts'
import type { OpenDesignCatalogRecord } from '../src/agent/openDesign/catalog.ts'
import { createStreamingEnvelope, type StreamingUpdate } from '../src/agent/subdesign/streamingEnvelope.ts'
import { projectSubDesignStreaming } from '../src/agent/subdesign/streamingProjection.ts'
import type { SubDesignArtifact } from '../src/agent/subdesign/types.ts'

const artifact: SubDesignArtifact = {
  id: 'artifact-real-id', briefId: 'brief-1', kind: 'html', title: 'Live artifact',
  entry: '.subagents/artifact.html', renderer: 'html', exports: ['html'], supportingFiles: [],
  status: 'streaming', revision: 1, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
}
const envelope = createStreamingEnvelope({ artifactId: artifact.id, artifactKind: artifact.kind, runId: 'run-1', stageId: 'stage-1' })
const events: StreamingUpdate[] = [
  { seq: 2, kind: 'tool-call', tool: 'render', text: 'Render artifact' },
  { seq: 1, kind: 'text-delta', content: '<main>' },
  { seq: 3, kind: 'text-delta', content: 'ready</main>' },
  { seq: 4, kind: 'done', text: 'complete' },
]
const projected = projectSubDesignStreaming({ snapshot: { artifact, liveEnvelope: envelope }, events })
assert.equal(projected.content, '<main>ready</main>', 'out-of-order text must reconcile through one contiguous projection')
assert.equal(projected.status, 'complete', 'preview and activity must share terminal status')
assert.deepEqual(projected.activity.map((item) => item.kind), ['tool-call', 'done'], 'text deltas must stay out of activity')
assert.equal(projected.activity.every((item) => item.status === projected.status), true)

const replayed = projectSubDesignStreaming({ snapshot: { artifact, liveEnvelope: projected.envelope }, events: [events[3]] })
assert.equal(replayed.content, projected.content, 'identical replay must not duplicate content')
assert.equal(replayed.rejected.length, 0, 'identical replay is idempotent')
const conflicting = projectSubDesignStreaming({ snapshot: { artifact, liveEnvelope: projected.envelope }, events: [{ ...events[3], text: 'different' }] })
assert.match(conflicting.rejected[0], /conflicting duplicate|已終止/, 'conflicting replay must be rejected')

const staticArtifact = { ...artifact, id: 'deck', kind: 'deck' as const, renderer: 'deck-html' as const }
const staticProjection = projectSubDesignStreaming({
  snapshot: { artifact: staticArtifact, liveEnvelope: { ...envelope, artifactId: staticArtifact.id, artifactKind: 'deck' } },
})
assert.equal(staticProjection.useStaticFallback, true)
assert.match(staticProjection.fallbackReason || '', /不支援 streaming/)

const record = {
  id: 'pack-one', title: 'Pack One', kind: 'template', sourcePath: 'packs/one', sourceUrl: '',
  upstreamCommit: 'abc', digest: 'a'.repeat(64), licensePaths: [], assetPaths: ['packs/one/template.md'],
  entryPaths: ['packs/one/template.md'], executionStatus: 'content-only',
} as OpenDesignCatalogRecord
const order: string[] = []
const result = await applyOpenDesignPack({
  record,
  projectRoot: '/project/one',
  dependencies: {
    copyToProject: async () => { order.push('copy'); return { ok: true, path: '.subagents/subdesign/vendor-packs/open-design-pack-one/pack-manifest.json' } },
    persistCanonical: async () => { order.push('persist'); return true },
    commitProjection: () => { order.push('project') },
    appendAudit: (event) => { order.push(event.action) },
    now: () => '2026-08-28T00:00:00.000Z',
  },
})
assert.equal(result.ok, true)
assert.deepEqual(order, ['copy', 'persist', 'project', 'install'], 'projection must commit only after copy and canonical metadata')

let committed = false
const failed = await applyOpenDesignPack({
  record,
  projectRoot: '/project/two',
  dependencies: {
    copyToProject: async () => ({ ok: true, path: '.subagents/subdesign/vendor-packs/open-design-pack-one/pack-manifest.json' }),
    persistCanonical: async () => false,
    commitProjection: () => { committed = true },
    appendAudit: () => undefined,
  },
})
assert.equal(failed.ok, false)
assert.equal(committed, false, 'failed persistence must not advertise an installed projection')

const missingRoot = await applyOpenDesignPack({
  record,
  projectRoot: '',
  dependencies: {
    copyToProject: async () => { throw new Error('must not copy') },
    persistCanonical: async () => true,
    commitProjection: () => undefined,
    appendAudit: () => undefined,
  },
})
assert.equal(missingRoot.ok, false)

console.log('SubDesign deep-module smoke passed: streaming projection and atomic OpenDesign pack application')
