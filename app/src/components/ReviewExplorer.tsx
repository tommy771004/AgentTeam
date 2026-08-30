import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { ReviewFileManifestEntry, ReviewTarget } from '../agent/reviewContract.ts'
import { fileReviewState, type ReviewComment, type ReviewFeedbackBundle, type ReviewFileState } from '../agent/reviewStateContract.ts'
import type { ReviewMutationOperation, ReviewMutationPreview } from '../agent/reviewMutationContract.ts'
import { ReviewDeliveryPanel } from './ReviewDeliveryPanel.tsx'

type ReviewArtifactView = {
  snapshotId: string
  status: 'pending' | 'capturing' | 'ready' | 'partial' | 'failed' | 'missing' | 'deleted' | 'stale'
  attributionFidelity: 'exact' | 'attributed' | 'shared' | 'partial'
  diagnostics: string[]
  manifest: ReviewFileManifestEntry[]
  manifestHash?: string
  nextCursor?: string
  total: number
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; artifact: ReviewArtifactView }
  | { kind: 'failed'; message: string }
  | { kind: 'unsupported'; message: string }

type StatusFilter = 'all' | ReviewFileManifestEntry['status']
type ReviewFilter = 'all' | 'unreviewed' | 'reviewed' | 'changed-after-review' | 'has-open-comments'
type FileSort = 'path' | 'status'
type ReviewHunkView = { id: string; header: string; content: string; bytes: number }
type CommentAnchorSelection = { hunkId: string; label: string; side: 'old' | 'new'; line: number }

const SOURCE_LABEL: Record<ReviewTarget['kind'], string> = {
  'run-snapshot': 'Run snapshot',
  'live-working-tree': 'Live working tree',
  staged: 'Staged changes',
  'branch-range': 'Branch range',
  'snapshot-range': 'Snapshot range',
}

const STATUS_LABEL: Record<ReviewFileManifestEntry['status'], string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', 'type-changed': 'T', untracked: 'U',
}

function targetIdentity(target: ReviewTarget): string {
  if (target.kind === 'run-snapshot') return target.snapshotId
  if (target.kind === 'snapshot-range') return `${target.beforeSnapshotId.slice(0, 8)} → ${target.afterSnapshotId.slice(0, 8)}`
  if (target.kind === 'branch-range') return `${target.baseRef}…${target.headRef}`
  return target.revision.slice(0, 12)
}

function isArtifact(value: unknown): value is ReviewArtifactView {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ReviewArtifactView>
  return typeof item.snapshotId === 'string' && typeof item.status === 'string' && Array.isArray(item.manifest) && Array.isArray(item.diagnostics)
}

async function readTarget(target: ReviewTarget, signal: AbortSignal, query?: string): Promise<ReviewArtifactView> {
  const bridge = window.subagents?.piHost?.review
  if (typeof bridge?.describe !== 'function' || typeof bridge?.listFiles !== 'function') throw new Error('Pi Host review projection bridge 不可用；plain-browser 不會建立替代 diff。')
  const [described, listed, snapshot] = await Promise.all([
    bridge.describe(target),
    bridge.listFiles({ target, limit: 200, ...(query?.trim() ? { query: query.trim() } : {}) }),
    target.kind === 'run-snapshot' && typeof bridge.read === 'function' ? bridge.read(target.snapshotId).catch(() => undefined) : Promise.resolve(undefined),
  ])
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  const artifact = snapshot && isArtifact(snapshot.reviewArtifact) ? snapshot.reviewArtifact : undefined
  const status = described.reviewTargetDescription.status
  return {
    snapshotId: target.kind === 'run-snapshot' ? target.snapshotId : targetIdentity(target),
    status,
    attributionFidelity: artifact?.attributionFidelity || 'partial',
    diagnostics: described.reviewTargetDescription.diagnostics,
    manifest: listed.reviewFiles.items,
    manifestHash: described.reviewTargetDescription.revision,
    nextCursor: listed.reviewFiles.nextCursor,
    total: listed.reviewFiles.total,
  }
}

