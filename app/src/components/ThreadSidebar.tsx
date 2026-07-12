import { Icon } from './Icon'
import { getThinkingDepth } from '../agent/thinking'
import { getPrimaryAgent } from '../agent/opencode/agents'
import { useThreadStore } from '../store/threadStore'
import { useSettingsStore } from '../store/settingsStore'
import { forkOpenCodeSession } from '../agent/opencode/serverClient'
import { extractOpenCodeSessionId } from '../agent/opencode/sessionMapping'

export function ThreadSidebar() {
  const {
    threads,
    activeId,
    createThread,
    forkThread,
    selectThread,
    deleteThread,
    setShowThreadList,
  } = useThreadStore()
  const globalModel = useSettingsStore((s) => s.settings.model)

  return (
    <div className="h-full flex flex-col min-h-0 border-r border-white/10 bg-surface/50">
      <div className="shrink-0 h-11 px-2 flex items-center justify-between border-b border-white/10">
        <span className="text-xs font-semibold px-1">Threads</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新對話"
            onClick={() => createThread()}
            className="p-1.5 rounded-lg hover:bg-white/10 text-primary"
          >
            <Icon name="add" size={18} />
          </button>
          <button
            type="button"
            title="收合"
            onClick={() => setShowThreadList(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-outline md:hidden"
          >
            <Icon name="chevron_left" size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
        {threads.map((t) => {
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
                  ? 'bg-primary/10 border-primary/25'
                  : 'border-transparent hover:bg-white/[0.04]'
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
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  )}
                  <span className="text-[12px] font-medium truncate text-on-surface">
                    {t.title}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className={`text-[9px] px-1 py-0.5 rounded border font-semibold ${agent.color}`}>
                    {agent.label}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded border border-white/10 text-outline font-[family-name:var(--font-mono)] truncate max-w-[80px]">
                    {modelLabel}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded border border-primary/20 text-primary/90">
                    {depth.shortLabel}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-outline hover:text-error shrink-0"
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
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-outline hover:text-primary shrink-0"
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
