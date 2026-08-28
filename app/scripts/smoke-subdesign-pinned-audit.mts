import assert from 'node:assert/strict'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
})

const writes: Array<{ kind: string; payload: Record<string, unknown>; projectRoot?: string }> = []
const canonical = {
  id: 'pin_canonical001',
  artifactId: 'artifact_pin_qa',
  revision: 2,
  createdAt: '2026-08-28T08:00:00.000Z',
  pins: [{ selector: 'main>h1', text: '縮小主標題間距。' }],
}
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    subagents: {
      subdesign: {
        writeMetadata: async (input: { kind: string; payload: Record<string, unknown>; projectRoot?: string }) => {
          writes.push(input)
          return { ok: true }
        },
        readMetadata: async (projectRoot?: string) => ({
          ok: true,
          briefs: [], artifacts: [], critiques: [], exports: [], openDesignPacks: [], openDesignSnapshots: [],
          openDesignProviderSettings: [], openDesignProviderRuns: [], openDesignSurfaceSessions: [],
          pinnedComments: projectRoot === '/workspace/project' ? [canonical] : [],
        }),
      },
    },
  },
})

const { useSubDesignPinnedCommentsStore } = await import('../src/store/subDesignPinnedCommentsStore.ts')
useSubDesignPinnedCommentsStore.setState({ records: [], draftByArtifactId: {} })

const submitted = await useSubDesignPinnedCommentsStore.getState().recordSubmission({
  artifactId: 'artifact_pin_qa',
  revision: 3,
  pins: [{ selector: 'main>button.cta', text: '按鈕文字改得更明確。' }],
}, '/workspace/project')

assert.equal(submitted.persisted, true)
assert.equal(writes.length, 1)
assert.equal(writes[0].kind, 'pinned-comment')
assert.equal(writes[0].projectRoot, '/workspace/project')
assert.equal(writes[0].payload.artifactId, 'artifact_pin_qa')

await useSubDesignPinnedCommentsStore.getState().hydrateCanonical('/workspace/project')
const history = useSubDesignPinnedCommentsStore.getState().findByArtifactId('artifact_pin_qa')
assert.equal(history.length, 2)
assert.ok(history.some((record) => record.id === canonical.id))
assert.ok(history.some((record) => record.id === submitted.record.id))

console.log('SubDesign pinned comment audit persists project-relative metadata and hydrates canonical history')
