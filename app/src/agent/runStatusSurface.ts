import type {
  RunActivityEvent,
  RunTaskItem,
} from '../store/runActivityStore.ts'
import type { RunLifecyclePhase, RunLifecycleView } from './runLifecycle.ts'
import type { RunnerCapabilities } from './runners/types.ts'
import type { WorkingStateProjection } from './workingStateProjection.ts'

export type RunStatusMilestone = {
  id: string
  description: string
  status: RunTaskItem['status']
  blocker?: string
  meta?: string
  details?: RunTaskItem['details']
}

export type RunSecondarySurface =
  | { kind: 'progress'; title: '任務進度'; milestones: RunStatusMilestone[] }
  | { kind: 'activity'; title: '最近活動'; items: string[] }
  | { kind: 'attention'; title: '需要你處理'; action: string; attentionKind: 'approval' | 'authentication' | 'input' }
  | { kind: 'summary'; title: '執行摘要'; items: string[]; outcome: 'completed' | 'cancelled' | 'failed' }

export type RunStatusSurfaceProjection = {
  phase: RunLifecyclePhase | 'idle'
  label: string
  live: boolean
  updatedAt?: number
  secondary?: RunSecondarySurface
}

export type RunStatusSurfaceInput = {
  lifecycle: RunLifecycleView
  capabilities: Readonly<RunnerCapabilities>
  isExternal: boolean
  activity: {
    events: readonly RunActivityEvent[]
    fileChanges: readonly unknown[]
    terminal: boolean | object | null
    updatedAt: number
    interaction: { kind: 'user' | 'approval' } | null
    authenticationRequired?: boolean
    tasks?: readonly RunTaskItem[]
  }
  workingState?: WorkingStateProjection
  approvalPending?: boolean
}

const PHASE_COPY: Record<RunLifecyclePhase | 'idle', string> = {
  idle: '等待執行',
  starting: '準備執行',
  thinking: '分析中',
  planning: '規劃中',
  executing: '執行工具',
  awaiting_user: '等待你的回覆',
  manual_intervention: '等待核准',
  responding: '整理回覆',
  finalizing: '整理執行摘要',
  completed: '已完成',
  failed: '執行失敗',
  cancelled: '已取消',
  cancel_requested: '正在安全停止',
}

function safeToolPhase(events: readonly RunActivityEvent[]): string | undefined {
  const latest = [...events].reverse().find((event) => event.kind === 'tool' || event.kind === 'file')
  if (!latest) return undefined
  if (latest.kind === 'file') return '修改檔案'
  const tool = (latest.tool || '').toLowerCase()
  if (/search|grep|glob|find/.test(tool)) return '搜尋中'
  if (/read|open|list|inspect/.test(tool)) return '讀取專案'
  if (/write|edit|patch|stage|revert|commit/.test(tool)) return '修改檔案'
  if (/test|check|build|verify|lint|smoke/.test(tool)) return '驗證中'
  return '執行工具'
}

function executionLabel(lifecycle: RunLifecycleView, events: readonly RunActivityEvent[]): string {
  if (lifecycle.phase === 'executing') return safeToolPhase(events) || PHASE_COPY.executing
  if (lifecycle.terminal) return lifecycle.label
  return PHASE_COPY[lifecycle.phase]
}

function safeToolName(value: string | undefined): string {
  if (!value || !/^[a-zA-Z0-9_.:-]{1,48}$/.test(value)) return '工具'
  return value
}

function activityLabel(event: RunActivityEvent): string | undefined {
  if (event.kind === 'tool') return `執行 ${safeToolName(event.tool)}`
  if (event.kind === 'file') return '更新工作區檔案'
  if (event.kind === 'error') return '執行發生錯誤'
  if (event.kind === 'done') return '完成執行階段'
  if (event.kind === 'compaction') return '整理執行上下文'
  return undefined
}

function recentActivity(events: readonly RunActivityEvent[]): string[] {
  const labels: string[] = []
  for (const event of events) {
    const label = activityLabel(event)
    if (!label || labels.at(-1) === label) continue
    labels.push(label)
  }
  return labels.slice(-5)
}

