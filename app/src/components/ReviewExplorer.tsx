import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { ReviewFileManifestEntry, ReviewTarget } from '../agent/reviewContract.ts'
import { fileReviewState, type ReviewComment, type ReviewFileState } from '../agent/reviewStateContract.ts'
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
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewFileManifestEntry['status']>('all')
  const [reviewFilter, setReviewFilter] = useState<'all' | 'unreviewed' | 'reviewed' | 'changed-after-review' | 'has-open-comments'>('all')
  const [sort, setSort] = useState<'path' | 'status'>('path')
  const [view, setView] = useState<'unified' | 'split'>('unified')
  const [foldContext, setFoldContext] = useState(false)
  const [reload, setReload] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [fileStates, setFileStates] = useState<ReviewFileState[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string>()
  const [commentError, setCommentError] = useState<string>()
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
      <header className="shrink-0 border-b border-line bg-surface-container-low px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[12px] font-semibold">{SOURCE_LABEL[target.kind]}</span>
          <span className="truncate font-[family-name:var(--font-mono)] text-[10px] text-ink-3">{targetIdentity(target)}</span>
          <span className={`ml-auto shrink-0 text-[10px] ${target.kind === 'live-working-tree' || target.kind === 'staged' ? 'text-orange' : 'text-green'}`}>
            {target.kind === 'live-working-tree' || target.kind === 'staged' ? '可變 · 需刷新' : '固定來源'}
          </span>
          {target.kind === 'live-working-tree' || target.kind === 'staged' ? <button type="button" onClick={() => {
            void window.subagents?.piHost?.review?.refresh(target).then(() => setReload((value) => value + 1)).catch(() => setReload((value) => value + 1))
          }} className="shrink-0 p-1 text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent" aria-label="刷新可變審查來源"><Icon name="refresh" size={14} /></button> : null}
        </div>
        {state.kind === 'ready' ? (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
            <span>{state.artifact.status}</span><span>·</span><span>{state.artifact.attributionFidelity} attribution</span>
            {state.artifact.manifestHash ? <span className="truncate font-[family-name:var(--font-mono)]">· {state.artifact.manifestHash.slice(0, 10)}</span> : null}
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex max-h-[42%] min-h-0 w-full shrink-0 flex-col border-b border-line bg-surface-container-lowest md:max-h-none md:w-[244px] md:border-b-0 md:border-r" aria-label="變更檔案">
          <div className="space-y-2 border-b border-line p-2">
            <label className="flex h-8 items-center gap-2 border border-line bg-surface px-2 focus-within:border-accent">
              <Icon name="search" size={15} className="text-ink-3" />
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋路徑 ⌘F" aria-label="搜尋變更檔案" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-ink-3" />
            </label>
            <div className="grid grid-cols-3 gap-1">
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="依狀態篩選" className="h-7 border border-line bg-surface px-1 text-[10px] outline-none focus-visible:border-accent">
                <option value="all">全部狀態</option><option value="added">新增</option><option value="modified">修改</option><option value="deleted">刪除</option><option value="renamed">重新命名</option><option value="untracked">未追蹤</option>
              </select>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序變更檔案" className="h-7 border border-line bg-surface px-1 text-[10px] outline-none focus-visible:border-accent">
                <option value="path">路徑排序</option><option value="status">狀態排序</option>
              </select>
              <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)} aria-label="依審查狀態篩選" className="h-7 border border-line bg-surface px-1 text-[10px] outline-none focus-visible:border-accent">
                <option value="all">全部審查</option><option value="unreviewed">未審查</option><option value="reviewed">已審查</option><option value="changed-after-review">審後變更</option><option value="has-open-comments">有註解</option>
              </select>
            </div>
          </div>
          {state.kind === 'ready' ? (
            files.length ? <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" role="listbox" aria-label={`${files.length} 個變更檔案`}>
              {files.map((file) => (
                <button key={`${file.oldPath || ''}:${file.path}`} type="button" role="option" aria-selected={file.path === selectedPath} onClick={() => onSelectPath(file.path)}
                  className={`flex w-full items-center gap-2 border-b border-line/60 px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${file.path === selectedPath ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover-2'}`}>
                  <span className="w-4 shrink-0 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-accent-ink">{STATUS_LABEL[file.status]}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px]" title={file.path}>{file.path}</span>
                  {fileReviewState(file, fileStates.find((item) => item.path === file.path), comments) === 'reviewed' ? <Icon name="check_circle" size={13} className="text-green" /> : null}
                  {fileReviewState(file, fileStates.find((item) => item.path === file.path), comments) === 'has-open-comments' ? <Icon name="comment" size={13} className="text-orange" /> : null}
                  {file.binary ? <Icon name="deployed_code" size={13} className="text-ink-3" /> : null}
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-[9px] text-ink-3">{file.additions ?? 0}+ {file.removals ?? 0}−</span>
                </button>
              ))}
              {state.artifact.nextCursor ? <button type="button" onClick={loadMore} className="w-full border-b border-line px-3 py-2 text-[10px] text-accent-ink hover:bg-hover-2 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent">載入更多（{state.artifact.manifest.length}/{state.artifact.total}）</button> : null}
            </div> : <ReviewState icon="filter_alt_off" title="沒有符合的檔案" detail="清除搜尋或篩選條件。" action="清除篩選" onAction={() => { setQuery(''); setStatusFilter('all') }} />
          ) : state.kind === 'loading' ? <ReviewState icon="progress_activity" title="載入 review manifest…" detail="切換 target 時會取消前一個請求。" spinning />
            : <ReviewState icon={state.kind === 'failed' ? 'error' : 'link_off'} title={state.kind === 'failed' ? '無法載入審查' : '來源尚未連線'} detail={state.message} action="重試" onAction={() => setReload((value) => value + 1)} />}
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Diff viewer">
          {state.kind === 'ready' && state.artifact.status === 'partial' ? (
            <div className="border-b border-orange/40 bg-orange/10 px-3 py-2 text-[10px] text-orange" role="status">部分快照：{state.artifact.diagnostics.join(' · ') || 'Host 已標記 omitted content。'}</div>
          ) : null}
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
            <button type="button" onClick={() => moveSelection(-1)} disabled={!files.length} className="p-1.5 text-ink-3 hover:text-ink disabled:opacity-35" aria-label="上一個變更（⌥↑）"><Icon name="keyboard_arrow_up" size={17} /></button>
            <button type="button" onClick={() => moveSelection(1)} disabled={!files.length} className="p-1.5 text-ink-3 hover:text-ink disabled:opacity-35" aria-label="下一個變更（⌥↓）"><Icon name="keyboard_arrow_down" size={17} /></button>
            <span className="min-w-0 flex-1 truncate px-1 font-[family-name:var(--font-mono)] text-[10px] text-ink-2">{activeFile?.path || '選擇檔案'}</span>
            {activeFile ? <button type="button" onClick={() => void navigator.clipboard.writeText(activeFile.path)} className="p-1.5 text-ink-3 hover:text-ink" aria-label="複製檔案路徑"><Icon name="content_copy" size={15} /></button> : null}
            {(target.kind === 'live-working-tree' || target.kind === 'staged') && activeFile ? <>
              {target.kind === 'live-working-tree' ? <select value={mutationOperation} onChange={(event) => { setMutationOperation(event.target.value as 'stage' | 'revert'); setMutationPreview(undefined) }} aria-label="Git 操作" className="h-7 border border-line bg-surface px-1 text-[10px]"><option value="stage">Stage</option><option value="revert">Revert</option></select> : <span className="text-[10px] text-ink-3">Unstage</span>}
              <select value={mutationHunk} onChange={(event) => { setMutationHunk(Number(event.target.value)); setMutationPreview(undefined) }} disabled={activeFile.binary} aria-label="Mutation 範圍" className="h-7 max-w-24 border border-line bg-surface px-1 text-[10px] disabled:opacity-50"><option value={-1}>整個檔案</option>{Array.from({ length: activeFile.hunkCount || 0 }, (_, index) => <option key={index} value={index}>Hunk {index + 1}</option>)}</select>
              <button type="button" disabled={mutationBusy} onClick={() => void previewMutation()} className="border border-line-strong px-2 py-1 text-[10px] text-ink-2 hover:bg-hover-2 disabled:opacity-40">{mutationBusy ? '處理中…' : '預覽'}</button>
            </> : null}
            {target.kind === 'run-snapshot' && activeFile?.contentHash ? <button type="button" onClick={() => {
              void window.subagents?.piHost?.review?.markReviewed({ snapshotId: target.snapshotId, path: activeFile.path, contentHash: activeFile.contentHash! }).then(reloadReviewState).catch((error) => setCommentError(error instanceof Error ? error.message : String(error)))
            }} className={`px-2 py-1 text-[10px] ${activeReviewState === 'reviewed' ? 'text-green' : 'text-ink-3 hover:text-ink'}`} aria-label="標記檔案為已審查"><Icon name={activeReviewState === 'reviewed' ? 'check_circle' : 'task_alt'} size={15} /></button> : null}
            <button type="button" aria-pressed={foldContext} onClick={() => setFoldContext((value) => !value)} className={`px-2 py-1 text-[10px] ${foldContext ? 'bg-selected text-ink' : 'text-ink-3 hover:text-ink'}`}>折疊 context</button>
            <div className="flex border border-line" aria-label="Diff 顯示方式">
              <button type="button" aria-pressed={view === 'unified'} onClick={() => setView('unified')} className={`px-2 py-1 text-[10px] ${view === 'unified' ? 'bg-selected text-ink' : 'text-ink-3'}`}>Unified</button>
              <button type="button" aria-pressed={view === 'split'} onClick={() => setView('split')} className={`px-2 py-1 text-[10px] ${view === 'split' ? 'bg-selected text-ink' : 'text-ink-3'}`}>Split</button>
            </div>
          </div>
          {mutationError ? <div className="border-b border-red/30 bg-red/5 px-3 py-1.5 text-[10px] text-red" role="alert">{mutationError}</div> : null}
          {mutationPreview ? <section className="shrink-0 border-b border-orange/40 bg-surface-container-low p-3" aria-label="Git mutation 精確預覽">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold text-ink">確認 {mutationPreview.operation} · {mutationPreview.selection.kind === 'file' ? '整個檔案' : `Hunk ${mutationPreview.selection.hunkIndex + 1}`}</p><p className="mt-1 font-[family-name:var(--font-mono)] text-[9px] text-ink-3">{mutationPreview.patchHash.slice(0, 16)} · {mutationPreview.patchBytes} bytes · +{mutationPreview.additions} −{mutationPreview.removals}</p></div><div className="flex gap-2"><button type="button" onClick={() => setMutationPreview(undefined)} className="px-2 py-1 text-[10px] text-ink-3 hover:text-ink">取消</button><button type="button" disabled={mutationBusy} onClick={() => void applyMutation()} className="border border-orange px-3 py-1 text-[10px] font-medium text-orange hover:bg-orange/10 disabled:opacity-40">送交核准</button></div></div>
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap border border-line bg-inset p-2 font-[family-name:var(--font-mono)] text-[9px] leading-relaxed text-ink-2">{mutationPreview.patch}</pre>
            {mutationPreview.operation === 'revert' ? <p className="mt-2 text-[9px] text-orange">Revert 套用前會保存 recoverable patch；核准拒絕、取消或 CAS stale 都不產生 side effect。</p> : null}
          </section> : null}
          {state.kind === 'ready' && activeFile ? <SnapshotDiff key={`${state.artifact.snapshotId}:${activeFile.path}`} target={target} file={activeFile} view={view} foldContext={foldContext} />
            : state.kind === 'ready' ? <ReviewState icon="difference" title="選擇一個變更" detail="使用檔案清單或 ⌥↑／⌥↓ 導覽。" /> : null}
          {target.kind === 'run-snapshot' && activeFile && !activeFile.binary ? <section className="shrink-0 border-t border-line bg-surface-container-low p-2" aria-label="Pinned comments">
            <div className="flex gap-2">
              <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} rows={2} placeholder="在目前 hunk 建立 durable draft…" aria-label="Review draft 內容" className="min-w-0 flex-1 resize-none border border-line bg-surface px-2 py-1.5 text-[11px] outline-none focus-visible:border-accent" />
              <button type="button" disabled={!commentBody.trim()} onClick={() => {
                setCommentError(undefined)
                void window.subagents?.piHost?.review?.saveDraft({ ...(editingCommentId ? { id: editingCommentId } : {}), snapshotId: target.snapshotId, path: activeFile.path, side: 'new', line: 1, body: commentBody }).then(() => { setCommentBody(''); setEditingCommentId(undefined); return reloadReviewState() }).catch((error) => setCommentError(error instanceof Error ? error.message : String(error)))
              }} className="self-stretch border border-line-strong px-3 text-[10px] text-ink-2 hover:bg-hover-2 disabled:opacity-35">{editingCommentId ? '更新 draft' : '儲存 draft'}</button>
            </div>
            {commentError ? <p className="mt-1 text-[10px] text-red" role="alert">{commentError}</p> : null}
            {comments.filter((comment) => comment.anchor.path === activeFile.path).length ? <div className="mt-2 max-h-28 space-y-1 overflow-y-auto custom-scrollbar">
              {comments.filter((comment) => comment.anchor.path === activeFile.path).map((comment) => <div key={comment.id} className="flex items-start gap-2 border-t border-line pt-1.5 text-[10px]">
                <span className={`shrink-0 font-medium ${comment.status === 'outdated' ? 'text-orange' : 'text-accent-ink'}`}>{comment.status}</span><span className="min-w-0 flex-1 text-ink-2">{comment.body}{comment.status === 'outdated' ? <span className="mt-1 block font-[family-name:var(--font-mono)] text-ink-3">原始：{comment.anchor.originalContext}</span> : null}</span>
                {comment.status === 'draft' ? <><button type="button" onClick={() => { setCommentBody(comment.body); setEditingCommentId(comment.id) }} className="text-ink-3 hover:text-ink">編輯</button><button type="button" onClick={() => void window.subagents?.piHost?.review?.transitionComment(comment.id, 'submitted').then(reloadReviewState)} className="text-accent-ink">送出</button><button type="button" onClick={() => void window.subagents?.piHost?.review?.deleteDraft(comment.id).then(reloadReviewState)} className="text-red">刪除</button></> : null}
              </div>)}
            </div> : null}
            {comments.some((comment) => comment.status === 'submitted' || comment.status === 'acknowledged') ? <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2">
              <p className="text-[9px] leading-relaxed text-ink-3">送出時由 Host 凍結 snapshot、workspace 與 anchors；外部 CLI 仍維持 reduced capability disclosure。</p>
              <button type="button" disabled={sendingFeedback} onClick={() => {
                setSendingFeedback(true); setCommentError(undefined)
                void import('../agent/reviewFeedbackRun.ts').then(({ submitReviewFeedback }) => submitReviewFeedback(target.snapshotId)).then((result) => {
                  if (result.comparisonTarget) onOpenTarget?.(result.comparisonTarget, '審查 A → B')
                  if (result.run.skipped) setCommentError(result.run.error || '此 bundle 已送出。')
                }).catch((error) => setCommentError(error instanceof Error ? error.message : String(error))).finally(() => setSendingFeedback(false))
              }} className="shrink-0 border border-accent px-3 py-1.5 text-[10px] font-medium text-accent-ink hover:bg-selected disabled:opacity-50">{sendingFeedback ? '送出中…' : '送交 Agent 修改'}</button>
            </div> : null}
          </section> : null}
          {target.kind === 'staged' ? <ReviewDeliveryPanel target={target} onOpenTarget={onOpenTarget} /> : null}
        </main>
      </div>
    </div>
  )
}

