import { useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from './Icon'
import { getThinkingDepth } from '../agent/thinking'
import { getPrimaryAgent } from '../agent/agentModes'
import { useThreadStore } from '../store/threadStore'
import { useProjectStore } from '../store/projectStore'
import {
  buildProjectGroups,
  mergeProjectOrder,
  mergeThreadOrder,
  moveProjectByOffset,
  nextThreadAfterDelete,
  parseProjectOrder,
  projectThreadSidebar,
  reconcileProjectOrder,
  reorderProject,
  THREAD_ORDER_STORAGE_KEY,
  THREAD_PROJECT_ORDER_STORAGE_KEY,
} from '../lib/threadProjectGroups'
import { useSettingsStore } from '../store/settingsStore'
import { useThreadConversationActions } from '../hooks/useThreadConversationActions'

export function ThreadSidebar({ onThreadSelected }: { onThreadSelected?: () => void } = {}) {
  const {
    threads,
    activeId,
    createThread,
    selectThread,
    deleteThread,
    setShowThreadList,
    runningThreadIds,
  } = useThreadStore()
  const activeRoot = useProjectStore((s) => s.root)
  const activeName = useProjectStore((s) => s.name)
  const globalModel = useSettingsStore((s) => s.settings.model)
  const [expanded, setExpanded] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [projectOrder, setProjectOrder] = useState<string[]>(() => {
    try {
      return parseProjectOrder(window.localStorage.getItem(THREAD_PROJECT_ORDER_STORAGE_KEY))
    } catch {
      return []
    }
  })
  const [threadOrder, setThreadOrder] = useState<string[]>(() => {
    try {
      return parseProjectOrder(window.localStorage.getItem(THREAD_ORDER_STORAGE_KEY))
    } catch {
      return []
    }
  })
  const [undoProjectOrder, setUndoProjectOrder] = useState<string[] | null>(null)
  const [reorderAnnouncement, setReorderAnnouncement] = useState('')
  const [draggedProject, setDraggedProject] = useState<string | null>(null)
  const [dragOverProject, setDragOverProject] = useState<{
    key: string
    position: 'before' | 'after'
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { forkConversation, replayConversation } = useThreadConversationActions()

  const liveProjectKeys = useMemo(
    () => buildProjectGroups(threads, activeRoot, activeName).map((group) => group.key),
    [threads, activeRoot, activeName],
  )
  const durableProjectOrder = useMemo(
    () => mergeProjectOrder(projectOrder, liveProjectKeys),
    [projectOrder, liveProjectKeys],
  )
  const stableProjectOrder = useMemo(
    () => reconcileProjectOrder(durableProjectOrder, liveProjectKeys),
    [durableProjectOrder, liveProjectKeys],
  )
  const liveThreadKeys = useMemo(
    () => buildProjectGroups(threads, activeRoot, activeName)
      .flatMap((group) => group.threads.map((thread) => thread.id)),
    [threads, activeRoot, activeName],
  )
  const durableThreadOrder = useMemo(
    () => mergeThreadOrder(threadOrder, liveThreadKeys),
    [threadOrder, liveThreadKeys],
  )
  const stableThreadOrder = useMemo(
    () => reconcileProjectOrder(durableThreadOrder, liveThreadKeys),
    [durableThreadOrder, liveThreadKeys],
  )

  const sidebar = useMemo(
    () => projectThreadSidebar({
      threads,
      activeRoot,
      activeName,
      query,
      expanded,
      projectOrder: stableProjectOrder,
      threadOrder: stableThreadOrder,
    }),
    [
      threads,
      activeRoot,
      activeName,
      query,
      expanded,
      stableProjectOrder,
      stableThreadOrder,
    ],
  )
  const orderedVisibleThreadIds = useMemo(
    () => buildProjectGroups(
      threads,
      activeRoot,
      activeName,
      stableProjectOrder,
      stableThreadOrder,
    ).flatMap((group) => group.threads.map((thread) => thread.id)),
    [threads, activeRoot, activeName, stableProjectOrder, stableThreadOrder],
  )

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (
      projectOrder.length !== durableProjectOrder.length
      || projectOrder.some((key, index) => key !== durableProjectOrder[index])
    ) {
      setProjectOrder(durableProjectOrder)
    }
    try {
      window.localStorage.setItem(
        THREAD_PROJECT_ORDER_STORAGE_KEY,
        JSON.stringify(durableProjectOrder),
      )
    } catch {
      /* UI order persistence is best-effort; the live stable order still works. */
    }
  }, [projectOrder, durableProjectOrder])

  useEffect(() => {
    if (
      threadOrder.length !== durableThreadOrder.length
      || threadOrder.some((key, index) => key !== durableThreadOrder[index])
    ) {
      setThreadOrder(durableThreadOrder)
    }
    try {
      window.localStorage.setItem(THREAD_ORDER_STORAGE_KEY, JSON.stringify(durableThreadOrder))
    } catch {
      /* UI order persistence is best-effort; the live stable order still works. */
    }
  }, [threadOrder, durableThreadOrder])

  const applyVisibleProjectOrder = (nextVisible: string[], announcement: string) => {
    if (
      nextVisible.length === stableProjectOrder.length
      && nextVisible.every((key, index) => key === stableProjectOrder[index])
    ) return
    setUndoProjectOrder(durableProjectOrder)
    setProjectOrder([
      ...nextVisible,
      ...durableProjectOrder.filter((key) => !liveProjectKeys.includes(key)),
    ])
    setReorderAnnouncement(announcement)
  }

  const selectConversation = (threadId: string) => {
    selectThread(threadId)
    onThreadSelected?.()
  }

  const deleteConversation = (threadId: string) => {
    deleteThread(threadId, nextThreadAfterDelete(orderedVisibleThreadIds, threadId))
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
        <div className="flex items-center gap-2 px-3 pt-3 pb-1 text-[11px] tracking-wide text-ink-3">
          <span className="min-w-0 flex-1">專案</span>
          {liveProjectKeys.length > 1 && (
            <button
              type="button"
              onClick={() => applyVisibleProjectOrder(liveProjectKeys, '已重設專案順序')}
              className="shrink-0 text-[11px] tracking-normal hover:text-ink-2"
            >
              重設排序
            </button>
          )}
        </div>

        {sidebar.searching && (
          <div className="px-3 pb-1 text-[11px] text-ink-3">
            清除搜尋後可調整專案順序
          </div>
        )}

        {undoProjectOrder && !sidebar.searching && (
          <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2">
            <span className="min-w-0 flex-1 truncate">已調整專案順序</span>
            <button
              type="button"
              onClick={() => {
                setProjectOrder(undoProjectOrder)
                setUndoProjectOrder(null)
                setReorderAnnouncement('已復原專案順序')
              }}
              className="shrink-0 font-medium text-accent-ink"
            >
              復原
            </button>
          </div>
        )}

        <div className="sr-only" aria-live="polite">{reorderAnnouncement}</div>

        {sidebar.groups.map((group) => (
            <div
              key={group.key}
              className="relative pt-2.5"
              onDragOver={(event) => {
                if (sidebar.searching || !draggedProject || draggedProject === group.key) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const header = event.currentTarget.querySelector('[data-project-header]')
                const bounds = header?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect()
                setDragOverProject({
                  key: group.key,
                  position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
                })
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setDragOverProject(null)
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedProject && draggedProject !== group.key) {
                  const reorderedLive = reorderProject(
                    stableProjectOrder,
                    draggedProject,
                    group.key,
                    dragOverProject?.key === group.key ? dragOverProject.position : 'before',
                  )
                  const nextIndex = reorderedLive.indexOf(draggedProject) + 1
                  const draggedLabel = sidebar.groups.find((item) => item.key === draggedProject)?.label
                    || '專案'
                  applyVisibleProjectOrder(
                    reorderedLive,
                    `${draggedLabel} 已移至第 ${nextIndex} 個位置`,
                  )
                }
                setDraggedProject(null)
                setDragOverProject(null)
              }}
            >
              {dragOverProject?.key === group.key && dragOverProject.position === 'before' && (
                <div className="absolute inset-x-2 top-1 h-0.5 rounded-full bg-accent" aria-hidden="true" />
              )}
              <div
                data-project-header
                className={`flex items-center gap-2 px-3 py-1 text-[13px] text-ink-2 ${
                  draggedProject === group.key ? 'opacity-60' : ''
                }`}
                title={group.root || '尚未綁定專案資料夾'}
              >
                <Icon name="folder_open" size={16} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <button
                  type="button"
                  draggable={!sidebar.searching}
                  disabled={sidebar.searching}
                  aria-label={`${group.label} 排序把手；拖曳或按 Alt 加方向鍵調整順序`}
                  title={sidebar.searching ? '搜尋時無法調整順序' : '拖曳排序；Alt+↑/↓ 鍵盤移動'}
                  onDragStart={(event) => {
                    setDraggedProject(group.key)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', group.label)
                  }}
                  onDragEnd={() => {
                    setDraggedProject(null)
                    setDragOverProject(null)
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                    event.preventDefault()
                    const next = moveProjectByOffset(
                      stableProjectOrder,
                      group.key,
                      event.key === 'ArrowUp' ? -1 : 1,
                    )
                    applyVisibleProjectOrder(
                      next,
                      `${group.label} 已移至第 ${next.indexOf(group.key) + 1} 個位置`,
                    )
                  }}
                  className="sidebar-icon-button -mr-1 shrink-0 cursor-grab text-ink-3 active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
                >
                  <Icon name="drag_indicator" size={17} />
                </button>
              </div>

              {group.threads.length === 0 ? (
                <div className="pl-[38px] pr-3 py-1.5 text-[13px] text-ink-3">
                  {sidebar.searching ? '此專案沒有符合項目' : '沒有對話'}
                </div>
              ) : (
                group.threads.map((t) => {
                  const active = t.id === activeId
                  const depth = getThinkingDepth(t.thinkingDepth)
                  const agent = getPrimaryAgent(t.agentMode)
                  const modelLabel = t.model || globalModel || '—'
                  const running = runningThreadIds.includes(t.id)
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
                        {running ? (
                          <span
                            className="inline-flex shrink-0"
                            role="status"
                            aria-label="執行中"
                          >
                            <Icon
                              name="progress_activity"
                              size={15}
                              className="animate-spin text-accent"
                            />
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                      </button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <button
                            type="button"
                            aria-label={`${t.title} 的更多操作`}
                            title="更多操作"
                            className="sidebar-thread-menu-trigger sidebar-icon-button mr-0.5 shrink-0"
                          >
                            <Icon name="more_horiz" size={17} />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            aria-label={`${t.title} 的對話操作`}
                            align="end"
                            side="bottom"
                            sideOffset={4}
                            collisionPadding={8}
                            className="sidebar-thread-menu z-[100] w-[164px] p-1"
                          >
                            <DropdownMenu.Item
                              className="sidebar-menu-item"
                              onSelect={() => forkConversation(t)}
                            >
                              <Icon name="call_split" size={16} />
                              建立分支
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="sidebar-menu-item"
                              onSelect={() => replayConversation(t.id)}
                            >
                              <Icon name="replay" size={16} />
                              從 checkpoint 重跑
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="sidebar-menu-item text-error"
                              onSelect={() => deleteConversation(t.id)}
                            >
                              <Icon name="delete" size={16} />
                              刪除對話
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                  )
                })
              )}
              {dragOverProject?.key === group.key && dragOverProject.position === 'after' && (
                <div className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />
              )}
            </div>
          ))}

        {sidebar.noResults && (
          <div className="px-3 py-6 text-center text-[13px] text-ink-3">
            找不到符合「{query.trim()}」的對話
          </div>
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
