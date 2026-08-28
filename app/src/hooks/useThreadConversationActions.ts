import { useCallback } from 'react'
import { rerunFromReplaySafeCheckpoint } from '../agent/taskRunCoordinator'
import { useThreadStore, type Thread } from '../store/threadStore'

/** Provider-aware conversation actions kept outside sidebar presentation. */
export function useThreadConversationActions() {
  const forkThread = useThreadStore((state) => state.forkThread)

  const forkConversation = useCallback((thread: Thread) => {
    forkThread(thread.id)
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