function SnapshotDiff({ target, file, view, foldContext }: { target: ReviewTarget; file: ReviewFileManifestEntry; view: 'unified' | 'split'; foldContext: boolean }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; content: string; nextCursor?: string } | { kind: 'failed'; message: string }>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    if (file.binary) { setState({ kind: 'failed', message: 'Binary 或不支援格式不提供文字 diff；可複製路徑後使用對應檢視器。' }); return () => controller.abort() }
    setState({ kind: 'loading' })
    const readFileDiff = window.subagents?.piHost?.review?.readFileDiff
    if (typeof readFileDiff !== 'function') { setState({ kind: 'failed', message: 'Review diff projection bridge 不可用。' }); return () => controller.abort() }
    void readFileDiff({ target, path: file.path, maxBytes: 64 * 1024 })
      .then(({ reviewDiff }) => { if (!controller.signal.aborted) setState({ kind: 'ready', content: reviewDiff.items.map((hunk) => hunk.content).join(''), nextCursor: reviewDiff.nextCursor }) })
      .catch((error) => { if (!controller.signal.aborted) setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }) })
    return () => controller.abort()
  }, [file.binary, file.path, target])
  if (state.kind === 'loading') return <ReviewState icon="progress_activity" title="載入 hunks…" detail="內容以 Host bounded pages 讀取。" spinning />
  if (state.kind === 'failed') return <ReviewState icon={file.binary ? 'deployed_code' : 'warning'} title={file.binary ? 'Binary change' : '無法顯示 diff'} detail={state.message} action="複製路徑" onAction={() => void navigator.clipboard.writeText(file.path)} />
  const lines = state.content.split('\n').filter((line) => !foldContext || !line.startsWith(' ') || line.startsWith('@@'))
  const loadMore = () => {
    if (state.kind !== 'ready' || !state.nextCursor) return
    const cursor = state.nextCursor
    void window.subagents?.piHost?.review?.readFileDiff({ target, path: file.path, cursor, maxBytes: 64 * 1024 }).then(({ reviewDiff }) => {
      setState((current) => current.kind === 'ready' && current.nextCursor === cursor ? { kind: 'ready', content: current.content + reviewDiff.items.map((hunk) => hunk.content).join(''), nextCursor: reviewDiff.nextCursor } : current)
    }).catch((error) => setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }))
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto custom-scrollbar bg-surface-container-lowest" tabIndex={0} aria-label={`${file.path} diff`}>
      <div className={view === 'split' ? 'grid min-w-[760px] grid-cols-2' : 'min-w-max'}>
        {view === 'unified' ? lines.map((line, index) => <DiffLine key={index} line={line} />) : <SplitLines lines={lines} />}
        {state.nextCursor ? <button type="button" onClick={loadMore} className="col-span-2 m-3 border border-line px-3 py-2 text-[10px] text-accent-ink hover:bg-hover-2">載入更多 hunks</button> : null}
      </div>
    </div>
  )
}

