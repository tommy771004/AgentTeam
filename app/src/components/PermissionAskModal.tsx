import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { DecisionCard } from './DecisionCard'
import { canSubmitDecision, nextSelectedOptions, submitsChoiceImmediately } from './decisionPresentation'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { useAgentStore } from '../store/agentStore'

const DECISION_COPY = {
  question: { title: '回答問題', deny: '取消', primary: '送出回覆' },
  approval: { title: '需要核准', deny: '拒絕', primary: '核准執行' },
} as const

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
  const decisionKind = isQuestion ? 'question' : 'approval'
  const decisionCopy = DECISION_COPY[decisionKind]
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
    setSelected((previous) => nextSelectedOptions(previous, value, current.multiSelect === true))

  // Single-select sends on click; the submit button exists for multi-select
  // picks, freeform-only answers, and the option-less confirm.
  const showSubmit = !(isQuestion && hasOptions && current.multiSelect !== true && !allowFreeform)
  const canSubmit = canSubmitDecision({
    isQuestion,
    hasOptions,
    hasSelection: selected.length > 0,
    allowFreeform,
    hasFreeform: freeformText.length > 0,
  })
  const showPrimary = !isQuestion || showSubmit
  const approveCurrent = () => {
    if (isQuestion) sendAnswer()
    else resolve(current.id, 'allow')
  }

  const meta = `逾時 ${remainSec}s 自動拒絕${pendingBehind > 0 ? ` · 佇列尚有 ${pendingBehind} 筆` : ''}`

  return (
    <DecisionCard
      key={current.id}
      kind={decisionKind}
      titleId="permission-title"
      title={decisionCopy.title}
      reason={current.reason}
      meta={meta}
      runId={current.runId}
      denyLabel={decisionCopy.deny}
      onDeny={() => resolve(current.id, 'deny')}
      approveLabel={showPrimary ? decisionCopy.primary : undefined}
      approveDisabled={!canSubmit}
      onApprove={showPrimary ? approveCurrent : undefined}
    >
      <div className="space-y-3">
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
                  {current.argsJson}
                </pre>
              </div>
            </>
          )}

          {isQuestion && hasOptions ? (
            /* 選取記號是唯一的狀態訊號，選項本身不再各自成一張卡。 */
            <div className="flex flex-col gap-0.5">
              {options.map((option) => {
                const checked = selected.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => (
                      submitsChoiceImmediately({ multiSelect: current.multiSelect === true, allowFreeform })
                        ? sendAnswer(option)
                        : togglePick(option)
                    )}
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
            <label className="block text-[12px] text-ink-2" htmlFor={`${current.id}-freeform`}>
              <span className="mb-1 block">{hasOptions ? '補充說明（可選）' : '你的回答'}</span>
              <textarea
                id={`${current.id}-freeform`}
                value={freeform}
                onChange={(event) => setFreeform(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-control border border-line bg-inset px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
              />
            </label>
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
    </DecisionCard>
  )
}
