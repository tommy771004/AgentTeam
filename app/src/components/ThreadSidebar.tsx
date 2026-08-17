import { Icon } from './Icon'
import { getThinkingDepth } from '../agent/thinking'
import { getPrimaryAgent } from '../agent/opencode/agents'
import { useThreadStore } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import { forkOpenCodeSession } from '../agent/opencode/serverClient'
import { extractOpenCodeSessionId } from '../agent/opencode/sessionMapping'
import { rerunFromReplaySafeCheckpoint } from '../agent/taskRunCoordinator'

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
  const globalModel = useSettingsStore((s) => s.settings.model)

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface">
      <div className="shrink-0 h-11 px-2 flex items-center justify-between border-b border-line">
        <span className="text-xs font-semibold px-1 text-ink">Threads</span>
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
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
        {threads.filter((t) => !t.hidden).map((t) => {
          const active = t.id === activeId
          const depth = getThinkingDepth(t.thinkingDepth)
          const agent = getPrimaryAgent(t.agentMode)
          const modelLabel = (t.model || globalModel || '—').slice(0, 14)
          const running = t.lastStatus === 'running' || t.lastStatus === 'parsing'
          return (
            <div
              key={t.id}
              className={`group flex items-start gap-1 rounded-xl px-2 py-2 cursor-pointer border transition-colors ${
                active
                  ? 'bg-hover border-transparent'
                  : 'border-transparent hover:bg-hover-2'
              }`}
              onClick={() => selectThread(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') selectThread(t.id)
              }}
              role="button"
              tabIndex={0}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {running && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  )}
                  <span className="text-[12px] font-medium truncate text-ink">
                    {t.title}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className={`text-[9px] px-1 py-0.5 rounded border font-semibold ${agent.color}`}>
                    {agent.label}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded-chip border border-line text-ink-3 font-[family-name:var(--font-mono)] truncate max-w-[80px]">
                    {modelLabel}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded-chip border border-line text-accent-ink">
                    {depth.shortLabel}
                  </span>
                </div>
              </div>
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
        })}
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
              {caps.length ? caps.map((id) => `${id}（${id.startsWith('skill:') ? 'skill' : id.startsWith('mcp:') ? 'mcp' : 'builtin'}）`).join('、') : '（無）'}
            </div>
            <div className="text-[10px] text-ink-2">
              <span className="font-semibold">Unlocked tools</span>{' '}
              {tools.length ? tools.join('、') : '（無）'}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
