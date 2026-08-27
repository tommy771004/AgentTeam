import { useCallback } from 'react'
import { forkOpenCodeSession } from '../agent/opencode/serverClient'
import { extractOpenCodeSessionId } from '../agent/opencode/sessionMapping'
import { rerunFromReplaySafeCheckpoint } from '../agent/taskRunCoordinator'
import { useThreadStore, type Thread } from '../store/threadStore'

/** Provider-aware conversation actions kept outside sidebar presentation. */
export function useThreadConversationActions() {
  const forkThread = useThreadStore((state) => state.forkThread)

  const forkConversation = useCallback((thread: Thread) => {
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
  }, [forkThread])

  const replayConversation = useCallback((threadId: string) => {
    void rerunFromReplaySafeCheckpoint({ sourceThreadId: threadId }).then((result) => {
      if (result.skipped) {
        useThreadStore.getState().pushBubble(threadId, 'system', result.error || '無法從 checkpoint 重跑。')
      }
    })
  }, [])

  return { forkConversation, replayConversation }
}
