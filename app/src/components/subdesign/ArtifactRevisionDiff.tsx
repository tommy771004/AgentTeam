import { useEffect, useMemo, useRef, useState } from 'react'
import type { RevisionDiffFile, RevisionDiffResult, RevisionDiffRow } from '../../agent/subdesign/artifactSnapshots.ts'
import { useSubDesignArtifactStore } from '../../store/subDesignArtifactStore.ts'

const EMPTY_REVISIONS: number[] = []

function rowTone(kind: RevisionDiffRow['kind'], side: 'left' | 'right'): string {
  if (kind === 'added' && side === 'right') return 'bg-primary/[0.07] text-on-surface'
  if (kind === 'removed' && side === 'left') return 'bg-error/[0.07] text-on-surface'
  if (kind === 'changed') return side === 'left'
    ? 'bg-error/[0.055] text-on-surface'
    : 'bg-primary/[0.055] text-on-surface'
  return 'text-on-surface-variant'
}

function statusLabel(status: RevisionDiffFile['status']): string {
  if (status === 'added') return '新增檔案'
  if (status === 'removed') return '刪除檔案'
  if (status === 'changed') return '內容變更'
  return '未變更'
}

function DiffCell({ row, side }: { row: RevisionDiffRow; side: 'left' | 'right' }) {
  const line = side === 'left' ? row.left : row.right
  return (
    <div className={`grid min-h-7 grid-cols-[42px_minmax(0,1fr)] ${rowTone(row.kind, side)}`}>
      <span className="select-none px-2 py-1 text-right font-mono text-[10px] text-outline/70" aria-hidden="true">
        {line?.lineNumber || ''}
      </span>
      <code className="min-w-0 whitespace-pre-wrap break-words px-2 py-1 font-mono text-[11px] leading-5">
        {line?.content ?? ''}
      </code>
    </div>
  )
}

export function ArtifactRevisionDiff({ artifactId, projectRoot }: { artifactId: string; projectRoot?: string }) {
  const snapshotEntries = useSubDesignArtifactStore((state) => state.snapshots[artifactId])
  const diffRevisions = useSubDesignArtifactStore((state) => state.diffRevisions)
  const revisions = useMemo(
    () => snapshotEntries
      ? [...new Set(snapshotEntries.map((snapshot) => snapshot.revision))].sort((a, b) => a - b)
      : EMPTY_REVISIONS,
    [snapshotEntries],
  )
  const [revisionA, setRevisionA] = useState<number | null>(null)
  const [revisionB, setRevisionB] = useState<number | null>(null)
  const [result, setResult] = useState<RevisionDiffResult | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const comparisonGeneration = useRef(0)

  useEffect(() => {
    comparisonGeneration.current += 1
    const latest = revisions.at(-1) ?? null
    const previous = revisions.at(-2) ?? null
    setRevisionA(previous)
    setRevisionB(latest)
    setResult(null)
    setSelectedPath('')
    setMessage(revisions.length < 2 ? '至少需要兩個有快照的 revision 才能比較。' : '')
  }, [artifactId, revisions])

  const compare = async () => {
    if (revisionA == null || revisionB == null || revisionA === revisionB) {
      setMessage('請選擇兩個不同的 revision。')
      return
    }
    const generation = ++comparisonGeneration.current
    setLoading(true)
    setMessage('')
    setResult(null)
    setSelectedPath('')
    try {
      const response = await diffRevisions(artifactId, revisionA, revisionB, projectRoot)
      if (generation !== comparisonGeneration.current) return
      if (!response.ok) {
        setResult(null)
        setSelectedPath('')
        setMessage(response.reason)
        return
      }
      setResult(response.diff)
      const firstChanged = response.diff.files.find((file) => file.status !== 'unchanged')
      setSelectedPath(firstChanged?.path || '')
    } catch (error) {
      if (generation !== comparisonGeneration.current) return
      setResult(null)
      setSelectedPath('')
      setMessage(error instanceof Error ? error.message : '版本比較失敗。')
    } finally {
      if (generation === comparisonGeneration.current) setLoading(false)
    }
  }

  const changedFiles = result?.files.filter((file) => file.status !== 'unchanged') || []
  const selectedFile = changedFiles.find((file) => file.path === selectedPath) || null

  return (
    <section className="flex min-h-[420px] flex-1 flex-col bg-surface-container-low/20" aria-label="Artifact revision comparison" aria-busy={loading}>
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <div className="mr-auto min-w-[190px]">
          <h2 className="text-[12px] font-semibold text-on-surface">Revision 比較</h2>
          <p className="mt-1 text-[10px] text-outline">從保存的快照讀取內容，不會修改 workspace。</p>
        </div>
        <label className="grid gap-1 text-[9px] text-outline">
          基準
          <select
            value={revisionA ?? ''}
            disabled={revisions.length < 2 || loading}
            onChange={(event) => {
              setRevisionA(Number(event.target.value))
              setResult(null)
              setSelectedPath('')
              setMessage('')
            }}
            className="h-8 min-w-24 bg-white/[0.04] px-2 text-[10px] text-on-surface outline-none disabled:opacity-45"
          >
            {revisions.map((revision) => <option key={revision} value={revision}>revision {revision}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[9px] text-outline">
          比較
          <select
            value={revisionB ?? ''}
            disabled={revisions.length < 2 || loading}
            onChange={(event) => {
              setRevisionB(Number(event.target.value))
              setResult(null)
              setSelectedPath('')
              setMessage('')
            }}
            className="h-8 min-w-24 bg-white/[0.04] px-2 text-[10px] text-on-surface outline-none disabled:opacity-45"
          >
            {revisions.map((revision) => <option key={revision} value={revision}>revision {revision}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={revisions.length < 2 || loading}
          onClick={() => { void compare() }}
          className="h-8 bg-white/[0.08] px-3 text-[10px] font-semibold text-on-surface transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? '讀取中' : '比較版本'}
        </button>
      </div>

      {message ? <div role="status" className="px-4 py-3 text-[11px] text-outline">{message}</div> : null}

      {result ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 bg-white/[0.025] px-4 py-2">
            {changedFiles.length > 0 ? (
              <label className="flex min-w-0 items-center gap-2 text-[10px] text-outline">
                檔案
                <select
                  value={selectedPath}
                  onChange={(event) => setSelectedPath(event.target.value)}
                  className="h-7 max-w-[360px] min-w-[180px] bg-transparent text-[10px] text-on-surface outline-none"
                >
                  {changedFiles.map((file) => (
                    <option key={file.path} value={file.path}>{file.path} · {statusLabel(file.status)}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="text-[10px] text-outline">
              r{result.revisionA} → r{result.revisionB} · {changedFiles.length} 個檔案有差異
            </span>
          </div>

          {selectedFile ? (
            <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
              <div className="sticky top-0 z-10 grid grid-cols-2 bg-surface-container-low text-[10px] font-medium text-outline">
                <div className="px-3 py-2">revision {result.revisionA}</div>
                <div className="px-3 py-2">revision {result.revisionB}</div>
              </div>
              <div className="min-w-[680px]">
                {selectedFile.rows.map((row, index) => (
                  <div key={`${selectedFile.path}:${index}`} className="grid grid-cols-2">
                    <DiffCell row={row} side="left" />
                    <DiffCell row={row} side="right" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 py-6 text-[11px] text-outline">這兩個 revision 的內容相同。</div>
          )}
        </div>
      ) : null}
    </section>
  )
}
