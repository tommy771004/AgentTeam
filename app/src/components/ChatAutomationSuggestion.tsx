import { useCallback } from 'react'
import type { AutomationSuggestion } from '../agent/automationSuggestion'
import {
  eventCreateRequest,
  scheduleCreateRequest,
} from '../agent/composerAutomationDraft'
import { MAX_QUEUE, queueLength } from '../agent/runQueue'
import { skillsStore } from '../agent/hermes/skills'
import { useAutomationConsentStore } from '../store/automationConsentStore'
import { useProjectStore } from '../store/projectStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useThreadStore } from '../store/threadStore'
import {
  AutomationSuggestionCard,
  type AutomationCreatedInfo,
} from './AutomationSuggestionCard'

/**
 * Automation one-click（spec 5/6 ticket 01）— 把建議卡接到真正的建立路徑。
 *
 * 卡片本身不碰 store：這一層負責讀佇列與 Skills、呼叫與自動化頁完全相同的
 * 建立函式，並把「已建立／已拒絕」記進同意記憶。
 */
export function ChatAutomationSuggestion({
  suggestion,
  threadId,
}: {
  suggestion: AutomationSuggestion
  threadId?: string | null
}) {
  const addJob = useScheduleStore((s) => s.addJob)
  const addEvent = useScheduleStore((s) => s.addEvent)
  const jobs = useScheduleStore((s) => s.jobs)
  const events = useScheduleStore((s) => s.events)
  const projectRoot = useProjectStore((s) => s.root)
  const created = useAutomationConsentStore((s) => s.created[suggestion.dedupKey])
  const recordCreated = useAutomationConsentStore((s) => s.recordCreated)
  const dismiss = useAutomationConsentStore((s) => s.dismiss)
  const runner = useThreadStore(
    (s) => s.threads.find((t) => t.id === threadId)?.runner || 'builtin',
  )

  const onCreateSchedule = useCallback(
    async (draft: Parameters<typeof scheduleCreateRequest>[0]) => {
      const request = scheduleCreateRequest(draft, { runner, projectRoot })
      await addJob(request)
      // addJob 產生 id/nextRunAt，回讀剛建立的那一筆才能顯示下次觸發時間
      const job = useScheduleStore
        .getState()
        .jobs.find((item) => item.objective === request.objective && item.name === request.name)
      const info: AutomationCreatedInfo = {
        kind: 'schedule',
        name: request.name,
        summary:
          request.kind === 'interval'
            ? `每 ${request.intervalMinutes} 分鐘執行`
            : request.kind === 'once'
              ? '指定時間執行一次'
              : `每天 ${request.dailyAt} 執行`,
        href: '#/automation',
        nextRunAt: job?.nextRunAt ?? null,
      }
      recordCreated(suggestion.dedupKey, info)
      return info
    },
    [addJob, projectRoot, recordCreated, runner, suggestion.dedupKey],
  )

  const onCreateEvent = useCallback(
    async (draft: Parameters<typeof eventCreateRequest>[0]) => {
      const request = eventCreateRequest(draft)
      await addEvent(request)
      const info: AutomationCreatedInfo = {
        kind: 'event',
        name: request.name,
        summary: `來源 ${request.source}${request.keyword ? ` · 內容含「${request.keyword}」` : ''} 時觸發`,
        href: '#/automation?tab=events',
      }
      recordCreated(suggestion.dedupKey, info)
      return info
    },
    [addEvent, recordCreated, suggestion.dedupKey],
  )

  // 卡片渲染當下若已存在等價的啟用中自動化（例如在自動化頁另外建了），
  // 就不該再給一顆會建立第二筆的按鈕。
  const alreadyActive =
    suggestion.kind === 'schedule'
      ? jobs.some((job) => job.enabled && job.objective === suggestion.objective)
      : events.some((event) => event.enabled && event.objective === suggestion.objective)

  if (!created && alreadyActive) {
    return (
      <p className="px-0.5 py-1 text-[11px] text-ink-3">
        已有啟用中的自動化在做同一件事，這次不重複建立。
      </p>
    )
  }

  return (
    <AutomationSuggestionCard
      suggestion={suggestion}
      queueLength={queueLength()}
      queueMax={MAX_QUEUE}
      availableSkills={skillsStore.list().map((skill) => skill.meta.name)}
      runnerLabel={runner === 'builtin' ? '內建' : runner}
      created={created ?? null}
      onCreateSchedule={onCreateSchedule}
      onCreateEvent={onCreateEvent}
      onDismiss={() => dismiss(suggestion.dedupKey)}
    />
  )
}
