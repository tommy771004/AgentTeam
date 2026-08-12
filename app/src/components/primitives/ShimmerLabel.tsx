import type { ReactNode } from 'react'

/**
 * docs/ui「Thinking」/「Loading State」共用的狀態文字：進行中時一道亮帶掃過標籤，
 * 結束後淡入成安靜的完成句（「思考了 4 秒」），不再閃動。
 */
export function ShimmerLabel({
  active,
  children,
  className = '',
}: {
  active: boolean
  children: ReactNode
  className?: string
}) {
  if (active) {
    return <span className={`agent-shimmer ${className}`}>{children}</span>
  }
  return (
    <span className={className} style={{ animation: 'fade-in 350ms ease-out both' }}>
      {children}
    </span>
  )
}
