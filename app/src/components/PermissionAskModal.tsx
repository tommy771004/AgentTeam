import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { useAgentStore } from '../store/agentStore'

/**
 * OpenCode-style ask permission HITL
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
          <Icon name="shield" size={18} className="mt-0.5 shrink-0 text-orange" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="permission-title" className="font-semibold text-ink text-[14px]">需要核准</h2>
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
          <label className="agent-approval-session flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sessionAllow}
              onChange={(e) => setSessionAllow(e.target.checked, current.threadId)}
              className="accent-primary-container"
            />
            本次 session 其餘 ask 一律允許（代我核准）
          </label>
        </div>

        <div className="primitive-card-footer flex justify-end gap-2 border-t border-line bg-inset">
          <button
            type="button"
            onClick={() => resolve(current.id, 'deny')}
            className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-hover"
          >
            拒絕
          </button>
          <button
            type="button"
            onClick={() => resolve(current.id, 'allow')}
            className="px-3 py-1.5 rounded-control bg-ink text-canvas text-[12px] font-semibold shadow-btn hover:brightness-110"
          >
            核准執行
          </button>
        </div>
      </div>
    </div>
  )
}