export function ReviewExplorer({
  target,
  selectedPath,
  onSelectPath,
  onOpenTarget,
}: {
  target: ReviewTarget
  selectedPath?: string
  onSelectPath: (path?: string) => void
  onOpenTarget?: (target: ReviewTarget, title?: string) => void
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [sort, setSort] = useState<FileSort>('path')
  const [view, setView] = useState<'unified' | 'split'>('unified')
  const [foldContext, setFoldContext] = useState(false)
  const [reload, setReload] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [fileStates, setFileStates] = useState<ReviewFileState[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string>()
  const [commentError, setCommentError] = useState<string>()
  const [commentAnchors, setCommentAnchors] = useState<CommentAnchorSelection[]>([])
  const [commentAnchorId, setCommentAnchorId] = useState('')
  const [sendingFeedback, setSendingFeedback] = useState(false)
  const [mutationOperation, setMutationOperation] = useState<ReviewMutationOperation>(target.kind === 'staged' ? 'unstage' : 'stage')
  const [mutationHunk, setMutationHunk] = useState(-1)
  const [mutationPreview, setMutationPreview] = useState<ReviewMutationPreview>()
  const [mutationBusy, setMutationBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string>()

  const reloadReviewState = useCallback(async () => {
    if (target.kind !== 'run-snapshot') { setComments([]); setFileStates([]); return }
    const bridge = window.subagents?.piHost?.review
    if (typeof bridge?.listComments !== 'function' || typeof bridge?.listFileStates !== 'function') return
    const [commentResponse, stateResponse] = await Promise.all([bridge.listComments(target.snapshotId), bridge.listFileStates(target.snapshotId)])
    setComments(commentResponse.reviewComments)
    setFileStates(stateResponse.reviewFileStates)
  }, [target])

  useEffect(() => { void reloadReviewState().catch(() => undefined) }, [reloadReviewState])

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void readTarget(target, controller.signal, query)
      .then((artifact) => setState({ kind: 'ready', artifact }))
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setState(target.kind === 'run-snapshot'
          ? { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
          : { kind: 'unsupported', message: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [target, query, reload])

  const files = useMemo(() => {
    if (state.kind !== 'ready') return []
    const normalized = query.trim().toLocaleLowerCase()
    return [...state.artifact.manifest]
      .filter((file) => statusFilter === 'all' || file.status === statusFilter)
      .filter((file) => reviewFilter === 'all' || fileReviewState(file, fileStates.find((item) => item.path === file.path), comments) === reviewFilter)
      .filter((file) => !normalized || `${file.oldPath || ''}\n${file.path}`.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => sort === 'path' ? a.path.localeCompare(b.path) : `${a.status}:${a.path}`.localeCompare(`${b.status}:${b.path}`))
  }, [comments, fileStates, query, reviewFilter, sort, state, statusFilter])

  useEffect(() => {
    if (!files.length) { if (selectedPath) onSelectPath(undefined); return }
    if (!selectedPath || !files.some((file) => file.path === selectedPath)) onSelectPath(files[0]?.path)
  }, [files, onSelectPath, selectedPath])

  const moveSelection = useCallback((offset: number) => {
    if (!files.length) return
    const index = Math.max(0, files.findIndex((file) => file.path === selectedPath))
    onSelectPath(files[(index + offset + files.length) % files.length]?.path)
  }, [files, onSelectPath, selectedPath])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus(); return }
      if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) }
      if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [moveSelection])

  const activeFile = files.find((file) => file.path === selectedPath)
  const selectedCommentAnchor = commentAnchors.find((anchor) => anchor.hunkId === commentAnchorId) || commentAnchors[0]
  useEffect(() => {
    setCommentAnchors([])
    setCommentAnchorId('')
  }, [activeFile?.path])
  useEffect(() => {
    if (commentAnchors.length && !commentAnchors.some((anchor) => anchor.hunkId === commentAnchorId)) setCommentAnchorId(commentAnchors[0]!.hunkId)
  }, [commentAnchorId, commentAnchors])
  const activeReviewState = activeFile ? fileReviewState(activeFile, fileStates.find((item) => item.path === activeFile.path), comments) : 'unreviewed'
  const previewMutation = async () => {
    if (!activeFile || (target.kind !== 'live-working-tree' && target.kind !== 'staged')) return
    const bridge = window.subagents?.piHost?.review
    if (!bridge?.previewMutation) { setMutationError('此環境沒有 Host Git mutation workflow。'); return }
    setMutationBusy(true); setMutationError(undefined); setMutationPreview(undefined)
    try {
      const response = await bridge.previewMutation({
        operation: target.kind === 'staged' ? 'unstage' : mutationOperation,
        target,
        expectedRevision: target.revision,
        selection: mutationHunk < 0 ? { kind: 'file', path: activeFile.path } : { kind: 'hunk', path: activeFile.path, hunkIndex: mutationHunk },
      })
      setMutationPreview(response.reviewMutationPreview)
    } catch (error) { setMutationError(error instanceof Error ? error.message : String(error)) }
    finally { setMutationBusy(false) }
  }
  const applyMutation = async () => {
    if (!mutationPreview) return
    const bridge = window.subagents?.piHost?.review?.applyMutation
    if (!bridge) return
    setMutationBusy(true); setMutationError(undefined)
    try {
      const { reviewMutationReceipt } = await bridge(mutationPreview.id)
      setMutationPreview(undefined)
      if (reviewMutationReceipt.status === 'applied' && (target.kind === 'live-working-tree' || target.kind === 'staged')) {
        const nextTarget: ReviewTarget = mutationPreview.operation === 'stage'
          ? { kind: 'staged', workspaceId: target.workspaceId, revision: reviewMutationReceipt.indexRevision || reviewMutationReceipt.revision }
          : { kind: 'live-working-tree', workspaceId: target.workspaceId, revision: reviewMutationReceipt.workingRevision || reviewMutationReceipt.revision }
        onOpenTarget?.(nextTarget, `${SOURCE_LABEL[nextTarget.kind]} · refreshed`)
      } else if (reviewMutationReceipt.status !== 'applied') setMutationError(`操作已${reviewMutationReceipt.status === 'denied' ? '拒絕' : '取消'}，工作樹未變更。`)
    } catch (error) { setMutationError(error instanceof Error ? error.message : String(error)) }
    finally { setMutationBusy(false) }
  }
  const loadMore = () => {
    if (state.kind !== 'ready' || !state.artifact.nextCursor) return
    const expectedCursor = state.artifact.nextCursor
    void window.subagents?.piHost?.review?.listFiles({ target, cursor: expectedCursor, limit: 200, ...(query.trim() ? { query: query.trim() } : {}) }).then(({ reviewFiles }) => {
      setState((current) => current.kind === 'ready' && current.artifact.nextCursor === expectedCursor ? { kind: 'ready', artifact: {
        ...current.artifact,
        manifest: [...current.artifact.manifest, ...reviewFiles.items],
        nextCursor: reviewFiles.nextCursor,
        total: reviewFiles.total,
      } } : current)
    }).catch(() => setReload((value) => value + 1))
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <ReviewExplorerHeader target={target} state={state} onReload={() => setReload((value) => value + 1)} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ReviewFileNavigation state={state} files={files} selectedPath={selectedPath} comments={comments} fileStates={fileStates} query={query} statusFilter={statusFilter} reviewFilter={reviewFilter} sort={sort} searchRef={searchRef} onQuery={setQuery} onStatusFilter={setStatusFilter} onReviewFilter={setReviewFilter} onSort={setSort} onSelectPath={onSelectPath} onLoadMore={loadMore} onReload={() => setReload((value) => value + 1)} />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Diff viewer">
          <ReviewPartialNotice state={state} />
          <ReviewDiffToolbar target={target} files={files} activeFile={activeFile} activeReviewState={activeReviewState} mutationOperation={mutationOperation} mutationHunk={mutationHunk} mutationBusy={mutationBusy} foldContext={foldContext} view={view} onMoveSelection={moveSelection} onMutationOperation={(value) => { setMutationOperation(value); setMutationPreview(undefined) }} onMutationHunk={(value) => { setMutationHunk(value); setMutationPreview(undefined) }} onPreviewMutation={previewMutation} onMarkReviewed={reloadReviewState} onCommentError={setCommentError} onFoldContext={setFoldContext} onView={setView} />
          <ReviewMutationState error={mutationError} preview={mutationPreview} busy={mutationBusy} onCancel={() => setMutationPreview(undefined)} onApply={applyMutation} />
          <ReviewDiffContent state={state} activeFile={activeFile} target={target} view={view} foldContext={foldContext} onCommentAnchors={setCommentAnchors} />
          {target.kind === 'run-snapshot' && activeFile && !activeFile.binary ? <PinnedCommentsPanel snapshotId={target.snapshotId} file={activeFile} comments={comments} anchors={commentAnchors} selectedAnchor={selectedCommentAnchor} anchorId={commentAnchorId} body={commentBody} editingId={editingCommentId} error={commentError} sending={sendingFeedback} onAnchorId={setCommentAnchorId} onBody={setCommentBody} onEditingId={setEditingCommentId} onError={setCommentError} onSending={setSendingFeedback} onReload={reloadReviewState} onOpenTarget={onOpenTarget} /> : null}
          <ReviewDelivery target={target} onOpenTarget={onOpenTarget} />
        </main>
      </div>
    </div>
  )
}

function ReviewPartialNotice({ state }: { state: LoadState }) {
  if (state.kind !== 'ready' || state.artifact.status !== 'partial') return null
  return <div className="border-b border-orange/40 bg-orange/10 px-3 py-2 text-[10px] text-orange" role="status">部分快照：{state.artifact.diagnostics.join(' · ') || 'Host 已標記 omitted content。'}</div>
}

function ReviewMutationState({ error, preview, busy, onCancel, onApply }: { error?: string; preview?: ReviewMutationPreview; busy: boolean; onCancel: () => void; onApply: () => Promise<void> }) {
  return <>{error ? <div className="border-b border-red/30 bg-red/5 px-3 py-1.5 text-[10px] text-red" role="alert">{error}</div> : null}{preview ? <MutationPreview preview={preview} busy={busy} onCancel={onCancel} onApply={onApply} /> : null}</>
}

function ReviewDiffContent({ state, activeFile, target, view, foldContext, onCommentAnchors }: { state: LoadState; activeFile?: ReviewFileManifestEntry; target: ReviewTarget; view: 'unified' | 'split'; foldContext: boolean; onCommentAnchors: (anchors: CommentAnchorSelection[]) => void }) {
  if (state.kind !== 'ready') return null
  if (!activeFile) return <ReviewState icon="difference" title="選擇一個變更" detail="使用檔案清單或 ⌥↑／⌥↓ 導覽。" />
  return <SnapshotDiff key={`${state.artifact.snapshotId}:${activeFile.path}`} target={target} file={activeFile} view={view} foldContext={foldContext} onCommentAnchors={target.kind === 'run-snapshot' ? onCommentAnchors : undefined} />
}

function ReviewDelivery({ target, onOpenTarget }: { target: ReviewTarget; onOpenTarget?: (target: ReviewTarget, title?: string) => void }) {
  if (target.kind !== 'staged') return null
  return <ReviewDeliveryPanel target={target} onOpenTarget={onOpenTarget} />
}

function ReviewExplorerHeader({ target, state, onReload }: { target: ReviewTarget; state: LoadState; onReload: () => void }) {
  const mutable = target.kind === 'live-working-tree' || target.kind === 'staged'
  const refresh = () => void window.subagents?.piHost?.review?.refresh(target).then(onReload).catch(onReload)
  return <header className="shrink-0 border-b border-line bg-surface-container-low px-3 py-2">
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-[12px] font-semibold">{SOURCE_LABEL[target.kind]}</span>
      <span className="truncate font-[family-name:var(--font-mono)] text-[10px] text-ink-3">{targetIdentity(target)}</span>
      <span className={`ml-auto shrink-0 text-[10px] ${mutable ? 'text-orange' : 'text-green'}`}>{mutable ? '可變 · 需刷新' : '固定來源'}</span>
      {mutable ? <button type="button" onClick={refresh} className="shrink-0 p-1 text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent" aria-label="刷新可變審查來源"><Icon name="refresh" size={14} /></button> : null}
    </div>
    {state.kind === 'ready' ? <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
      <span>{state.artifact.status}</span><span>·</span><span>{state.artifact.attributionFidelity} attribution</span>
      {state.artifact.manifestHash ? <span className="truncate font-[family-name:var(--font-mono)]">· {state.artifact.manifestHash.slice(0, 10)}</span> : null}
    </div> : null}
  </header>
}

function ReviewDiffToolbar({ target, files, activeFile, activeReviewState, mutationOperation, mutationHunk, mutationBusy, foldContext, view, onMoveSelection, onMutationOperation, onMutationHunk, onPreviewMutation, onMarkReviewed, onCommentError, onFoldContext, onView }: {
  target: ReviewTarget
  files: ReviewFileManifestEntry[]
  activeFile?: ReviewFileManifestEntry
  activeReviewState: ReturnType<typeof fileReviewState>
  mutationOperation: ReviewMutationOperation
  mutationHunk: number
  mutationBusy: boolean
  foldContext: boolean
  view: 'unified' | 'split'
  onMoveSelection: (offset: number) => void
  onMutationOperation: (value: 'stage' | 'revert') => void
  onMutationHunk: (value: number) => void
  onPreviewMutation: () => Promise<void>
  onMarkReviewed: () => Promise<void>
  onCommentError: (value: string) => void
  onFoldContext: (value: boolean | ((current: boolean) => boolean)) => void
  onView: (value: 'unified' | 'split') => void
}) {
  const mutable = target.kind === 'live-working-tree' || target.kind === 'staged'
  const markReviewed = () => {
    if (target.kind !== 'run-snapshot' || !activeFile?.contentHash) return
    void window.subagents?.piHost?.review?.markReviewed({ snapshotId: target.snapshotId, path: activeFile.path, contentHash: activeFile.contentHash }).then(onMarkReviewed).catch((error) => onCommentError(error instanceof Error ? error.message : String(error)))
  }
  return <div className="flex min-h-10 max-w-full shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1 md:h-10 md:flex-nowrap md:overflow-x-auto md:py-0 custom-scrollbar">
    <button type="button" onClick={() => onMoveSelection(-1)} disabled={!files.length} className="p-1.5 text-ink-3 hover:text-ink disabled:opacity-35" aria-label="上一個變更（⌥↑）"><Icon name="keyboard_arrow_up" size={17} /></button>
    <button type="button" onClick={() => onMoveSelection(1)} disabled={!files.length} className="p-1.5 text-ink-3 hover:text-ink disabled:opacity-35" aria-label="下一個變更（⌥↓）"><Icon name="keyboard_arrow_down" size={17} /></button>
    <span className="order-first w-full min-w-0 truncate border-b border-line/60 px-1 pb-1 font-[family-name:var(--font-mono)] text-[10px] text-ink-2 md:order-none md:w-auto md:flex-1 md:border-0 md:pb-0">{activeFile?.path || '選擇檔案'}</span>
    {activeFile ? <button type="button" onClick={() => void navigator.clipboard.writeText(activeFile.path)} className="p-1.5 text-ink-3 hover:text-ink" aria-label="複製檔案路徑"><Icon name="content_copy" size={15} /></button> : null}
    {activeFile && target.kind === 'run-snapshot' ? <button type="button" onClick={() => void window.subagents?.piHost?.review?.openFile({ snapshotId: target.snapshotId, path: activeFile.path }).then((result) => { if (!result.ok) onCommentError(result.error || '無法開啟檔案') }).catch((error) => onCommentError(error instanceof Error ? error.message : String(error)))} className="p-1.5 text-ink-3 hover:text-ink" aria-label="在系統編輯器開啟檔案"><Icon name="open_in_new" size={15} /></button> : null}
    {mutable && activeFile ? <>
      {target.kind === 'live-working-tree' ? <select value={mutationOperation} onChange={(event) => onMutationOperation(event.target.value as 'stage' | 'revert')} aria-label="Git 操作" className="h-7 border border-line bg-surface px-1 text-[10px]"><option value="stage">Stage</option><option value="revert">Revert</option></select> : <span className="text-[10px] text-ink-3">Unstage</span>}
      <select value={mutationHunk} onChange={(event) => onMutationHunk(Number(event.target.value))} disabled={activeFile.binary} aria-label="Mutation 範圍" className="h-7 max-w-24 border border-line bg-surface px-1 text-[10px] disabled:opacity-50"><option value={-1}>整個檔案</option>{Array.from({ length: activeFile.hunkCount || 0 }, (_, index) => <option key={index} value={index}>Hunk {index + 1}</option>)}</select>
      <button type="button" disabled={mutationBusy} onClick={() => void onPreviewMutation()} className="border border-line-strong px-2 py-1 text-[10px] text-ink-2 hover:bg-hover-2 disabled:opacity-40">{mutationBusy ? '處理中…' : '預覽'}</button>
    </> : null}
    {target.kind === 'run-snapshot' && activeFile?.contentHash ? <button type="button" onClick={markReviewed} className={`px-2 py-1 text-[10px] ${activeReviewState === 'reviewed' ? 'text-green' : 'text-ink-3 hover:text-ink'}`} aria-label="標記檔案為已審查"><Icon name={activeReviewState === 'reviewed' ? 'check_circle' : 'task_alt'} size={15} /></button> : null}
    <button type="button" aria-pressed={foldContext} onClick={() => onFoldContext((value) => !value)} className={`shrink-0 whitespace-nowrap px-2 py-1 text-[10px] ${foldContext ? 'bg-selected text-ink' : 'text-ink-3 hover:text-ink'}`}>折疊 context</button>
    <div className="flex shrink-0 border border-line" aria-label="Diff 顯示方式"><button type="button" aria-pressed={view === 'unified'} onClick={() => onView('unified')} className={`px-2 py-1 text-[10px] ${view === 'unified' ? 'bg-selected text-ink' : 'text-ink-3'}`}>Unified</button><button type="button" aria-pressed={view === 'split'} onClick={() => onView('split')} className={`px-2 py-1 text-[10px] ${view === 'split' ? 'bg-selected text-ink' : 'text-ink-3'}`}>Split</button></div>
  </div>
}

function MutationPreview({ preview, busy, onCancel, onApply }: { preview: ReviewMutationPreview; busy: boolean; onCancel: () => void; onApply: () => Promise<void> }) {
  const selection = preview.selection.kind === 'file' ? '整個檔案' : `Hunk ${preview.selection.hunkIndex + 1}`
  return <section className="shrink-0 border-b border-orange/40 bg-surface-container-low p-3" aria-label="Git mutation 精確預覽">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold text-ink">確認 {preview.operation} · {selection}</p><p className="mt-1 font-[family-name:var(--font-mono)] text-[9px] text-ink-3">{preview.patchHash.slice(0, 16)} · {preview.patchBytes} bytes · +{preview.additions} −{preview.removals}</p></div><div className="flex gap-2"><button type="button" onClick={onCancel} className="px-2 py-1 text-[10px] text-ink-3 hover:text-ink">取消</button><button type="button" disabled={busy} onClick={() => void onApply()} className="border border-orange px-3 py-1 text-[10px] font-medium text-orange hover:bg-orange/10 disabled:opacity-40">送交核准</button></div></div>
    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap border border-line bg-inset p-2 font-[family-name:var(--font-mono)] text-[9px] leading-relaxed text-ink-2">{preview.patch}</pre>
    {preview.operation === 'revert' ? <p className="mt-2 text-[9px] text-orange">Revert 套用前會保存 recoverable patch；核准拒絕、取消或 CAS stale 都不產生 side effect。</p> : null}
  </section>
}

function PinnedCommentsPanel(props: {
  snapshotId: string
  file: ReviewFileManifestEntry
  comments: ReviewComment[]
  anchors: CommentAnchorSelection[]
  selectedAnchor?: CommentAnchorSelection
  anchorId: string
  body: string
  editingId?: string
  error?: string
  sending: boolean
  onAnchorId: (value: string) => void
  onBody: (value: string) => void
  onEditingId: (value?: string) => void
  onError: (value?: string) => void
  onSending: (value: boolean) => void
  onReload: () => Promise<void>
  onOpenTarget?: (target: ReviewTarget, title?: string) => void
}) {
  const [feedbackPreview, setFeedbackPreview] = useState<ReviewFeedbackBundle>()
  const fileComments = props.comments.filter((comment) => comment.anchor.path === props.file.path)
  useEffect(() => setFeedbackPreview(undefined), [props.snapshotId])
  const save = () => {
    props.onError(undefined)
    const anchorInput = props.editingId || !props.selectedAnchor ? {} : { hunkId: props.selectedAnchor.hunkId, side: props.selectedAnchor.side, line: props.selectedAnchor.line }
    void window.subagents?.piHost?.review?.saveDraft({ ...(props.editingId ? { id: props.editingId } : {}), ...anchorInput, snapshotId: props.snapshotId, path: props.file.path, body: props.body })
      .then(() => { props.onBody(''); props.onEditingId(undefined); return props.onReload() })
      .catch((error) => props.onError(error instanceof Error ? error.message : String(error)))
  }
  const previewFeedback = () => {
    props.onSending(true); props.onError(undefined)
    void import('../agent/reviewFeedbackRun.ts').then(({ prepareReviewFeedback }) => prepareReviewFeedback(props.snapshotId))
      .then(setFeedbackPreview)
      .catch((error) => props.onError(error instanceof Error ? error.message : String(error)))
      .finally(() => props.onSending(false))
  }
  const submitFeedback = () => {
    if (!feedbackPreview) return
    props.onSending(true); props.onError(undefined)
    void import('../agent/reviewFeedbackRun.ts').then(({ submitReviewFeedback }) => submitReviewFeedback(props.snapshotId, feedbackPreview)).then((result) => {
      setFeedbackPreview(undefined)
      if (result.comparisonTarget) props.onOpenTarget?.(result.comparisonTarget, '審查 A → B')
      if (result.run.skipped) props.onError(result.run.error || '此 bundle 已送出。')
    }).catch((error) => props.onError(error instanceof Error ? error.message : String(error))).finally(() => props.onSending(false))
  }
  return <section className="shrink-0 border-t border-line bg-surface-container-low p-2" aria-label="Pinned comments">
    <div className="flex flex-col gap-2 sm:flex-row">
      <select value={props.anchorId} onChange={(event) => props.onAnchorId(event.target.value)} disabled={Boolean(props.editingId) || !props.anchors.length} aria-label="Review comment hunk" className="w-full border border-line bg-surface px-2 py-1.5 text-[10px] text-ink disabled:opacity-50 sm:max-w-44">{props.anchors.map((anchor, index) => <option key={anchor.hunkId} value={anchor.hunkId}>Hunk {index + 1} · {anchor.side}:{anchor.line}</option>)}</select>
      <textarea value={props.body} onChange={(event) => props.onBody(event.target.value)} rows={2} placeholder="在選取 hunk 建立 durable draft…" aria-label="Review draft 內容" className="min-w-0 flex-1 resize-none border border-line bg-surface px-2 py-1.5 text-[11px] outline-none focus-visible:border-accent" />
      <button type="button" disabled={!props.body.trim() || (!props.editingId && !props.selectedAnchor)} onClick={save} className="self-stretch border border-line-strong px-3 text-[10px] text-ink-2 hover:bg-hover-2 disabled:opacity-35">{props.editingId ? '更新 draft' : '儲存 draft'}</button>
    </div>
    {props.error ? <p className="mt-1 text-[10px] text-red" role="alert">{props.error}</p> : null}
    {fileComments.length ? <div className="mt-2 max-h-28 space-y-1 overflow-y-auto custom-scrollbar">{fileComments.map((comment) => <div key={comment.id} className="flex items-start gap-2 border-t border-line pt-1.5 text-[10px]">
      <span className={`shrink-0 font-medium ${comment.status === 'outdated' ? 'text-orange' : 'text-accent-ink'}`}>{comment.status}</span><span className="min-w-0 flex-1 text-ink-2">{comment.body}{comment.status === 'outdated' ? <span className="mt-1 block font-[family-name:var(--font-mono)] text-ink-3">原始：{comment.anchor.originalContext}</span> : null}</span>
      {comment.status === 'draft' ? <><button type="button" onClick={() => { props.onBody(comment.body); props.onEditingId(comment.id) }} className="text-ink-3 hover:text-ink">編輯</button><button type="button" onClick={() => void window.subagents?.piHost?.review?.transitionComment(comment.id, 'submitted').then(props.onReload)} className="text-accent-ink">送出</button><button type="button" onClick={() => void window.subagents?.piHost?.review?.deleteDraft(comment.id).then(props.onReload)} className="text-red">刪除</button></> : null}
    </div>)}</div> : null}
    {feedbackPreview ? <FeedbackBundlePreview bundle={feedbackPreview} sending={props.sending} onCancel={() => setFeedbackPreview(undefined)} onConfirm={submitFeedback} /> : null}
    {!feedbackPreview && props.comments.some((comment) => comment.status === 'submitted' || comment.status === 'acknowledged') ? <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2"><p className="text-[9px] leading-relaxed text-ink-3">先由 Host 凍結 snapshot、workspace 與 anchors，確認預覽後才建立下一個 run。</p><button type="button" disabled={props.sending} onClick={previewFeedback} className="shrink-0 border border-accent px-3 py-1.5 text-[10px] font-medium text-accent-ink hover:bg-selected disabled:opacity-50">{props.sending ? '準備中…' : '預覽送交內容'}</button></div> : null}
  </section>
}

function FeedbackBundlePreview({ bundle, sending, onCancel, onConfirm }: { bundle: ReviewFeedbackBundle; sending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const paths = [...new Set(bundle.comments.map((comment) => comment.anchor.path))]
  return <section className="mt-2 border-t border-accent/40 pt-2" aria-label="Feedback bundle 預覽">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 text-[9px] leading-relaxed text-ink-3">
        <p className="text-[10px] font-semibold text-ink">確認送交 {bundle.comments.length} 則 comment</p>
        <p className="truncate font-[family-name:var(--font-mono)]">Snapshot {bundle.snapshotId} · Bundle {bundle.id}</p>
        <p className="truncate">Workspace {bundle.workspace.projectRoot}</p>
        <p className="truncate">{paths.join(' · ')}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" disabled={sending} onClick={onCancel} className="px-2 py-1 text-[10px] text-ink-3 hover:text-ink disabled:opacity-40">取消</button>
        <button type="button" disabled={sending} onClick={onConfirm} className="border border-accent px-3 py-1 text-[10px] font-medium text-accent-ink hover:bg-selected disabled:opacity-40">{sending ? '送出中…' : '確認並建立 Run'}</button>
      </div>
    </div>
  </section>
}

function ReviewFileNavigation({ state, files, selectedPath, comments, fileStates, query, statusFilter, reviewFilter, sort, searchRef, onQuery, onStatusFilter, onReviewFilter, onSort, onSelectPath, onLoadMore, onReload }: {
  state: LoadState
  files: ReviewFileManifestEntry[]
  selectedPath?: string
  comments: ReviewComment[]
  fileStates: ReviewFileState[]
  query: string
  statusFilter: StatusFilter
  reviewFilter: ReviewFilter
  sort: FileSort
  searchRef: React.RefObject<HTMLInputElement | null>
  onQuery: (value: string) => void
  onStatusFilter: (value: StatusFilter) => void
  onReviewFilter: (value: ReviewFilter) => void
  onSort: (value: FileSort) => void
  onSelectPath: (path?: string) => void
  onLoadMore: () => void
  onReload: () => void
}) {
  const clearFilters = () => { onQuery(''); onStatusFilter('all') }
  return <nav className="flex max-h-[42%] min-h-0 w-full shrink-0 flex-col border-b border-line bg-surface-container-lowest md:max-h-none md:w-[244px] md:border-b-0 md:border-r" aria-label="變更檔案">
    <div className="space-y-2 border-b border-line p-2">
      <label className="flex h-8 items-center gap-2 border border-line bg-surface px-2 focus-within:border-accent">
        <Icon name="search" size={15} className="text-ink-3" />
        <input ref={searchRef} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜尋路徑 ⌘F" aria-label="搜尋變更檔案" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-ink-3" />
      </label>
      <div className="grid grid-cols-3 gap-1">
        <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as StatusFilter)} aria-label="依狀態篩選" className="h-7 border border-line bg-surface px-1 text-[10px] outline-none focus-visible:border-accent"><option value="all">全部狀態</option><option value="added">新增</option><option value="modified">修改</option><option value="deleted">刪除</option><option value="renamed">重新命名</option><option value="untracked">未追蹤</option></select>
        <select value={sort} onChange={(event) => onSort(event.target.value as FileSort)} aria-label="排序變更檔案" className="h-7 border border-line bg-surface px-1 text-[10px] outline-none focus-visible:border-accent"><option value="path">路徑排序</option><option value="status">狀態排序</option></select>
        <select value={reviewFilter} onChange={(event) => onReviewFilter(event.target.value as ReviewFilter)} aria-label="依審查狀態篩選" className="h-7 border border-line bg-surface px-1 text-[10px] outline-none focus-visible:border-accent"><option value="all">全部審查</option><option value="unreviewed">未審查</option><option value="reviewed">已審查</option><option value="changed-after-review">審後變更</option><option value="has-open-comments">有註解</option></select>
      </div>
    </div>
    <ReviewFileList state={state} files={files} selectedPath={selectedPath} comments={comments} fileStates={fileStates} onSelectPath={onSelectPath} onLoadMore={onLoadMore} onClearFilters={clearFilters} onReload={onReload} />
  </nav>
}

function ReviewFileList({ state, files, selectedPath, comments, fileStates, onSelectPath, onLoadMore, onClearFilters, onReload }: {
  state: LoadState
  files: ReviewFileManifestEntry[]
  selectedPath?: string
  comments: ReviewComment[]
  fileStates: ReviewFileState[]
  onSelectPath: (path?: string) => void
  onLoadMore: () => void
  onClearFilters: () => void
  onReload: () => void
}) {
  if (state.kind === 'loading') return <ReviewState icon="progress_activity" title="載入 review manifest…" detail="切換 target 時會取消前一個請求。" spinning />
  if (state.kind !== 'ready') return <ReviewState icon={state.kind === 'failed' ? 'error' : 'link_off'} title={state.kind === 'failed' ? '無法載入審查' : '來源尚未連線'} detail={state.message} action="重試" onAction={onReload} />
  if (state.artifact.status === 'pending') return <ReviewState icon="schedule" title="審查快照等待建立" detail="Task run 尚未進入 snapshot capture。" />
  if (state.artifact.status === 'capturing') return <ReviewState icon="progress_activity" title="正在建立審查快照" detail="Host 正在保存 manifest 與 bounded payload。" spinning />
  if (state.artifact.status === 'failed') return <ReviewState icon="error" title="審查資料建立失敗" detail={state.artifact.diagnostics.join(' · ') || 'Host 未能完成 snapshot capture。'} action="重試" onAction={onReload} />
  if (state.artifact.status === 'missing') return <ReviewState icon="search_off" title="審查資料遺失" detail={state.artifact.diagnostics.join(' · ') || 'Snapshot metadata 存在，但 payload 或 backing artifact 不可用。'} action="重試" onAction={onReload} />
  if (state.artifact.status === 'deleted') return <ReviewState icon="delete" title="審查資料已刪除" detail={state.artifact.diagnostics.join(' · ') || '此 snapshot 已依 retention 或 hard-delete policy 移除。'} />
  if (state.artifact.status === 'stale') return <ReviewState icon="history" title="審查來源已過期" detail="重新整理 mutable target 後再繼續。" action="重新整理" onAction={onReload} />
  if (!files.length) return <ReviewState icon="filter_alt_off" title="沒有符合的檔案" detail="清除搜尋或篩選條件。" action="清除篩選" onAction={onClearFilters} />
  return <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" role="listbox" aria-label={`${files.length} 個變更檔案`}>
    {files.map((file) => {
      const reviewState = fileReviewState(file, fileStates.find((item) => item.path === file.path), comments)
      return <button key={`${file.oldPath || ''}:${file.path}`} type="button" role="option" aria-selected={file.path === selectedPath} onClick={() => onSelectPath(file.path)} className={`flex w-full items-center gap-2 border-b border-line/60 px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${file.path === selectedPath ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover-2'}`}>
        <span className="w-4 shrink-0 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-accent-ink">{STATUS_LABEL[file.status]}</span><span className="min-w-0 flex-1 truncate text-[11px]" title={file.path}>{file.path}</span>
        {reviewState === 'reviewed' ? <Icon name="check_circle" size={13} className="text-green" /> : null}{reviewState === 'has-open-comments' ? <Icon name="comment" size={13} className="text-orange" /> : null}{file.binary ? <Icon name="deployed_code" size={13} className="text-ink-3" /> : null}
        <span className="shrink-0 font-[family-name:var(--font-mono)] text-[9px] text-ink-3">{file.additions ?? 0}+ {file.removals ?? 0}−</span>
      </button>
    })}
    {state.artifact.nextCursor ? <button type="button" onClick={onLoadMore} className="w-full border-b border-line px-3 py-2 text-[10px] text-accent-ink hover:bg-hover-2 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent">載入更多（{state.artifact.manifest.length}/{state.artifact.total}）</button> : null}
  </div>
}

function firstChangedLine(hunk: ReviewHunkView): CommentAnchorSelection | undefined {
  const match = hunk.header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) return undefined
  let oldLine = Number(match[1])
  let newLine = Number(match[2])
  for (const value of hunk.content.split('\n').slice(1)) {
    if (value.startsWith('+') && !value.startsWith('+++')) return { hunkId: hunk.id, label: hunk.header, side: 'new', line: newLine }
    if (value.startsWith('-') && !value.startsWith('---')) return { hunkId: hunk.id, label: hunk.header, side: 'old', line: oldLine }
    if (!value.startsWith('+')) oldLine += 1
    if (!value.startsWith('-')) newLine += 1
  }
  return undefined
}

