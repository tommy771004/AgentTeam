import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { getThinkingDepth } from '../agent/thinking'
import { getPrimaryAgent } from '../agent/opencode/agents'
import { useThreadStore, type Thread } from '../store/threadStore'
import { useProjectStore } from '../store/projectStore'
import { projectThreadSidebar } from '../lib/threadProjectGroups'
import { useSettingsStore } from '../store/settingsStore'
import { forkOpenCodeSession } from '../agent/opencode/serverClient'
import { extractOpenCodeSessionId } from '../agent/opencode/sessionMapping'
import { rerunFromReplaySafeCheckpoint } from '../agent/taskRunCoordinator'

export function ThreadSidebar({ onThreadSelected }: { onThreadSelected?: () => void } = {}) {
  const {
    threads,
    activeId,
    createThread,
    forkThread,
    selectThread,
    deleteThread,
    setShowThreadList,
  } = useThreadStore()
  const activeRoot = useProjectStore((s) => s.root)
  const activeName = useProjectStore((s) => s.name)
  const globalModel = useSettingsStore((s) => s.settings.model)
  const [expanded, setExpanded] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const menuTriggerRefs = useRef(new Map<string, HTMLButtonElement>())

  const sidebar = useMemo(
    () => projectThreadSidebar({ threads, activeRoot, activeName, query, expanded }),
    [threads, activeRoot, activeName, query, expanded],
  )

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!openMenuId) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest(`[data-thread-menu-id="${openMenuId}"]`)) return
      setOpenMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpenMenuId(null)
      menuTriggerRefs.current.get(openMenuId)?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuId])

  const selectConversation = (threadId: string) => {
    selectThread(threadId)
    onThreadSelected?.()
  }

  const closeMenu = (threadId: string, restoreFocus = true) => {
    setOpenMenuId(null)
    if (restoreFocus) requestAnimationFrame(() => menuTriggerRefs.current.get(threadId)?.focus())
  }

  const forkConversation = (thread: Thread) => {
    const forkedId = forkThread(thread.id)
    const sourceSession = thread.externalRun
    if (!forkedId || sourceSession?.provider !== 'opencode' || !sourceSession.serverUrl || !sourceSession.sessionId) return
    void forkOpenCodeSession(sourceSession.serverUrl, sourceSession.sessionId).then((raw) => {
      const sessionId = extractOpenCodeSessionId(raw)
      if (!sessionId) {
        useThreadStore.getState().setExternalRun(forkedId, undefined)
        useThreadStore.getState().pushBubble(forkedId, 'system', 'OpenCode fork 未回傳 session id，已保留為本地分支。')
        return
      }
      useThreadStore.getState().setExternalRun(forkedId, {
        ...sourceSession,
        sessionId,
        parentSessionId: sourceSession.sessionId,
        childSessionIds: undefined,
        status: 'starting',
        completionReason: 'fork-created',
        finishedAt: undefined,
      })
      useThreadStore.getState().pushBubble(forkedId, 'system', `OpenCode fork 已同步 · ${sessionId}`)
    }).catch((error) => {
      useThreadStore.getState().setExternalRun(forkedId, undefined)
      useThreadStore.getState().pushBubble(forkedId, 'system', `OpenCode fork 失敗，已保留為本地分支：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const replayConversation = (threadId: string) => {
    void rerunFromReplaySafeCheckpoint({ sourceThreadId: threadId }).then((result) => {
      if (result.skipped) {
        useThreadStore.getState().pushBubble(threadId, 'system', result.error || '無法從 checkpoint 重跑。')
      }
    })
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface">
      <div className="shrink-0 min-h-11 px-2 flex items-center gap-1 border-b border-line">
        {searchOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5">
            <Icon name="search" size={17} className="shrink-0 text-ink-3" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                setQuery('')
                setSearchOpen(false)
              }}
              placeholder="搜尋對話"
              aria-label="搜尋對話標題"
              className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
            {query && (
              <button
                type="button"
                aria-label="清除搜尋"
                title="清除搜尋"
                onClick={() => {
                  setQuery('')
                  searchInputRef.current?.focus()
                }}
                className="sidebar-icon-button"
              >
                <Icon name="close" size={16} />
              </button>
            )}
            <button
              type="button"
              aria-label="關閉搜尋"
              title="關閉搜尋"
              onClick={() => {
                setQuery('')
                setSearchOpen(false)
              }}
              className="sidebar-icon-button"
            >
              <Icon name="arrow_back" size={17} />
            </button>
          </div>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate px-1.5 text-[13px] font-semibold text-ink-2">
              對話
            </span>
            <button
              type="button"
              title="搜尋對話"
              aria-label="搜尋對話"
              onClick={() => setSearchOpen(true)}
              className="sidebar-icon-button"
            >
              <Icon name="search" size={18} />
            </button>
          </>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新對話"
            aria-label="新對話"
            onClick={() => createThread()}
            className="sidebar-icon-button text-accent-ink"
          >
            <Icon name="add" size={18} />
          </button>
          <button
            type="button"
            title="收合"
            aria-label="收合對話列表"
            onClick={() => setShowThreadList(false)}
            className="sidebar-icon-button text-ink-3 md:hidden"
          >
            <Icon name="chevron_left" size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-3">
        <div className="px-3 pt-3 pb-1 text-[11px] tracking-wide text-ink-3">專案</div>

        {sidebar.noResults ? (
          <div className="px-3 py-8 text-center text-[13px] text-ink-3">
            找不到符合「{query.trim()}」的對話
          </div>
        ) : (
          sidebar.groups.map((group) => (
            <div key={group.key} className="pt-2.5">
              <div
                className="flex items-center gap-2 px-3 py-1 text-[13px] text-ink-2"
                title={group.root || '尚未綁定專案資料夾'}
              >
                <Icon name="folder_open" size={16} className="shrink-0 text-ink-3" />
                <span className="truncate">{group.label}</span>
              </div>

              {group.threads.length === 0 ? (
                <div className="pl-[38px] pr-3 py-1.5 text-[13px] text-ink-3">沒有對話</div>
              ) : (
                group.threads.map((t) => {
                  const active = t.id === activeId
                  const depth = getThinkingDepth(t.thinkingDepth)
                  const agent = getPrimaryAgent(t.agentMode)
                  const modelLabel = t.model || globalModel || '—'
                  const running = t.lastStatus === 'running' || t.lastStatus === 'parsing'
                  return (
                    <div
                      key={t.id}
                      className={`sidebar-thread-row relative mx-1.5 flex min-w-0 items-center ${active ? 'is-active' : ''}`}
                      data-thread-menu-id={t.id}
                    >
                      <button
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => selectConversation(t.id)}
                        title={`${t.title}\n${agent.label} · ${modelLabel} · ${depth.shortLabel}`}
                        className={`sidebar-thread-select flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-[30px] pr-1 text-left ${
                          active ? 'is-active text-ink' : 'text-ink-2'
                        }`}
                      >
                        {running && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                            role="status"
                            aria-label="執行中"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                      </button>
                      <button
                        ref={(element) => {
                          if (element) menuTriggerRefs.current.set(t.id, element)
                          else menuTriggerRefs.current.delete(t.id)
                        }}
                        type="button"
                        aria-label={`${t.title} 的更多操作`}
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === t.id}
                        title="更多操作"
                        onClick={() => {
                          const willOpen = openMenuId !== t.id
                          setOpenMenuId(willOpen ? t.id : null)
                          if (willOpen) {
                            requestAnimationFrame(() => {
                              const menu = menuTriggerRefs.current.get(t.id)?.parentElement?.querySelector<HTMLElement>('[role="menu"]')
                              menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
                            })
                          }
                        }}
                        className="sidebar-thread-menu-trigger sidebar-icon-button mr-0.5 shrink-0"
                      >
                        <Icon name="more_horiz" size={17} />
                      </button>
                      {openMenuId === t.id && (
                        <div
                          role="menu"
                          aria-label={`${t.title} 的對話操作`}
                          className="sidebar-thread-menu absolute right-1 top-9 z-30 w-[164px] p-1"
                          onKeyDown={(event) => {
                            const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
                            const currentIndex = items.indexOf(document.activeElement as HTMLElement)
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                              event.preventDefault()
                              const direction = event.key === 'ArrowDown' ? 1 : -1
                              const nextIndex = (currentIndex + direction + items.length) % items.length
                              items[nextIndex]?.focus()
                            } else if (event.key === 'Home') {
                              event.preventDefault()
                              items[0]?.focus()
                            } else if (event.key === 'End') {
                              event.preventDefault()
                              items.at(-1)?.focus()
                            }
                          }}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="sidebar-menu-item"
                            onClick={() => {
                              forkConversation(t)
                              closeMenu(t.id)
                            }}
                          >
                            <Icon name="call_split" size={16} />
                            建立分支
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="sidebar-menu-item"
                            onClick={() => {
                              replayConversation(t.id)
                              closeMenu(t.id)
                            }}
                          >
                            <Icon name="replay" size={16} />
                            從 checkpoint 重跑
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="sidebar-menu-item text-error"
                            onClick={() => {
                              closeMenu(t.id, false)
                              deleteThread(t.id)
                            }}
                          >
                            <Icon name="delete" size={16} />
                            刪除對話
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          ))
        )}

        {sidebar.truncated && !sidebar.searching && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 w-full text-left px-3 py-1.5 text-[13px] text-ink-3 hover:text-ink-2"
          >
            {expanded ? '收合' : '顯示更多'}
          </button>
        )}
      </div>

    </div>
  )
}
