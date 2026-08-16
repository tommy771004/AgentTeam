import { useCallback, useEffect, useState } from 'react'
import type { AutomationCreatedInfo } from '../agent/automationConsent'
import {
  findActiveEventFor,
  findActiveScheduleFor,
} from '../agent/automationConsent'
import type { AutomationSuggestion } from '../agent/automationSuggestion'
import {
  describeEventDraft,
  describeScheduleDraft,
  eventCreateRequest,
  scheduleCreateRequest,
  type EventDraft,
  type ScheduleDraft,
} from '../agent/composerAutomationDraft'
import { skillsStore } from '../agent/hermes/skills'
import { MAX_QUEUE, queueLength } from '../agent/runQueue'
import { useAutomationConsentStore } from '../store/automationConsentStore'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useThreadStore, type ThreadRunner } from '../store/threadStore'
import { AutomationSuggestionCard } from './AutomationSuggestionCard'

/**
 * Automation one-click（spec 5/6 ticket 01）— 把建議卡接到真正的建立路徑。
 *
 * 卡片本身不碰 store：這一層負責讀佇列與 Skills、呼叫與自動化頁完全相同的
 * 建立函式，並把「已建立／已拒絕」記進同意記憶。
 */
export function ChatAutomationSuggestion({
  suggestion,
}: {
  suggestion: AutomationSuggestion
}) {
  const addJob = useScheduleStore((s) => s.addJob)
  const addEvent = useScheduleStore((s) => s.addEvent)
  const jobs = useScheduleStore((s) => s.jobs)
  const events = useScheduleStore((s) => s.events)
  const projectRoot = useProjectStore((s) => s.root)
  const created = useAutomationConsentStore((s) => s.created[suggestion.dedupKey])
  const decision = useAutomationConsentStore((s) => s.decisions[suggestion.dedupKey])
  const recordCreated = useAutomationConsentStore((s) => s.recordCreated)
  const dismiss = useAutomationConsentStore((s) => s.dismiss)
  const threadRunner = useThreadStore(
    (s) => s.threads.find((t) => t.id === s.activeId)?.runner || 'builtin',
  )
  const [runner, setRunner] = useState<ThreadRunner>(threadRunner)

  /**
   * 佇列長度不是 store，是模組層狀態；只在 render 當下取一次會凍住。
   * 卡片開著的時候輕量輪詢，讓「待跑 n/24」講的是現在，而不是打開卡片那一刻。
   */
  const [queued, setQueued] = useState(() => queueLength())
  useEffect(() => {
    const timer = window.setInterval(() => setQueued(queueLength()), 2_000)
    return () => window.clearInterval(timer)
  }, [])

  const onCreateSchedule = useCallback(
    async (draft: ScheduleDraft): Promise<AutomationCreatedInfo> => {
      const request = scheduleCreateRequest(draft, {
        runner,
        projectRoot,
        createdFrom: 'chat-suggestion',
      })
      // addJob 回傳建立出來的那一筆——不靠 name+objective 回讀，同目標多筆時不會抓錯人
      const job = await addJob(request)
      const info: AutomationCreatedInfo = {
        kind: 'schedule',
        name: job.name,
        summary: describeScheduleDraft(draft),
        href: '#/automation',
        nextRunAt: job.nextRunAt,
      }
      recordCreated(suggestion.dedupKey, info)
      return info
    },
    [addJob, projectRoot, recordCreated, runner, suggestion.dedupKey],
  )

  const onCreateEvent = useCallback(
    async (draft: EventDraft): Promise<AutomationCreatedInfo> => {
      const event = await addEvent(eventCreateRequest(draft))
      const info: AutomationCreatedInfo = {
        kind: 'event',
        name: event.name,
        summary: describeEventDraft(draft),
        href: '#/automation?tab=events',
      }
      recordCreated(suggestion.dedupKey, info)
      return info
    },
    [addEvent, recordCreated, suggestion.dedupKey],
  )

  // 使用者按過「不用了」就收起卡片——否則那顆按鈕等於沒有作用。
  if (!created && decision?.action === 'dismissed') {
    return (
      <p className="px-0.5 py-1 text-[11px] text-ink-3">已略過這個自動化建議。</p>
    )
  }

  // 渲染當下若已存在等價的啟用中自動化（例如剛從自動化頁建了），就不該再給一顆
  // 會建立第二筆的按鈕。比對規則與 policy 端共用，避免同一個問題兩套答案。
  const active =
    suggestion.kind === 'schedule'
      ? findActiveScheduleFor(suggestion.objective, jobs)
      : findActiveEventFor(suggestion.objective, events)

  if (!created && active) {
    return (
      <p className="px-0.5 py-1 text-[11px] text-ink-3">
        已有啟用中的自動化「{active.name}」在做同一件事，這次不重複建立。
      </p>
    )
  }

  return (
    <AutomationSuggestionCard
      suggestion={suggestion}
      queueLength={queued}
      queueMax={MAX_QUEUE}
      availableSkills={skillsStore.list().map((skill) => skill.meta.name)}
      runner={runner}
      onRunnerChange={setRunner}
      created={created ?? null}
      onCreateSchedule={onCreateSchedule}
      onCreateEvent={onCreateEvent}
      onDismiss={() => dismiss(suggestion.dedupKey)}
    />
  )
}