function attentionSurface(input: RunStatusSurfaceInput): RunSecondarySurface | undefined {
  if (input.approvalPending || input.activity.interaction?.kind === 'approval' || input.lifecycle.phase === 'manual_intervention') {
    return { kind: 'attention', title: '需要你處理', attentionKind: 'approval', action: '查看核准要求並做出決定。' }
  }
  if (input.activity.authenticationRequired === true) {
    return { kind: 'attention', title: '需要你處理', attentionKind: 'authentication', action: '完成登入後再繼續。' }
  }
  if (input.activity.interaction?.kind === 'user' || input.lifecycle.phase === 'awaiting_user') {
    return { kind: 'attention', title: '需要你處理', attentionKind: 'input', action: '回覆 Agent 所需資訊。' }
  }
  return undefined
}

function terminalSurface(input: RunStatusSurfaceInput): RunSecondarySurface | undefined {
  if (!input.lifecycle.terminal && !input.activity.terminal) return undefined
  const phase = input.lifecycle.phase
  const outcome = phase === 'failed' ? 'failed' : phase === 'cancelled' ? 'cancelled' : 'completed'
  const goal = input.lifecycle.outcome.goalProjection
  const items: string[] = []
  if (outcome === 'failed') {
    items.push('執行未完成。可開啟執行資訊查看原因後重試。')
  } else if (outcome === 'cancelled') {
    items.push(input.lifecycle.interruptReason === 'timeout' ? '執行因逾時中止。' : '執行已停止。')
  } else if (goal === 'failed') {
    items.push('執行已完成，但 Goal 驗收未通過。')
  } else if (goal === 'blocked') {
    items.push('執行已完成，但 Goal 驗收被阻擋。')
  } else if (goal === 'unverifiable') {
    items.push('執行已完成，但 Goal 缺少可執行的驗收方式。')
  } else if (goal === 'exhausted') {
    items.push('執行已完成，但 Goal 在 budget 內仍未通過。')
  } else if (goal === 'legacy-unverified') {
    items.push('這是舊格式結果；沒有足夠證據推定 Goal 已通過。')
  } else if (input.isExternal || goal === 'not-applicable') {
    items.push('外部程序已結束；這不代表 Checker 已確認任務完成。')
  } else if (input.lifecycle.iterationExhausted) {
    items.push('執行已結束，但仍有未完成的目標。')
  } else {
    items.push('執行已完成。')
  }
  const changedFiles = input.activity.fileChanges.length
  if (changedFiles > 0) items.push(`變更 ${changedFiles} 個檔案。`)
  return { kind: 'summary', title: '執行摘要', items, outcome }
}

function progressSurface(input: RunStatusSurfaceInput): RunSecondarySurface | undefined {
  const tasks = input.activity.tasks || []
  if (tasks.length === 0) return undefined
  return {
    kind: 'progress',
    title: '任務進度',
    milestones: tasks.map((task) => ({
      id: task.id,
      description: task.text,
      status: task.status,
      ...(task.status === 'failed' ? { blocker: 'Agent 標記此項失敗' } : {}),
      ...(task.meta ? { meta: task.meta } : {}),
      ...(task.details ? { details: task.details } : {}),
    })),
  }
}

export function projectRunStatusSurface(input: RunStatusSurfaceInput): RunStatusSurfaceProjection {
  const attention = attentionSurface(input)
  const terminal = terminalSurface(input)
  const progress = progressSurface(input)
  const activity = recentActivity(input.activity.events)
  const secondary = attention
    || terminal
    || progress
    || (activity.length > 0 ? { kind: 'activity' as const, title: '最近活動' as const, items: activity } : undefined)
  return {
    phase: input.lifecycle.phase,
    label: executionLabel(input.lifecycle, input.activity.events),
    live: input.lifecycle.live,
    ...(input.activity.updatedAt > 0 ? { updatedAt: input.activity.updatedAt } : {}),
    ...(secondary ? { secondary } : {}),
  }
}
