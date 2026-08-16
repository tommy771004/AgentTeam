import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  EVENT_SOURCE_SUGGESTIONS,
  buildEventDraft,
  buildScheduleDraft,
  describeEventDraft,
  describeScheduleDraft,
  eventDraftReady,
  scheduleDraftReady,
  type EventDraft,
  type ScheduleDraft,
} from '../agent/composerAutomationDraft'
import type { ScheduleKind } from '../agent/types'
import { useDialogKeys } from '../hooks/useDialogKeys'
import { Icon } from './Icon'

export type AutomationCreateKind = 'schedule' | 'event'

export type AutomationCreated = {
  kind: AutomationCreateKind
  name: string
  /** 一句話說明何時會觸發，直接進系統訊息 */
  summary: string
}

/**
 * Composer new-task flow（ticket 04/05）— 對話內的自動化建立表單。
 *
 * 「排程／事件」不再只是替對話標記語意（點了什麼都不會發生），而是就地開這張
 * 表單：目標已用 composer 的文字預填，改完按建立就真的產生一筆規則，並在
 * 自動化頁看得到同一筆。取消什麼都不做，composer 的輸入原封不動留著。
 *
 * 排程與事件共用同一個外殼與同一組建立後回饋，兩個 tile 的體驗一致。
 */
export function AutomationCreateSheet({
  kind,
  objective,
  onCreateSchedule,
  onCreateEvent,
  onCreated,
  onClose,
}: {
  /** null = 關閉 */
  kind: AutomationCreateKind | null
  /** composer 現有文字，用來預填 */
  objective: string
  onCreateSchedule: (draft: ScheduleDraft) => Promise<void>
  onCreateEvent: (draft: EventDraft) => Promise<void>
  onCreated: (created: AutomationCreated) => void
  onClose: () => void
}) {
  const [schedule, setSchedule] = useState<ScheduleDraft>(() => buildScheduleDraft(objective))
  const [event, setEvent] = useState<EventDraft>(() => buildEventDraft(objective))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const objectiveRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLElement>(null)

  // 每次開啟都重新從目前的 composer 文字預填——上一次開啟的殘留不該蓋掉新輸入。
  useEffect(() => {
    if (!kind) return
    setSchedule(buildScheduleDraft(objective))
    setEvent(buildEventDraft(objective))
    setError(null)
    objectiveRef.current?.focus()
  }, [kind, objective])

  useDialogKeys({ open: Boolean(kind), containerRef: cardRef, onClose })

  if (!kind) return null

  const isSchedule = kind === 'schedule'
  const ready = isSchedule ? scheduleDraftReady(schedule) : eventDraftReady(event)

  const submit = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      if (isSchedule) {
        await onCreateSchedule(schedule)
        onCreated({
          kind,
          name: schedule.name || schedule.objective.slice(0, 40),
          summary: describeScheduleDraft(schedule),
        })
      } else {
        await onCreateEvent(event)
        onCreated({
          kind,
          name: event.name || event.objective.slice(0, 40),
          summary: describeEventDraft(event),
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md animate-macos-fade"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose()
      }}
    >
      <section
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-create-title"
        data-testid="automation-create-sheet"
        className="flex max-h-[min(680px,calc(100vh-4rem))] w-full max-w-lg flex-col overflow-hidden rounded-card border border-line bg-surface animate-macos-sheet"
      >
        <header className="primitive-card-pad flex items-start gap-3 border-b border-line bg-inset">
          <Icon
            aria-hidden
            name={isSchedule ? 'schedule' : 'bolt'}
            size={18}
            className="mt-0.5 shrink-0 text-ink-2"
          />
          <div className="min-w-0">
            <h2 id="automation-create-title" className="text-[14px] font-semibold text-ink">
              {isSchedule ? '建立定時任務' : '建立事件規則'}
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
              {isSchedule
                ? '到期時自動執行這個目標。建立後可在「自動化」頁調整或停用。'
                : '條件全部成立時才觸發。建立後可在「自動化」頁調整、停用或模擬。'}
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
          <Field label="目標" hint="任務實際要做的事">
            <textarea
              ref={objectiveRef}
              rows={3}
              value={isSchedule ? schedule.objective : event.objective}
              placeholder="例如：整理今天的收件匣並寫出待辦摘要"
              onChange={(changeEvent) => {
                const next = changeEvent.target.value
                if (isSchedule) setSchedule((draft) => ({ ...draft, objective: next }))
                else setEvent((draft) => ({ ...draft, objective: next }))
              }}
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </Field>

          <Field label="名稱" hint="清單上的顯示名稱">
            <input
              value={isSchedule ? schedule.name : event.name}
              placeholder={isSchedule ? '定時任務' : '事件規則'}
              onChange={(changeEvent) => {
                const next = changeEvent.target.value
                if (isSchedule) setSchedule((draft) => ({ ...draft, name: next }))
                else setEvent((draft) => ({ ...draft, name: next }))
              }}
              className={inputCls}
            />
          </Field>

          {isSchedule ? (
            <ScheduleFields draft={schedule} onChange={setSchedule} />
          ) : (
            <EventFields draft={event} onChange={setEvent} />
          )}

          <p className="rounded-control bg-inset px-3 py-2 text-[11px] leading-relaxed text-ink-3">
            {isSchedule ? describeScheduleDraft(schedule) : describeEventDraft(event)}
          </p>

          {error ? (
            <p role="alert" className="text-[11px] leading-relaxed text-orange">
              建立失敗：{error}
            </p>
          ) : null}
        </div>

        <footer className="primitive-card-footer flex items-center justify-between gap-2 border-t border-line bg-inset">
          <span className="min-w-0 truncate text-[11px] text-ink-3">
            {ready ? '' : '請先填寫目標'}
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-hover disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!ready || saving}
              className="rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-canvas shadow-btn transition-[filter] hover:brightness-110 disabled:opacity-40"
            >
              {saving ? '建立中…' : '建立'}
            </button>
          </span>
        </footer>
      </section>
    </div>
  )
}

