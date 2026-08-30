import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReviewExplorer } from '../src/components/ReviewExplorer.tsx'
import type { ReviewFileManifestEntry, ReviewTarget } from '../src/agent/reviewContract.ts'
import type { ReviewComment, ReviewFileState } from '../src/agent/reviewStateContract.ts'

const params = new URLSearchParams(window.location.search)
const scenario = params.get('scenario') || 'partial'
const snapshotId = 'review-ui-snapshot-a'
const target: ReviewTarget = { kind: 'run-snapshot', snapshotId }
const paths = Array.from({ length: 205 }, (_, index) => index === 0
  ? 'src/components/ReviewExplorer.tsx'
  : index === 1
    ? 'public/assets/architecture-preview.bin'
    : index === 2
      ? 'src/error-state.ts'
      : `src/large-change/module-${String(index).padStart(3, '0')}.ts`)
const manifest: ReviewFileManifestEntry[] = paths.map((path, index) => ({
  path,
  status: index % 7 === 0 ? 'added' : index % 11 === 0 ? 'deleted' : 'modified',
  binary: index === 1,
  additions: index === 1 ? 0 : 18 + index,
  removals: index === 1 ? 0 : index % 9,
  contentHash: `hash-${index}`,
  hunkCount: index === 0 ? 40 : 2,
}))

let comments: ReviewComment[] = [{
  id: 'comment-1',
  anchor: { snapshotId, path: paths[0], side: 'new', line: 1, hunkFingerprint: 'hunk-1', contextHash: 'context-1', originalContext: 'export function ReviewExplorer' },
  body: '確認 large diff paging 不會遺失選取狀態。',
  status: 'submitted',
  createdAt: '2026-08-30T06:00:00.000Z',
  updatedAt: '2026-08-30T06:00:00.000Z',
}]
let fileStates: ReviewFileState[] = []
let draftCounter = 1

function diffContent(path: string, page: number): string {
  const start = page * 80
  return Array.from({ length: 80 }, (_, offset) => {
    const line = start + offset + 1
    if (offset === 0) return `@@ -${line},3 +${line},4 @@ ${path}\n`
    if (offset % 13 === 0) return `-const oldValue${line} = ${line}\n`
    if (offset % 11 === 0) return `+const qualifiedValue${line} = ${line + 1}\n`
    return ` context line ${line} keeps the historical snapshot immutable\n`
  }).join('')
}

const reviewBridge = {
  describe: async () => {
    if (scenario === 'error') throw new Error('Host review projection unavailable fixture')
    return { reviewTargetDescription: {
      target,
      revision: 'revision-a-immutable',
      status: scenario === 'missing' ? 'missing' : 'partial',
      fileCount: scenario === 'missing' ? 0 : manifest.length,
      diagnostics: scenario === 'missing' ? ['snapshot payload 已由 retention 移除'] : ['2 hunks omitted after bounded capture'],
    } }
  },
  read: async () => ({ reviewArtifact: {
    snapshotId,
    status: scenario === 'missing' ? 'missing' : 'partial',
    attributionFidelity: 'shared',
    diagnostics: ['shared checkout during external writer activity'],
    manifest,
    total: manifest.length,
  } }),
  listFiles: async ({ cursor, query }: { cursor?: string; query?: string }) => {
    if (scenario === 'error') throw new Error('Host manifest read failed fixture')
    if (scenario === 'missing') return { reviewFiles: { target, revision: 'revision-a-immutable', items: [], total: 0, diagnostics: ['snapshot missing'], complete: true as const } }
    const filtered = query ? manifest.filter((file) => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : manifest
    const start = cursor === 'files-200' ? 200 : 0
    const items = filtered.slice(start, start + 200)
    const hasMore = start + items.length < filtered.length
    return { reviewFiles: hasMore
      ? { target, revision: 'revision-a-immutable', items, total: filtered.length, diagnostics: [], complete: false as const, nextCursor: 'files-200', omitted: { items: filtered.length - items.length, bytes: 4096, reasons: ['bounded page'] } }
      : { target, revision: 'revision-a-immutable', items, total: filtered.length, diagnostics: [], complete: true as const } }
  },
  readFileDiff: async ({ path, cursor }: { path: string; cursor?: string }) => {
    if (path === 'src/error-state.ts') throw new Error('Diff payload checksum mismatch fixture')
    const page = cursor === 'hunks-2' ? 1 : 0
    const items = [{ id: `${path}:${page}`, header: `@@ page ${page + 1}`, content: diffContent(path, page), bytes: 8192 }]
    return { reviewDiff: page === 0 && path === paths[0]
      ? { target, revision: 'revision-a-immutable', items, total: 2, diagnostics: [], complete: false as const, nextCursor: 'hunks-2', omitted: { items: 1, bytes: 8192, reasons: ['bounded hunk page'] } }
      : { target, revision: 'revision-a-immutable', items, total: items.length, diagnostics: [], complete: true as const } }
  },
  listComments: async () => ({ reviewComments: comments }),
  listFileStates: async () => ({ reviewFileStates: fileStates }),
  markReviewed: async ({ path, contentHash }: { path: string; contentHash: string }) => {
    const item: ReviewFileState = { snapshotId, path, contentHash, state: 'reviewed', reviewedAt: '2026-08-30T06:01:00.000Z' }
    fileStates = [...fileStates.filter((state) => state.path !== path), item]
    return { reviewFileState: item }
  },
  saveDraft: async ({ id, path, body }: { id?: string; path: string; body: string }) => {
    const item: ReviewComment = {
      id: id || `draft-${draftCounter++}`,
      anchor: { snapshotId, path, side: 'new', line: 1, hunkFingerprint: 'fixture-hunk', contextHash: 'fixture-context', originalContext: 'fixture context' },
      body,
      status: 'draft',
      createdAt: '2026-08-30T06:02:00.000Z',
      updatedAt: '2026-08-30T06:02:00.000Z',
    }
    comments = [...comments.filter((comment) => comment.id !== item.id), item]
    return { reviewComment: item }
  },
  deleteDraft: async (id: string) => { comments = comments.filter((comment) => comment.id !== id); return {} },
  transitionComment: async (id: string, status: ReviewComment['status']) => {
    const current = comments.find((comment) => comment.id === id)!
    const next = { ...current, status, updatedAt: '2026-08-30T06:03:00.000Z' }
    comments = comments.map((comment) => comment.id === id ? next : comment)
    return { reviewComment: next }
  },
}

;(window as unknown as { subagents: unknown }).subagents = { piHost: { review: reviewBridge } }

function FixtureApp() {
  const [selectedPath, setSelectedPath] = useState<string>()
  return <div className="h-full min-h-0"><ReviewExplorer target={target} selectedPath={selectedPath} onSelectPath={setSelectedPath} /></div>
}

createRoot(document.getElementById('fixture')!).render(<FixtureApp />)
