import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { useAgentStore } from '../store/agentStore'

/**
 * OpenCode-style ask permission HITL
 *
 * ask_user-shaped asks (hitl) surface the question itself: options from the
 * tool call become the decision surface (single-select sends on click,
 * multi-select collects picks until 送出回覆), and a freeform box rides along
 * whenever the tool allows it. Every other tool keeps the plain 核准/拒絕 UI.
 */
export function PermissionAskModal() {
  const current = usePermissionAskStore((s) => s.current)
  const queue = usePermissionAskStore((s) => s.queue)
  const resolve = usePermissionAskStore((s) => s.resolve)
  const getSessionAllow = usePermissionAskStore((s) => s.getSessionAllow)
  const setSessionAllow = usePermissionAskStore((s) => s.setSessionAllow)
  const hasManualIntervention = useAgentStore((s) =>
    Object.values(s.runStates).some((state) => state.intervention?.active),
  )
  /**
   * 這個倒數以前只在 store 變動時重算，所以數字實際上是凍結的 —— 一個講「45s 後
   * 自動拒絕」卻不會動的安全提示會誤導人。改成每秒 tick，只是讓顯示誠實，
   * 逾時與自動拒絕的機制完全沒有改變。
   */
  const expiresAt = current?.expiresAt ?? 0
  const [remainSec, setRemainSec] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [freeform, setFreeform] = useState('')

  const requestKey = current?.id
  useEffect(() => {
    setSelected([])
    setFreeform('')
  }, [requestKey])

  useEffect(() => {
    if (!expiresAt) return
    const update = () => setRemainSec(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  // Keep the decision surface singular. A safety intervention has priority;
  // queued tool permission asks remain in their store and appear afterwards.
  if (!current || hasManualIntervention) return null

  const pendingBehind = queue.length
  const sessionAllow = getSessionAllow(current.threadId)

  const isQuestion = current.hitl === true
  const options = current.options ?? []
  const hasOptions = options.length > 0
  const allowFreeform = current.allowFreeform === true
  const freeformText = freeform.trim()

  const sendAnswer = (choice?: string) => {
    const parts: string[] = []
    if (choice) parts.push(choice)
    else if (selected.length) parts.push(selected.join('、'))
    if (allowFreeform && freeformText) parts.push(freeformText)
    resolve(current.id, 'allow', parts.join('\n'))
  }

  const togglePick = (value: string) =>
    setSelected((previous) =>
      previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value],
    )

  // Single-select sends on click; the submit button exists for multi-select
  // picks, freeform-only answers, and the option-less confirm.
  const showSubmit = !(isQuestion && hasOptions && current.multiSelect !== true && !allowFreeform)
  const canSubmit = !isQuestion
    ? true
    : current.multiSelect === true
      ? selected.length > 0 || freeformText.length > 0
      : hasOptions
        ? freeformText.length > 0
        : !allowFreeform || freeformText.length > 0

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md animate-macos-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
        data-run-id={current.runId || undefined}
        className="agent-approval-card w-full max-w-lg overflow-hidden rounded-card border bg-surface animate-macos-sheet"
      >
        <div className="primitive-card-pad flex items-start gap-3 border-b border-line bg-orange-tint">
          <Icon name={isQuestion ? 'question_mark' : 'shield'} size={18} className="mt-0.5 shrink-0 text-orange" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="permission-title" className="font-semibold text-ink text-[14px]">
                {isQuestion ? '回答問題' : '需要核准'}
              </h2>
              <span className="text-[10px] font-medium text-orange">等待你的決定</span>
            </div>
            <p className="text-[13px] text-ink-2 mt-0.5">{current.reason}</p>
            <p className="text-[10px] text-ink-3 mt-1 font-[family-name:var(--font-mono)]">
              逾時 {remainSec}s 自動拒絕
              {pendingBehind > 0 ? ` · 佇列尚有 ${pendingBehind} 筆` : ''}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {isQuestion && current.question ? (
            <p className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-ink">{current.question}</p>
          ) : (
            <>
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-2">工具</div>
                <code className="text-accent-ink font-[family-name:var(--font-mono)] text-[13px]">
                  {current.tool}
                </code>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-2">即將執行的內容</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-inset p-3 text-[11px] text-ink-2 font-[family-name:var(--font-mono)] custom-scrollbar">
                  {current.argsPreview}
                </pre>
              </div>
            </>
          )}

          {isQuestion && hasOptions ? (
            /* 選項列沿用 QuestionAskModal 的語言：選取記號是唯一的狀態訊號，
               選項本身不再各自成一張卡。 */
            <div className="flex flex-col gap-0.5">
              {options.map((option) => {
                const checked = selected.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={current.multiSelect === true ? checked : undefined}
                    onClick={() => (current.multiSelect === true ? togglePick(option) : sendAnswer(option))}
                    className="agent-question-option -mx-1.5 flex items-start gap-2.5 rounded-control px-1.5 py-1.5 text-left transition-colors"
                    data-selected={checked}
                  >
                    <span
                      className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center transition-colors duration-200 ${
                        current.multiSelect === true ? 'rounded-[6px]' : 'rounded-full'
                      } ${
                        checked
                          ? 'bg-ink text-canvas'
                          : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]'
                      }`}
                    >
                      {current.multiSelect === true ? (
                        <Icon name="check" size={13} />
                      ) : (
                        <span
                          className="size-1.5 rounded-full bg-current transition-transform duration-200"
                          style={{ transform: checked ? 'scale(1)' : 'scale(0)' }}
                        />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm transition-colors duration-200 ${checked ? 'text-ink' : 'text-ink-2'}`}>
                        {option}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {isQuestion && allowFreeform ? (
            <textarea
              value={freeform}
              onChange={(event) => setFreeform(event.target.value)}
              placeholder={hasOptions ? '補充說明（可選）' : '你的回答'}
              rows={3}
              className="w-full resize-none rounded-control border border-line bg-inset px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
          ) : null}

          {!isQuestion ? (
            <label className="agent-approval-session flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sessionAllow}
                onChange={(e) => setSessionAllow(e.target.checked, current.threadId)}
                className="accent-primary-container"
              />
              本次 session 其餘 ask 一律允許（代我核准）
            </label>
          ) : null}
        </div>

        <div className="primitive-card-footer flex justify-end gap-2 border-t border-line bg-inset">
          <button
            type="button"
            onClick={() => resolve(current.id, 'deny')}
            className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-hover"
          >
            {isQuestion ? '取消' : '拒絕'}
          </button>
          {!isQuestion || showSubmit ? (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => (isQuestion ? sendAnswer() : resolve(current.id, 'allow'))}
              className="px-3 py-1.5 rounded-control bg-ink text-canvas text-[12px] font-semibold shadow-btn enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-field disabled:text-ink-3 disabled:shadow-none"
            >
              {isQuestion ? '送出回覆' : '核准執行'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
