import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { getThinkingDepth } from '../agent/thinking'
import { getPrimaryAgent } from '../agent/opencode/agents'
import { useThreadStore } from '../store/threadStore'
import { useProjectStore } from '../store/projectStore'
import { buildProjectGroups, COLLAPSED_PER_PROJECT } from '../lib/threadProjectGroups'
import { useSettingsStore } from '../store/settingsStore'
import { forkOpenCodeSession } from '../agent/opencode/serverClient'
import { extractOpenCodeSessionId } from '../agent/opencode/sessionMapping'
import { rerunFromReplaySafeCheckpoint } from '../agent/taskRunCoordinator'
import type { CapabilityUnlockProvenance } from '../agent/capabilities/runtime'

/** Ticket 03: entries state how they were unlocked, not what kind they are. */
const PROVENANCE_ZH: Record<CapabilityUnlockProvenance, string> = {
  'always-on': '預設常駐',
  preloaded: '預先載入',
  load_capability: 'load_capability',
  tool_search: 'tool_search',
  'progressive-off': '未啟用漸進揭露',
  restored: '跨輪還原',
}

function provenanceZh(value?: CapabilityUnlockProvenance): string {
  return value ? PROVENANCE_ZH[value] : '跨輪還原'
}

export function ThreadSidebar() {
  const {
    threads,
    activeId,
    createThread,
    forkThread,
    resetLastCapabilities,
    selectThread,
    deleteThread,
    setShowThreadList,
  } = useThreadStore()
  const activeRoot = useProjectStore((s) => s.root)
  const activeName = useProjectStore((s) => s.name)
  const globalModel = useSettingsStore((s) => s.settings.model)
  const [expanded, setExpanded] = useState(false)

  const groups = useMemo(
    () => buildProjectGroups(threads, activeRoot, activeName),
    [threads, activeRoot, activeName],
  )
  const truncated = groups.some((group) => group.threads.length > COLLAPSED_PER_PROJECT)

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface">
      <div className="shrink-0 h-11 px-2 flex items-center justify-end border-b border-line">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新對話"
            onClick={() => createThread()}
            className="p-1.5 rounded-control hover:bg-hover-2 text-accent-ink"
          >
            <Icon name="add" size={18} />
          </button>
          <button
            type="button"
            title="收合"
            onClick={() => setShowThreadList(false)}
            className="p-1.5 rounded-control hover:bg-hover-2 text-ink-3 md:hidden"
          >
            <Icon name="chevron_left" size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-3">
        <div className="px-3 pt-3 pb-1 text-[11px] tracking-wide text-ink-3">專案</div>

        {groups.map((group) => {
          const visible = expanded ? group.threads : group.threads.slice(0, COLLAPSED_PER_PROJECT)
          return (
            <div key={group.key} className="pt-2.5">
              <div
                className="flex items-center gap-2 px-3 py-1 text-[13px] text-ink-2"
                title={group.root || '尚未綁定專案資料夾'}
              >
                <Icon name="folder_open" size={16} className="shrink-0 text-ink-3" />
                <span className="truncate">{group.label}</span>
              </div>

              {visible.length === 0 ? (
                <div className="pl-[38px] pr-3 py-1.5 text-[13px] text-ink-3">沒有對話</div>
              ) : (
                visible.map((t) => {
                  const active = t.id === activeId
                  const depth = getThinkingDepth(t.thinkingDepth)
                  const agent = getPrimaryAgent(t.agentMode)
                  const modelLabel = t.model || globalModel || '—'
                  const running = t.lastStatus === 'running' || t.lastStatus === 'parsing'
                  return (
                    <div
                      key={t.id}
                      className={`group flex items-center gap-1 pl-[38px] pr-1.5 py-1.5 cursor-pointer transition-colors ${
                        active ? 'bg-hover text-ink' : 'text-ink hover:bg-hover-2'
                      }`}
                      onClick={() => selectThread(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') selectThread(t.id)
                      }}
                      role="button"
                      tabIndex={0}
                      // Chips moved into the tooltip so the row stays one clean line.
                      title={`${t.title}\n${agent.label} · ${modelLabel} · ${depth.shortLabel}`}
                    >
                      {running && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                      <span className="text-[13px] truncate flex-1 min-w-0">{t.title}</span>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-ink-3 hover:text-red shrink-0"
                        title="刪除"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteThread(t.id)
                        }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-ink-3 hover:text-accent-ink shrink-0"
                        title="建立分支"
                        onClick={(e) => {
                          e.stopPropagation()
                          const forkedId = forkThread(t.id)
                          const sourceSession = t.externalRun
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
                        }}
                      >
                        <Icon name="call_split" size={14} />
                      </button>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-ink-3 hover:text-accent-ink shrink-0"
                        title="從最近 replay-safe checkpoint 重跑"
                        onClick={(e) => {
                          e.stopPropagation()
                          void rerunFromReplaySafeCheckpoint({ sourceThreadId: t.id }).then((result) => {
                            if (result.skipped) {
                              useThreadStore.getState().pushBubble(t.id, 'system', result.error || '無法從 checkpoint 重跑。')
                            }
                          })
                        }}
                      >
                        <Icon name="replay" size={14} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          )
        })}

        {truncated && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 w-full text-left px-3 py-1.5 text-[13px] text-ink-3 hover:text-ink-2"
          >
            {expanded ? '收合' : '顯示更多'}
          </button>
        )}
      </div>

      {(() => {
        const activeThread = threads.find((thread) => thread.id === activeId)
        if (!activeThread) return null
        const caps = activeThread.lastCapabilityIds || []
        const tools = activeThread.lastUnlockedTools || []
        return (
          <div className="shrink-0 border-t border-line bg-surface-2 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Run capability state</div>
                <div className="text-[9px] text-ink-3">來源：上一輪 Pi Host run（cross-run restore）</div>
              </div>
              {(caps.length > 0 || tools.length > 0) && (
                <button
                  type="button"
                  className="text-[10px] text-error hover:underline"
                  onClick={() => resetLastCapabilities(activeThread.id)}
                >
                  重置
                </button>
              )}
            </div>
            <div className="text-[10px] text-ink-2">
              <span className="font-semibold">Capabilities</span>{' '}
              {caps.length
                ? caps
                    .map((id) => `${id}（${provenanceZh(activeThread.lastCapabilityProvenance?.[id])}）`)
                    .join('、')
                : '（無）'}
            </div>
            <div className="text-[10px] text-ink-2">
              <span className="font-semibold">Unlocked tools</span>{' '}
              {tools.length
                ? tools
                    .map((name) => `${name}（${provenanceZh(activeThread.lastUnlockedToolProvenance?.[name])}）`)
                    .join('、')
                : '（無）'}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
