import { Icon } from './Icon'
import { usePermissionAskStore } from '../store/permissionAskStore'

/**
 * OpenCode-style ask permission HITL
 */
export function PermissionAskModal() {
  const current = usePermissionAskStore((s) => s.current)
  const queue = usePermissionAskStore((s) => s.queue)
  const resolve = usePermissionAskStore((s) => s.resolve)
  const getSessionAllow = usePermissionAskStore((s) => s.getSessionAllow)
  const setSessionAllow = usePermissionAskStore((s) => s.setSessionAllow)

  if (!current) return null

  const pendingBehind = queue.length
  const remainSec = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000))
  const sessionAllow = getSessionAllow(current.threadId)

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-xl flex items-center justify-center p-4 animate-macos-fade">
      <div className="w-full max-w-lg rounded-[20px] liquid-glass border border-amber-500/25 shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden animate-macos-sheet">
        <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3 bg-amber-500/10">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Icon name="shield" size={22} className="text-amber-300" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-amber-100 text-base">需要核准</h2>
            <p className="text-sm text-on-surface-variant mt-0.5">{current.reason}</p>
            <p className="text-[11px] text-outline mt-1 font-[family-name:var(--font-mono)]">
              逾時 {remainSec}s 自動拒絕
              {pendingBehind > 0 ? ` · 佇列尚有 ${pendingBehind} 筆` : ''}
              {current.threadId ? ` · thread=${current.threadId.slice(0, 18)}` : ''}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-outline font-semibold mb-1">
              工具
            </div>
            <code className="text-primary font-[family-name:var(--font-mono)] text-sm">
              {current.tool}
            </code>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-outline font-semibold mb-1">
              參數
            </div>
            <pre className="bg-[#060e20] border border-white/10 rounded-xl p-3 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant max-h-48 overflow-auto custom-scrollbar whitespace-pre-wrap">
              {current.argsPreview}
            </pre>
          </div>
          <label className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={sessionAllow}
              onChange={(e) => setSessionAllow(e.target.checked, current.threadId)}
              className="accent-primary-container"
            />
            本次 session 其餘 ask 一律允許（代我核准）
          </label>
        </div>

        <div className="px-5 py-4 border-t border-white/10 flex justify-end gap-2 bg-surface/40">
          <button
            type="button"
            onClick={() => resolve('deny')}
            className="px-4 py-2 rounded-xl border border-white/15 text-sm font-semibold text-on-surface-variant hover:bg-white/5"
          >
            拒絕
          </button>
          <button
            type="button"
            onClick={() => resolve('allow')}
            className="px-4 py-2 rounded-xl bg-primary-container text-on-primary-container text-sm font-semibold hover:brightness-110"
          >
            核准執行
          </button>
        </div>
      </div>
    </div>
  )
}
