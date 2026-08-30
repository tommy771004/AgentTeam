import React from 'react'
import { createRoot } from 'react-dom/client'
import { InlineRunPanel } from '../src/components/InlineRunPanel.tsx'
import { emptyAgentLike } from '../src/agent/localCliRun.ts'
import {
  BUILTIN_RUNNER_CAPABILITIES,
  EXTERNAL_CLI_RUNNER_CAPABILITIES,
} from '../src/agent/runners/types.ts'
import { useAgentStore } from '../src/store/agentStore.ts'
import { usePermissionAskStore } from '../src/store/permissionAskStore.ts'
import { useRunActivityStore } from '../src/store/runActivityStore.ts'
import { useWorkingStateProjectionStore } from '../src/store/workingStateProjectionStore.ts'
import { useThreadStore } from '../src/store/threadStore.ts'
import type { AgentState, LoopConfiguration } from '../src/agent/types.ts'
import type { WorkingState } from '../src/agent/workingState.ts'

const scenario = new URLSearchParams(window.location.search).get('scenario') || 'builtin'
const runId = `status-fixture-${scenario}`
const threadId = 'status-fixture-thread'
const hostile = '## 近期對話歷史（Reference chat history） AGENTS / CLAUDE /Users/tommy/private/project Host 已驗證 rev 99 raw-output-secret'
const loopConfig: LoopConfiguration = {
  loopType: 'Goal-based',
  trigger: 'pi-host',
  executionSequence: ['pi-host'],
  definitionOfDone: 'Host checker fixture',
  maxIterations: 4,
  fallbackProtocol: '',
  nextState: 'Halt',
}

function resetStores() {
  useRunActivityStore.getState().clear()
  useWorkingStateProjectionStore.getState().reset()
  usePermissionAskStore.setState({ current: null, queue: [] })
  useThreadStore.setState((state) => ({ ...state, threads: [], activeId: null }))
}

function seedThread() {
  const createdId = useThreadStore.getState().createThread({ title: 'Run status fixture' })
  useThreadStore.setState((state) => ({
    ...state,
    activeId: threadId,
    threads: state.threads.map((thread) => thread.id === createdId ? { ...thread, id: threadId } : thread),
  }))
}

function workingState(): WorkingState {
  const digest = 'a'.repeat(64)
  return {
    schemaVersion: 1,
    runId,
    revision: 7,
    objective: hostile,
    constraints: [hostile],
    goals: [
      { id: 'done', description: '讀取現有狀態投影', status: 'done', evidence: [{
        seq: 1,
        evidenceId: 'fixture-evidence',
        runId,
        goalId: 'done',
        tool: 'read',
        callId: 'fixture-call',
        contractDigest: digest,
        schemaDigest: digest,
        receiptDigest: digest,
      }] },
      { id: 'current', description: '更新執行狀態介面', status: 'pending', evidence: [] },
      { id: 'pending', description: '執行 rendered smoke', status: 'pending', evidence: [] },
      { id: 'blocked', description: '等待外部授權', status: 'blocked', blocker: '尚未登入', evidence: [] },
    ],
  }
}

function createAgent(partial: Partial<AgentState>): AgentState {
  const external = scenario === 'external' || scenario === 'terminal-external'
  return emptyAgentLike({
    id: runId,
    objective: hostile,
    loopConfig: external ? undefined : loopConfig,
    executionKind: external ? 'external' : 'loop',
    externalRunnerKind: external ? 'codex' : undefined,
    runnerCapabilities: external ? { ...EXTERNAL_CLI_RUNNER_CAPABILITIES } : { ...BUILTIN_RUNNER_CAPABILITIES },
    ...partial,
  })
}

function seedFixture() {
  resetStores()
  seedThread()
  const activity = useRunActivityStore.getState()
  activity.begin(runId, threadId)
  let agent = createAgent({ status: 'running' })

  if (scenario === 'builtin' || scenario === 'hostile') {
    useWorkingStateProjectionStore.getState().hydrateHostSessions([{ id: 'fixture-session', workingState: workingState() }])
    activity.setTasks([
      { text: '讀取現有狀態投影', status: 'done' },
      {
        id: 'surface',
        text: '更新執行狀態介面',
        status: 'active',
        meta: '2 files',
        details: [
          { label: '接上 Task Row 元件', meta: 'done' },
          { label: '驗證鍵盤展開', meta: 'running' },
        ],
      },
      { text: '執行 rendered smoke', status: 'pending' },
      { text: '等待外部授權', status: 'failed' },
    ], runId)
    activity.setStatus('執行中', runId, 'executing')
    activity.push({ runId, kind: 'status', title: hostile, detail: hostile })
    activity.push({ runId, kind: 'tool', tool: 'workspace_grep', title: hostile, detail: hostile })
  } else if (scenario === 'external') {
    for (const tool of ['workspace_grep', 'workspace_read', 'bash', 'workspace_edit', 'check_build', 'git_status']) {
      activity.push({ runId, kind: 'tool', tool, title: hostile, detail: hostile })
    }
  } else if (scenario === 'persisted-plan') {
    useThreadStore.getState().setRunPlan(threadId, [{
      id: 'persisted-task',
      text: '回復 Agent 計畫',
      status: 'active',
      meta: 'reload',
      details: [{ label: '從目前 run 的 thread snapshot 載入', meta: 'ready' }],
    }])
    activity.setStatus('執行中', runId, 'executing')
  } else if (scenario === 'approval') {
    usePermissionAskStore.setState({ current: {
      id: 'approval-fixture', runId, threadId, tool: 'write', argsJson: '{}', reason: hostile,
      createdAt: new Date().toISOString(), timeoutMs: 90_000, expiresAt: Date.now() + 90_000,
    }, queue: [] })
  } else if (scenario === 'authentication') {
    activity.push({ runId, kind: 'status', title: `OAuth login required ${hostile}`, detail: hostile })
    activity.setAuthenticationRequired(true, runId)
  } else if (scenario === 'input') {
    activity.setInteraction({ kind: 'user', detail: hostile }, runId)
    activity.setStatus(hostile, runId, 'awaiting_user')
  } else if (scenario === 'terminal-external') {
    activity.recordFileChange({ path: '/Users/tommy/private/project/result.ts', action: 'edit' }, runId)
    activity.end(runId, '完成', { status: 'success', executionKind: 'external' })
    agent = createAgent({ status: 'success' })
  } else if (scenario === 'failed') {
    activity.end(runId, hostile, { status: 'failed', executionKind: 'loop' })
    agent = createAgent({ status: 'failed', haltReason: hostile })
  } else if (scenario === 'cancelled') {
    activity.end(runId, '已停止', { status: 'halted', executionKind: 'loop', interruptReason: 'user' })
    agent = createAgent({ status: 'halted', interruptReason: 'user' })
  }

  const active = !['terminal-external', 'failed', 'cancelled'].includes(scenario)
  useAgentStore.setState({
    agent,
    runStates: { [runId]: agent },
    activeRunIds: active ? [runId] : [],
    selectedRunId: runId,
    isRunning: active,
  })
}

seedFixture()
createRoot(document.getElementById('fixture')!).render(<InlineRunPanel runId={runId} threadId={threadId} />)