const inputCls =
  'w-full rounded-control border border-line bg-inset px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors focus:border-line-strong'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-ink-2">{label}</span>
        {hint ? <span className="text-[10px] text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

const SCHEDULE_KINDS: Array<{ id: ScheduleKind; label: string }> = [
  { id: 'daily', label: '每天' },
  { id: 'interval', label: '每隔' },
  { id: 'once', label: '一次' },
]

function ScheduleFields({
  draft,
  onChange,
}: {
  draft: ScheduleDraft
  onChange: (next: (current: ScheduleDraft) => ScheduleDraft) => void
}) {
  return (
    <>
      <Field label="頻率">
        <div className="flex gap-1">
          {SCHEDULE_KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={draft.kind === option.id}
              onClick={() => onChange((current) => ({ ...current, kind: option.id }))}
              className={`rounded-control px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                draft.kind === option.id
                  ? 'bg-accent-tint text-accent-ink'
                  : 'bg-inset text-ink-2 hover:bg-hover-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      {draft.kind === 'daily' ? (
        <Field label="時間">
          <input
            type="time"
            value={draft.dailyAt}
            onChange={(changeEvent) => {
              const next = changeEvent.target.value
              onChange((current) => ({ ...current, dailyAt: next }))
            }}
            className={inputCls}
          />
        </Field>
      ) : null}

      {draft.kind === 'interval' ? (
        <Field label="間隔（分鐘）" hint="建議不低於 10 分鐘">
          <input
            type="number"
            min={1}
            value={draft.intervalMinutes}
            onChange={(changeEvent) => {
              const next = Number(changeEvent.target.value)
              onChange((current) => ({
                ...current,
                intervalMinutes: Number.isFinite(next) ? next : current.intervalMinutes,
              }))
            }}
            className={inputCls}
          />
        </Field>
      ) : null}

      {draft.kind === 'once' ? (
        <Field label="執行時間" hint="留空則一分鐘後執行">
          <input
            type="datetime-local"
            value={draft.runAt}
            onChange={(changeEvent) => {
              const next = changeEvent.target.value
              onChange((current) => ({ ...current, runAt: next }))
            }}
            className={inputCls}
          />
        </Field>
      ) : null}
    </>
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
    <>
      <Field label="來源" hint="事件 payload 宣告的 source">
        <input
          value={draft.source}
          list="automation-event-sources"
          onChange={(changeEvent) => {
            const next = changeEvent.target.value
            onChange((current) => ({ ...current, source: next }))
          }}
          className={`${inputCls} font-[family-name:var(--font-mono)]`}
        />
        <datalist id="automation-event-sources">
          {EVENT_SOURCE_SUGGESTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.hint}
            </option>
          ))}
        </datalist>
        <span className="mt-1 flex flex-wrap gap-1">
          {EVENT_SOURCE_SUGGESTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={draft.source === option.id}
              title={option.hint}
              onClick={() => onChange((current) => ({ ...current, source: option.id }))}
              className={`rounded-control px-2 py-1 text-[10px] font-medium transition-colors ${
                draft.source === option.id
                  ? 'bg-accent-tint text-accent-ink'
                  : 'bg-inset text-ink-3 hover:bg-hover-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </span>
      </Field>

      <Field label="主旨包含" hint="留空表示不檢查">
        <input
          value={draft.subjectContains}
          onChange={(changeEvent) => {
            const next = changeEvent.target.value
            onChange((current) => ({ ...current, subjectContains: next }))
          }}
          className={inputCls}
        />
      </Field>

      <Field label="內容關鍵字" hint="留空表示不檢查">
        <input
          value={draft.keyword}
          onChange={(changeEvent) => {
            const next = changeEvent.target.value
            onChange((current) => ({ ...current, keyword: next }))
          }}
          className={inputCls}
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={draft.hasAttachment}
          onChange={(changeEvent) => {
            const next = changeEvent.target.checked
            onChange((current) => ({ ...current, hasAttachment: next }))
          }}
          className="accent-primary-container"
        />
        必須帶附件
      </label>
    </>
  )
}
