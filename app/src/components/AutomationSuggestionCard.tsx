import { useState } from 'react'
import type { AutomationCreatedInfo } from '../agent/automationConsent'
import type { AutomationSuggestion } from '../agent/automationSuggestion'
import {
  SCHEDULE_TRIGGER_CAVEAT,
  describeQueueLoad,
  eventDraftFromSuggestion,
  scheduleDraftFromSuggestion,
} from '../agent/automationConsent'
import {
  EVENT_SOURCE_SUGGESTIONS,
  describeEventDraft,
  describeScheduleDraft,
  eventDraftReady,
  scheduleDraftReady,
  type EventDraft,
  type ScheduleDraft,
} from '../agent/composerAutomationDraft'
import { JOB_RUNNER_OPTIONS } from '../agent/composerAutomationDraft'
import type { ScheduleKind } from '../agent/types'
import type { ThreadRunner } from '../store/threadStore'
import { Icon } from './Icon'

/**
 * Automation one-click（spec 5/6 ticket 01）— 對話內的自動化建議卡。
 *
 * 以前對話偵測到「每天早上八點…」只會回一句「請到自動化頁建立」——最強的能力
 * 配上最遠的入口。這張卡把建立搬到現場：預填、可改、按一下就成立。
 *
 * consent-first 沒有被放寬：不按「建立」什麼都不會發生，對話文字也永遠不會直接
 * 啟動 Time/Proactive run；這裡只是把「同意之後的路」縮短。
 */