function commentAnchorsFor(hunks: ReviewHunkView[]): CommentAnchorSelection[] {
  return hunks.map(firstChangedLine).filter((anchor): anchor is CommentAnchorSelection => Boolean(anchor))
}

function SnapshotDiff({ target, file, view, foldContext, onCommentAnchors }: { target: ReviewTarget; file: ReviewFileManifestEntry; view: 'unified' | 'split'; foldContext: boolean; onCommentAnchors?: (anchors: CommentAnchorSelection[]) => void }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; hunks: ReviewHunkView[]; nextCursor?: string } | { kind: 'failed'; message: string }>({ kind: 'loading' })
  const [activeHunkIndex, setActiveHunkIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (file.binary) { setState({ kind: 'failed', message: 'Binary 或不支援格式不提供文字 diff；可複製路徑後使用對應檢視器。' }); return () => controller.abort() }
    setState({ kind: 'loading' })
    const readFileDiff = window.subagents?.piHost?.review?.readFileDiff
    if (typeof readFileDiff !== 'function') { setState({ kind: 'failed', message: 'Review diff projection bridge 不可用。' }); return () => controller.abort() }
    void readFileDiff({ target, path: file.path, maxBytes: 64 * 1024 })
      .then(({ reviewDiff }) => { if (!controller.signal.aborted) { setState({ kind: 'ready', hunks: reviewDiff.items, nextCursor: reviewDiff.nextCursor }); onCommentAnchors?.(commentAnchorsFor(reviewDiff.items)) } })
      .catch((error) => { if (!controller.signal.aborted) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }) })
    return () => controller.abort()
  }, [file.binary, file.path, onCommentAnchors, target])
  if (state.kind === 'loading') return <ReviewState icon="progress_activity" title="載入 hunks…" detail="內容以 Host bounded pages 讀取。" spinning />
  if (state.kind === 'failed') return <ReviewState icon={file.binary ? 'deployed_code' : 'warning'} title={file.binary ? 'Binary change' : '無法顯示 diff'} detail={state.message} action="複製路徑" onAction={() => void navigator.clipboard.writeText(file.path)} />
  const reviewHunks = state.hunks.filter((hunk) => hunk.header.startsWith('@@'))
  const activeHunk = reviewHunks[Math.min(activeHunkIndex, Math.max(0, reviewHunks.length - 1))]
  const moveHunk = (offset: number) => {
    if (!reviewHunks.length) return
    const next = (activeHunkIndex + offset + reviewHunks.length) % reviewHunks.length
    setActiveHunkIndex(next)
    containerRef.current?.querySelector<HTMLElement>(`[data-review-hunk="${next}"]`)?.scrollIntoView({ block: 'center' })
  }
  const loadMore = () => {
    if (state.kind !== 'ready' || !state.nextCursor) return
    const cursor = state.nextCursor
    void window.subagents?.piHost?.review?.readFileDiff({ target, path: file.path, cursor, maxBytes: 64 * 1024 }).then(({ reviewDiff }) => {
      const hunks = [...state.hunks, ...reviewDiff.items]
      setState({ kind: 'ready', hunks, nextCursor: reviewDiff.nextCursor })
      onCommentAnchors?.(commentAnchorsFor(hunks))
    }).catch((error) => setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }))
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-container-lowest">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-surface-container-low px-2 text-[9px] text-ink-3">
        <button type="button" disabled={!reviewHunks.length} onClick={() => moveHunk(-1)} className="px-2 py-1 hover:text-ink disabled:opacity-40">上一 hunk</button><button type="button" disabled={!reviewHunks.length} onClick={() => moveHunk(1)} className="px-2 py-1 hover:text-ink disabled:opacity-40">下一 hunk</button><span>{reviewHunks.length ? `${activeHunkIndex + 1}/${reviewHunks.length}` : '0 hunks'}</span>
        <button type="button" disabled={!activeHunk} onClick={() => activeHunk && void navigator.clipboard.writeText(activeHunk.content)} className="ml-auto px-2 py-1 hover:text-ink disabled:opacity-40">複製 hunk</button><button type="button" onClick={() => void navigator.clipboard.writeText(state.hunks.map((hunk) => hunk.content).join(''))} className="px-2 py-1 hover:text-ink">複製 patch</button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto custom-scrollbar" tabIndex={0} aria-label={`${file.path} diff`}>
        <div className={view === 'split' ? 'min-w-[760px]' : 'min-w-max'}>
          {state.hunks.map((hunk) => {
            const reviewIndex = reviewHunks.findIndex((candidate) => candidate.id === hunk.id)
            const lines = foldContext ? foldContextLines(hunk.content.split('\n')) : hunk.content.split('\n')
            return <section key={hunk.id} data-review-hunk={reviewIndex >= 0 ? reviewIndex : undefined} onClick={() => { if (reviewIndex >= 0) setActiveHunkIndex(reviewIndex) }} className={reviewIndex === activeHunkIndex && reviewIndex >= 0 ? 'border-l-2 border-accent' : 'border-l-2 border-transparent'}>
              {view === 'unified' ? lines.map((line, index) => <DiffLine key={index} line={line} />) : <div className="grid grid-cols-2"><SplitLines lines={lines} /></div>}
            </section>
          })}
          {state.nextCursor ? <button type="button" onClick={loadMore} className="col-span-2 m-3 border border-line px-3 py-2 text-[10px] text-accent-ink hover:bg-hover-2">載入更多 hunks</button> : null}
        </div>
      </div>
    </div>
  )
}

