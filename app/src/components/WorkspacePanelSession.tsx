import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from './Icon'
import { InlineRunPanel } from './InlineRunPanel'
import { TerminalPanel } from './TerminalPanel'
import { ReviewExplorer } from './ReviewExplorer'
import { ReviewVerificationPanel } from './ReviewVerificationPanel'
import { useWorkspacePanelSessionStore, type WorkspacePanelTarget } from '../store/workspacePanelSessionStore'

export function WorkspacePanelSession({ onEmpty }: { onEmpty?: () => void }) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [hydrated, setHydrated] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const { tabs, activeTabId, dock, reviewWidth, maximized, focusTab, closeTab, setDock, setReviewWidth, setMaximized, restore } = useWorkspacePanelSessionStore(useShallow((state) => ({
    tabs: state.tabs, activeTabId: state.activeTabId, dock: state.dock, reviewWidth: state.reviewWidth, maximized: state.maximized,
    focusTab: state.focusTab, closeTab: state.closeTab, setDock: state.setDock, setReviewWidth: state.setReviewWidth, setMaximized: state.setMaximized, restore: state.restore,
  })))
  const active = tabs.find((tab) => tab.id === activeTabId) || tabs[0]
  const close = useCallback(async (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const target = tabs[index]?.target
    if (target?.kind === 'review' && target.target.kind === 'run-snapshot') {
      try {
        const response = await window.subagents?.piHost?.review?.listComments(target.target.snapshotId)
        if (response?.reviewComments.some((comment) => comment.status === 'draft') && !window.confirm('此審查仍有未送出的 draft。要關閉分頁並保留 draft 嗎？')) return
      } catch { /* missing Host state must not turn close into a lifecycle mutation */ }
    }
    closeTab(id)
    const remaining = tabs.filter((tab) => tab.id !== id)
    requestAnimationFrame(() => tabRefs.current.get(remaining[Math.min(index, remaining.length - 1)]?.id || '')?.focus())
  }, [closeTab, tabs])
  useEffect(() => { restore(); setHydrated(true) }, [restore])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (hydrated && tabs.length === 0) onEmpty?.()
  }, [hydrated, tabs.length, onEmpty])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'w' || !active) return
      event.preventDefault()
      void close(active.id)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [active, close])

  const activateRelative = (currentId: string, offset: number) => {
    const current = tabs.findIndex((tab) => tab.id === currentId)
    const next = tabs[(current + offset + tabs.length) % tabs.length]
    if (next) { focusTab(next.id); requestAnimationFrame(() => tabRefs.current.get(next.id)?.focus()) }
  }
  const width = active?.target.kind === 'summary' ? 360 : reviewWidth
  const panel = (
    <aside
      className={`${maximized ? 'fixed inset-0 z-[70]' : dock === 'right' ? 'fixed inset-0 z-[70] w-full sm:relative sm:inset-auto sm:z-0 sm:w-[var(--panel-width)]' : 'fixed inset-x-0 bottom-0 z-[70] h-[70vh] w-full'} flex min-h-0 shrink-0 max-w-[100vw] flex-col border-l border-line bg-surface`}
      style={{ '--panel-width': `${width}px` } as CSSProperties}
      aria-label="工作區面板"
      data-workspace-panel-dock={dock}
    >
      {!maximized && dock === 'right' && active?.target.kind !== 'summary' ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="調整工作區寬度"
          tabIndex={0}
          className="absolute inset-y-0 left-0 z-10 hidden w-1 cursor-col-resize outline-none hover:bg-accent/40 focus-visible:bg-accent sm:block"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const move = (next: PointerEvent) => setReviewWidth(window.innerWidth - next.clientX)
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up, { once: true })
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') { event.preventDefault(); setReviewWidth(reviewWidth + 20) }
            if (event.key === 'ArrowRight') { event.preventDefault(); setReviewWidth(reviewWidth - 20) }
          }}
        />
      ) : null}
      <div className="flex h-11 shrink-0 items-center border-b border-line bg-surface-container-low px-1">
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="工作區分頁">
          {tabs.map((tab) => (
            <button key={tab.id} ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id) }} type="button" role="tab"
              aria-selected={tab.id === active?.id} tabIndex={tab.id === active?.id ? 0 : -1}
              onClick={() => focusTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') { event.preventDefault(); activateRelative(tab.id, 1) }
                if (event.key === 'ArrowLeft') { event.preventDefault(); activateRelative(tab.id, -1) }
                if (event.key === 'Home') { event.preventDefault(); const first = tabs[0]; if (first) { focusTab(first.id); tabRefs.current.get(first.id)?.focus() } }
                if (event.key === 'End') { event.preventDefault(); const last = tabs.at(-1); if (last) { focusTab(last.id); tabRefs.current.get(last.id)?.focus() } }
                if (event.key === 'Delete') { event.preventDefault(); close(tab.id) }
              }}
              className={`group flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${tab.id === active?.id ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
              <span>{tab.title}</span>
              <span role="button" aria-label={`關閉${tab.title}`} tabIndex={-1} onClick={(event) => { event.stopPropagation(); close(tab.id) }}><Icon name="close" size={13} /></span>
            </button>
          ))}
        </div>
        <button type="button" className="p-2 text-ink-3 hover:text-ink" aria-label={dock === 'right' ? '停駐到底部' : '停駐到右側'} onClick={() => setDock(dock === 'right' ? 'bottom' : 'right')}><Icon name="dock_to_bottom" size={16} /></button>
        <button type="button" className="p-2 text-ink-3 hover:text-ink" aria-label={maximized ? '還原面板' : '最大化面板'} onClick={() => setMaximized(!maximized)}><Icon name={maximized ? 'close_fullscreen' : 'open_in_full'} size={16} /></button>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel" aria-label={active?.title}>
        {active ? <WorkspacePanelBody tabId={active.id} target={active.target} selectedPath={active.selectedPath} close={() => { void close(active.id) }} /> : null}
      </div>
    </aside>
  )
  return narrow || maximized ? createPortal(panel, document.body) : panel
}

function WorkspacePanelBody({ tabId, target, selectedPath, close }: { tabId: string; target: WorkspacePanelTarget; selectedPath?: string; close: () => void }) {
  const selectPath = useWorkspacePanelSessionStore((state) => state.selectPath)
  const openTab = useWorkspacePanelSessionStore((state) => state.openTab)
  if (target.kind === 'summary') return <InlineRunPanel runId={target.runId} threadId={target.threadId} onClose={close} onOpenReview={(reviewTarget) => openTab({ kind: 'review', target: reviewTarget })} onOpenVerification={(snapshotId) => openTab({ kind: 'verification', runId: target.runId, snapshotId })} />
  if (target.kind === 'terminal') return <TerminalPanel onClose={close} />
  if (target.kind === 'review') return <ReviewExplorer target={target.target} selectedPath={selectedPath} onSelectPath={(path) => selectPath(tabId, path)} onOpenTarget={(reviewTarget, title) => openTab({ kind: 'review', target: reviewTarget }, title)} />
  if (target.kind === 'verification') return <ReviewVerificationPanel snapshotId={target.snapshotId} />
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-ink-2" role="status">
      <Icon name="fact_check" size={24} className="text-ink-3" />
      <p>驗證記錄尚未載入或已遺失。</p>
      <p className="text-[11px] text-ink-3">可保留分頁稍後重試，或關閉分頁返回對話。</p>
    </div>
  )
}