export function AutomationSuggestionCard({
  suggestion,
  queueLength,
  queueMax,
  availableSkills,
  runner,
  onRunnerChange,
  onCreateSchedule,
  onCreateEvent,
  onDismiss,
  created,
}: {
  suggestion: AutomationSuggestion
  queueLength: number
  queueMax: number
  availableSkills: string[]
  /** 這筆自動化要用的執行引擎（預設沿用對話，但可改） */
  runner: ThreadRunner
  onRunnerChange: (runner: ThreadRunner) => void
  onCreateSchedule: (draft: ScheduleDraft) => Promise<AutomationCreatedInfo>
  onCreateEvent: (draft: EventDraft) => Promise<AutomationCreatedInfo>
  onDismiss: () => void
  /** 已建立時直接呈現已啟用狀態（重新掛載後仍正確） */
  created?: AutomationCreatedInfo | null
}) {
  const isSchedule = suggestion.kind === 'schedule'
  const [schedule, setSchedule] = useState<ScheduleDraft>(() =>
    scheduleDraftFromSuggestion(suggestion),
  )
  const [event, setEvent] = useState<EventDraft>(() => eventDraftFromSuggestion(suggestion))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AutomationCreatedInfo | null>(created ?? null)

  const ready = isSchedule ? scheduleDraftReady(schedule) : eventDraftReady(event)

  const create = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      const info = isSchedule ? await onCreateSchedule(schedule) : await onCreateEvent(event)
      setResult(info)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <section
        data-testid="automation-suggestion-card"
        data-state="enabled"
        className="rounded-card border border-line bg-surface-container-low px-3 py-2.5"
      >
        <div className="flex items-start gap-2">
          <Icon aria-hidden name="check_circle" size={16} className="mt-0.5 shrink-0 text-accent-ink" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-semibold text-ink">
              已啟用{result.kind === 'schedule' ? '定時任務' : '事件規則'}「{result.name}」
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
              {result.summary}
              {result.nextRunAt ? ` · 下次觸發 ${formatWhen(result.nextRunAt)}` : ''}
            </p>
            <a
              href={result.href}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-ink underline-offset-2 hover:underline"
            >
              前往自動化頁管理
              <Icon aria-hidden name="arrow_forward" size={13} />
            </a>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      data-testid="automation-suggestion-card"
      data-state="proposed"
      aria-label={isSchedule ? '排程建議' : '事件規則建議'}
      className="rounded-card border border-line bg-surface-container-low px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          name={isSchedule ? 'schedule' : 'bolt'}
          size={16}
          className="mt-0.5 shrink-0 text-ink-3"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-[12px] font-semibold text-ink">
              {isSchedule ? '要建立定時任務嗎？' : '要建立事件規則嗎？'}
            </h3>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">{suggestion.reason}</p>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-ink-2">目標</span>
            <textarea
              rows={2}
              aria-label="自動化目標"
              value={isSchedule ? schedule.objective : event.objective}
              onChange={(e) => {
                const next = e.target.value
                if (isSchedule) setSchedule((d) => ({ ...d, objective: next }))
                else setEvent((d) => ({ ...d, objective: next }))
              }}
              className={inputCls}
            />
          </label>

          {isSchedule ? (
            <ScheduleFields draft={schedule} onChange={setSchedule} skills={availableSkills} />
          ) : (
            <EventFields draft={event} onChange={setEvent} />
          )}

          <p className="text-[10px] leading-relaxed text-ink-3">
            {isSchedule ? describeScheduleDraft(schedule) : describeEventDraft(event)} ·{' '}
            {describeQueueLoad(queueLength, queueMax)}
          </p>

          <div>
            <span className="mb-1 block text-[10px] font-semibold text-ink-2">執行引擎</span>
            <div className="flex flex-wrap gap-1">
              {JOB_RUNNER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={runner === option.id}
                  onClick={() => onRunnerChange(option.id)}
                  className={chipCls(runner === option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {isSchedule ? (
            <p className="text-[10px] leading-relaxed text-ink-3">{SCHEDULE_TRIGGER_CAVEAT}</p>
          ) : null}

          {error ? (
            <p role="alert" className="text-[10px] leading-relaxed text-orange">
              建立失敗：{error}
            </p>
          ) : null}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              disabled={!ready || saving}
              onClick={() => void create()}
              className="rounded-control bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-canvas shadow-btn transition-[filter] hover:brightness-110 disabled:opacity-40"
            >
              {saving ? '建立中…' : '建立'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onDismiss}
              className="rounded-control px-2.5 py-1.5 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2"
            >
              不用了
            </button>
            {!ready ? <span className="text-[10px] text-ink-3">請先填寫目標</span> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function formatWhen(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const inputCls =
  'w-full rounded-control border border-line bg-inset px-2 py-1.5 text-[11px] text-ink outline-none transition-colors focus:border-line-strong'

const KINDS: Array<{ id: ScheduleKind; label: string }> = [
  { id: 'daily', label: '每天' },
  { id: 'interval', label: '每隔' },
  { id: 'once', label: '一次' },
]

function ScheduleFields({
  draft,
  onChange,
  skills,
}: {
  draft: ScheduleDraft
  onChange: (next: (current: ScheduleDraft) => ScheduleDraft) => void
  skills: string[]
}) {
  const selected = draft.skillNames || []
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {KINDS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={draft.kind === option.id}
            onClick={() => onChange((current) => ({ ...current, kind: option.id }))}
            className={chipCls(draft.kind === option.id)}
          >
            {option.label}
          </button>
        ))}
        {draft.kind === 'daily' ? (
          <input
            type="time"
            aria-label="每天執行時間"
            value={draft.dailyAt}
            onChange={(e) => {
              const next = e.target.value
              onChange((current) => ({ ...current, dailyAt: next }))
            }}
            className={`${inputCls} w-28`}
          />
        ) : null}
        {draft.kind === 'interval' ? (
          <input
            type="number"
            min={1}
            aria-label="間隔分鐘"
            value={draft.intervalMinutes}
            onChange={(e) => {
              const next = Number(e.target.value)
              onChange((current) => ({
                ...current,
                intervalMinutes: Number.isFinite(next) ? next : current.intervalMinutes,
              }))
            }}
            className={`${inputCls} w-20`}
          />
        ) : null}
        {draft.kind === 'once' ? (
          <input
            type="datetime-local"
            aria-label="執行時間"
            value={draft.runAt}
            onChange={(e) => {
              const next = e.target.value
              onChange((current) => ({ ...current, runAt: next }))
            }}
            className={`${inputCls} w-52`}
          />
        ) : null}
      </div>

      {draft.kind === 'interval' && draft.intervalMinutes < 10 ? (
        <p className="text-[10px] leading-relaxed text-orange">
          低於 10 分鐘的高頻觸發會明顯增加負載，規格建議避免。
        </p>
      ) : null}

      {skills.length ? (
        <div>
          <span className="mb-1 block text-[10px] font-semibold text-ink-2">附掛 Skills</span>
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 8).map((name) => {
              const on = selected.includes(name)
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange((current) => {
                      const list = current.skillNames || []
                      return {
                        ...current,
                        skillNames: on ? list.filter((s) => s !== name) : [...list, name],
                      }
                    })
                  }
                  className={chipCls(on)}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function EventFields({
  draft,
  onChange,
}: {
  draft: EventDraft
  onChange: (next: (current: EventDraft) => EventDraft) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {EVENT_SOURCE_SUGGESTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={draft.source === option.id}
            title={option.hint}
            onClick={() => onChange((current) => ({ ...current, source: option.id }))}
            className={chipCls(draft.source === option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold text-ink-2">關鍵字（留空不檢查）</span>
        <input
          aria-label="事件關鍵字"
          value={draft.keyword}
          onChange={(e) => {
            const next = e.target.value
            onChange((current) => ({ ...current, keyword: next }))
          }}
          className={inputCls}
        />
      </label>
    </div>
  )
}

function chipCls(active: boolean): string {
  return `rounded-control px-2 py-1 text-[10px] font-medium transition-colors ${
    active ? 'bg-accent-tint text-accent-ink' : 'bg-inset text-ink-2 hover:bg-hover-2'
  }`
}