function DiffLine({ line }: { line: string }) {
  const tone = line.startsWith('+') && !line.startsWith('+++') ? 'bg-green/10 text-green' : line.startsWith('-') && !line.startsWith('---') ? 'bg-red/10 text-red' : line.startsWith('@@') ? 'bg-selected text-accent-ink' : 'text-ink-2'
  return <div className={`whitespace-pre px-3 font-[family-name:var(--font-mono)] text-[11px] leading-5 ${tone}`}>{line || ' '}</div>
}

function foldContextLines(lines: string[]): string[] {
  const changed = new Set(lines.flatMap((line, index) => line.startsWith('+') && !line.startsWith('+++') || line.startsWith('-') && !line.startsWith('---') ? [index] : []))
  const result: string[] = []
  let omitted = 0
  const flush = () => { if (omitted) result.push(` … ${omitted} unchanged lines …`); omitted = 0 }
  lines.forEach((line, index) => {
    const keep = !line.startsWith(' ') || [...changed].some((changedIndex) => Math.abs(changedIndex - index) <= 2)
    if (!keep) { omitted += 1; return }
    flush(); result.push(line)
  })
  flush()
  return result
}

function SplitLines({ lines }: { lines: string[] }) {
  const rows: Array<[string, string]> = []
  let removed: string[] = []
  let added: string[] = []
  const flush = () => {
    const count = Math.max(removed.length, added.length)
    for (let index = 0; index < count; index += 1) rows.push([removed[index] || '', added[index] || ''])
    removed = []; added = []
  }
  for (const line of lines) {
    if (line.startsWith('-') && !line.startsWith('---')) { removed.push(line); continue }
    if (line.startsWith('+') && !line.startsWith('+++')) { added.push(line); continue }
    flush(); rows.push([line, line])
  }
  flush()
  return <>{rows.map(([left, right], index) => <div key={index} className="contents"><DiffLine line={left} /><div className="border-l border-line"><DiffLine line={right} /></div></div>)}</>
}

function ReviewState({ icon, title, detail, action, onAction, spinning = false }: { icon: string; title: string; detail: string; action?: string; onAction?: () => void; spinning?: boolean }) {
  return <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 p-5 text-center" role="status">
    <Icon name={icon} size={22} className={`${spinning ? 'animate-spin motion-reduce:animate-none' : ''} text-ink-3`} />
    <p className="text-[12px] font-medium text-ink-2">{title}</p><p className="max-w-sm text-[10px] leading-relaxed text-ink-3">{detail}</p>
    {action && onAction ? <button type="button" onClick={onAction} className="mt-1 border border-line-strong px-2.5 py-1.5 text-[10px] text-ink-2 hover:bg-hover-2 focus-visible:outline-2 focus-visible:outline-accent">{action}</button> : null}
  </div>
}
