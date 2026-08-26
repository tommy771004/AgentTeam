import { memo } from 'react'
import { contextUsageMicrocopy } from '../agent/contextUsageView'
import { useRunContextUsage } from '../hooks/useRunContextUsage'

/**
 * 上下文用量微縮文字的獨立葉元件。
 *
 * 用量的投影（projectContextUsage）只依賴 runId 對應的 recordEntries／
 * recordTotal／設定——把訂閱收進這個 leaf，兄弟區塊就不會因為用量變化而重繪；
 * 反過來，串流中的 draft 讓父層頻繁更新時，這個元件靠 memo 與 props 不變而跳過，
 * 數字維持穩定不跟著閃。
 */
export const ContextUsageChip = memo(function ContextUsageChip({
  runId,
  onClick,
  variant = 'header',
}: {
  runId: string
  /** 提供時渲染成按鈕（打開執行摘要）；否則為純文字。 */
  onClick?: () => void
  /** header：feed 狀態列用；inline：時間軸標頭內嵌，沿用外層色調。 */
  variant?: 'header' | 'inline'
}) {
  const microcopy = contextUsageMicrocopy(useRunContextUsage(runId))
  if (!microcopy) return null
  if (variant === 'inline') {
    return (
      <span className="ml-1 font-[family-name:var(--font-mono)] tabular-nums">{microcopy}</span>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="開啟執行摘要的上下文用量"
        className="shrink-0 font-[family-name:var(--font-mono)] text-[10px] tabular-nums text-ink-3 transition-colors hover:text-ink"
      >
        {microcopy}
      </button>
    )
  }
  return (
    <span className="shrink-0 font-[family-name:var(--font-mono)] text-[10px] tabular-nums text-ink-3">
      {microcopy}
    </span>
  )
})