function DiffLine({ line }: { line: string }) {
  const tone = line.startsWith('+') && !line.startsWith('+++') ? 'bg-green/10 text-green' : line.startsWith('-') && !line.startsWith('---') ? 'bg-red/10 text-red' : line.startsWith('@@') ? 'bg-selected text-accent-ink' : 'text-ink-2'
  return <div className={`whitespace-pre px-3 font-[family-name:var(--font-mono)] text-[11px] leading-5 ${tone}`}>{line || ' '}</div>
}

function SplitLines({ lines }: { lines: string[] }) {
  const left = lines.filter((line) => !line.startsWith('+') || line.startsWith('+++'))
  const right = lines.filter((line) => !line.startsWith('-') || line.startsWith('---'))
  const count = Math.max(left.length, right.length)
  return <>{Array.from({ length: count }, (_, index) => <div key={index} className="contents"><DiffLine line={left[index] || ''} /><div className="border-l border-line"><DiffLine line={right[index] || ''} /></div></div>)}</>
}

function ReviewState({ icon, title, detail, action, onAction, spinning = false }: { icon: string; title: string; detail: string; action?: string; onAction?: () => void; spinning?: boolean }) {
  return <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 p-5 text-center" role="status">
    <Icon name={icon} size={22} className={`${spinning ? 'animate-spin motion-reduce:animate-none' : ''} text-ink-3`} />
    <p className="text-[12px] font-medium text-ink-2">{title}</p><p className="max-w-sm text-[10px] leading-relaxed text-ink-3">{detail}</p>
    {action && onAction ? <button type="button" onClick={onAction} className="mt-1 border border-line-strong px-2.5 py-1.5 text-[10px] text-ink-2 hover:bg-hover-2 focus-visible:outline-2 focus-visible:outline-accent">{action}</button> : null}
  </div>
}
