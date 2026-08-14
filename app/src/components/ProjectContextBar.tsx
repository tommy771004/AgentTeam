import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useProjectStore } from '../store/projectStore'

/**
 * 專案目錄 pill：點擊 → 系統資料夾選單（Finder / Explorer）
 * 選單：更換目錄 / 手輸 / worktrees
 */
export function ProjectContextBar() {
  const {
    name,
    source,
    branch,
    root,
    worktrees,
    dirty,
    loaded,
    error,
    picking,
    manualPathOpen,
    pickFolder,
    refresh,
    selectWorktree,
    clearError,
    openManualPath,
    closeManualPath,
    submitManualPath,
    bindMenuPick,
  } = useProjectStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // App 選單 ⌘O / 系統匣「選擇專案資料夾」
  useEffect(() => {
    return bindMenuPick()
  }, [bindMenuPick])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [menuOpen])

  useEffect(() => {
    if (manualPathOpen) {
      setManualPath(root || '')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [manualPathOpen, root])

  const sourceLabel = source === 'github' ? 'GitHub' : '本機'
  const hasNativePick = Boolean(window.subagents?.project?.pick)

  const onPick = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    e?.preventDefault()
    clearError()
    setMenuOpen(false)
    await pickFolder()
  }

  const onSubmitManual = async () => {
    const ok = await submitManualPath(manualPath)
    if (ok) setMenuOpen(false)
  }

  return (
    <div className="agent-project-context relative flex flex-wrap items-center gap-1.5" ref={ref}>
      {/* Primary: open system folder dialog */}
      <div className="agent-project-picker inline-flex items-center rounded-full border border-line bg-inset overflow-hidden max-w-[240px] shadow-hairline">
        <button
          type="button"
          disabled={picking}
          onClick={(e) => void onPick(e)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-ink hover:bg-hover-2 disabled:opacity-50 min-w-0"
          title={
            root
              ? `${root}\n點擊開啟系統資料夾選單`
              : '點擊開啟系統資料夾選單選擇專案'
          }
        >
          <Icon
            name={picking ? 'progress_activity' : 'folder_open'}
            size={14}
            className={`text-accent-ink shrink-0 ${picking ? 'animate-spin' : ''}`}
          />
          <span className="truncate font-medium">
            {picking ? '選擇中…' : loaded ? name || '選擇專案' : '…'}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((o) => !o)
          }}
            className="px-1.5 py-1 border-l border-line text-ink-3 hover:bg-hover-2 hover:text-ink"
          title="專案詳情 / 工作樹"
        >
          <Icon name="expand_more" size={14} />
        </button>
      </div>

      <span className="agent-project-source inline-flex items-center gap-1 px-2 py-1 rounded-full border border-line bg-inset text-[11px] text-ink-2">
        <Icon
          name={source === 'github' ? 'cloud' : 'computer'}
          size={13}
          className="opacity-70"
        />
        {sourceLabel}
      </span>

      {branch && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(true)
          }}
          className="agent-project-branch inline-flex items-center gap-1 px-2 py-1 rounded-full border border-line bg-inset text-[11px] text-ink-2 max-w-[140px]"
          title="Git 工作樹 / 分支"
        >
          <Icon name="account_tree" size={13} className="opacity-70 shrink-0" />
          <span className="truncate font-[family-name:var(--font-mono)]">{branch}</span>
          {dirty && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
              title="有未提交變更"
            />
          )}
        </button>
      )}

      {error && !manualPathOpen && (
        <span className="text-[10px] text-red max-w-[220px] truncate" title={error}>
          {error}
        </span>
      )}

      {menuOpen && (
        <div
          className="agent-project-menu absolute left-0 top-full mt-1.5 z-[95] w-80 rounded-card border border-line bg-surface shadow-raised overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-line text-[11px] text-ink-3 font-medium">
            專案與工作樹
          </div>
          <div className="px-3 py-2 text-[10px] text-ink-3 font-[family-name:var(--font-mono)] break-all">
            {root || '尚未選擇目錄'}
          </div>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-hover-2"
            onClick={(e) => void onPick(e)}
          >
            <Icon name="folder_open" size={16} className="text-accent-ink" />
            <span className="flex flex-col items-start gap-0.5">
              <span>{root ? '更換專案目錄…' : '選擇專案目錄…'}</span>
              <span className="text-[10px] text-ink-3">
                開啟系統資料夾選單{hasNativePick ? '（⌘O）' : ''}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-hover-2"
            onClick={() => {
              setMenuOpen(false)
              openManualPath()
            }}
          >
            <Icon name="edit" size={16} className="text-white/50" />
            手動輸入路徑…
          </button>
          {worktrees.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] text-ink-3 uppercase tracking-wider">
                Git worktrees
              </div>
              {worktrees.map((w) => (
                <button
                  key={w.path}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    void selectWorktree(w.path)
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-hover-2 ${
                    w.path === root ? 'bg-hover-2' : ''
                  }`}
                >
                  <div className="text-[12px] text-ink font-[family-name:var(--font-mono)]">
                    {w.branch}
                    {w.detached ? ' (detached)' : ''}
                  </div>
                  <div className="text-[10px] text-ink-3 truncate">{w.path}</div>
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-ink-3 hover:bg-hover-2 border-t border-line"
            onClick={() => {
              setMenuOpen(false)
              void refresh()
            }}
          >
            <Icon name="refresh" size={14} />
            重新整理 Git 狀態
          </button>
          {!hasNativePick && (
            <p className="px-3 py-2 text-[10px] text-amber-400/90 border-t border-white/10">
              {/Electron/i.test(navigator.userAgent)
                ? 'preload 未注入 window.subagents，請重啟 npm run dev。'
                : '這是瀏覽器分頁。請用 npm run dev 開出的 Electron 桌面視窗選資料夾。'}
            </p>
          )}
        </div>
      )}

      {/* Path dialog — primary action is still system picker when available */}
      {manualPathOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4"
          onClick={() => closeManualPath()}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/12 bg-[#1c1c1e] shadow-2xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">選擇專案資料夾</h3>
              <button
                type="button"
                className="p-1 rounded hover:bg-white/10 text-white/60"
                onClick={() => closeManualPath()}
                aria-label="關閉"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {hasNativePick && (
              <button
                type="button"
                disabled={picking}
                onClick={() => void pickFolder()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary/90 text-white text-[13px] font-medium hover:bg-primary disabled:opacity-50"
              >
                <Icon
                  name={picking ? 'progress_activity' : 'folder_open'}
                  size={18}
                  className={picking ? 'animate-spin' : ''}
                />
                {picking ? '開啟選單中…' : '從 Finder 選擇資料夾…'}
              </button>
            )}

            <div className="relative flex items-center gap-2 py-1">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] text-white/35 shrink-0">或手動輸入</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <p className="text-[11px] text-white/45 leading-relaxed">
              貼上本機專案資料夾的絕對路徑（例如{' '}
              <code className="font-mono text-white/60">C:\\Users\\you\\project</code> 或 <code className="font-mono text-white/60">/Users/you/project</code>）。
            </p>
            <input
              ref={inputRef}
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSubmitManual()
                if (e.key === 'Escape') closeManualPath()
              }}
              placeholder="/path/to/project"
              className="w-full bg-white/5 border border-white/12 rounded-lg px-3 py-2 text-[12px] text-white font-[family-name:var(--font-mono)] outline-none focus:border-primary/40"
              autoComplete="off"
              spellCheck={false}
            />
            {error && (
              <p className="text-[11px] text-error leading-snug">{error}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-[12px] text-white/70 hover:bg-white/10"
                onClick={() => closeManualPath()}
              >
                取消
              </button>
              <button
                type="button"
                disabled={picking || !manualPath.trim()}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40"
                onClick={() => void onSubmitManual()}
              >
                {picking ? '套用中…' : '套用路徑'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
