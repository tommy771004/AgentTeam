/**
 * OpenCode session → local Thread store sync (effectful).
 * Pure normalizers stay in sessionMapping.ts so UI importers stay store-free.
 */
import type { ExternalRunRef } from '../types.ts'
import { useThreadStore } from '../../store/threadStore.ts'
import {
  mapOpenCodeTodoToThreadPlan,
  normalizeOpenCodeChildren,
} from './sessionMapping.ts'

/**
 * Pull the server-owned todo/children snapshot into the local Thread after a
 * server run. Failures are intentionally non-fatal: the completed session and
 * local transcript remain authoritative when an older server lacks an endpoint.
 *
 * Called from coordinator finalization (Phase 3 item 4).
 */
export async function syncOpenCodeSessionMapping(
  threadId: string,
  externalRun?: ExternalRunRef,
): Promise<void> {
  if (externalRun?.provider !== 'opencode' || !externalRun.serverUrl || !externalRun.sessionId) return
  try {
    const { getOpenCodeSessionTodo, getOpenCodeSessionChildren } = await import('./serverClient.ts')
    const [todoResult, childrenResult] = await Promise.allSettled([
      getOpenCodeSessionTodo(externalRun.serverUrl, externalRun.sessionId),
      getOpenCodeSessionChildren(externalRun.serverUrl, externalRun.sessionId),
    ])
    const plan = todoResult.status === 'fulfilled'
      ? mapOpenCodeTodoToThreadPlan(todoResult.value)
      : []
    if (plan.length) useThreadStore.getState().setRunPlan(threadId, plan)

    const children = childrenResult.status === 'fulfilled'
      ? normalizeOpenCodeChildren(childrenResult.value)
      : []
    const childSessionIds = children.map((child) => child.id)
    const activeBefore = useThreadStore.getState().activeId
    for (const child of children) {
      const state = useThreadStore.getState()
      if (state.threads.some((thread) =>
        thread.externalRun?.provider === 'opencode' &&
        thread.externalRun.serverUrl === externalRun.serverUrl &&
        thread.externalRun.sessionId === child.id,
      )) continue
      const childThreadId = state.createThread({
        title: `子任務 · ${child.title}`.slice(0, 48),
        runner: 'opencode',
        agentMode: 'build',
        loopType: null,
      })
      useThreadStore.getState().setExternalRun(childThreadId, {
        ...externalRun,
        sessionId: child.id,
        parentSessionId: child.parentId || externalRun.sessionId,
        childSessionIds: undefined,
        status: 'running',
        startedAt: child.time || externalRun.startedAt,
        finishedAt: undefined,
        completionReason: 'child-session-discovered',
      })
      useThreadStore.getState().pushBubble(
        childThreadId,
        'system',
        `OpenCode child session 已同步 · ${child.id}`,
      )
    }
    if (activeBefore) {
      useThreadStore.getState().selectThread(activeBefore)
      useThreadStore.getState().setShowRunPanel(true)
    }
    if (plan.length || childSessionIds.length) {
      useThreadStore.getState().setExternalRun(threadId, {
        ...externalRun,
        childSessionIds: childSessionIds.length ? childSessionIds : externalRun.childSessionIds,
        lastTodoAt: plan.length ? new Date().toISOString() : externalRun.lastTodoAt,
        lastChildrenAt: childrenResult.status === 'fulfilled' ? new Date().toISOString() : externalRun.lastChildrenAt,
      })
    }
  } catch {
    /* Session mapping is an audit enhancement; never change run outcome. */
  }
}
