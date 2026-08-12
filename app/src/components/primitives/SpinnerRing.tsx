import type { ReactNode } from 'react'

/**
 * docs/ui「Task Rows」的步驟標記：序號留在圓心，進行中時外圈補一段旋轉的弧。
 * 待辦與進行中因此是同一個形狀、只差一段弧，序號不會在狀態切換時跳位。
 */
export function SpinnerRing({
  active = false,
  tone = 'idle',
  size = 24,
  children,
}: {
  active?: boolean
  tone?: 'idle' | 'active' | 'muted'
  size?: number
  children?: ReactNode
}) {
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const arc = tone === 'muted' ? 'var(--color-outline)' : 'var(--color-primary)'

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* animate-spin (not a hand-rolled keyframe) so the shared Tailwind
          rotation stays the single definition of "this is turning". */}
      <svg
        width={size}
        height={size}
        className={`absolute inset-0 ${active ? 'animate-spin' : ''}`}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-outline-variant)"
          strokeWidth={stroke}
        />
        {active ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arc}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.28} ${circumference * 0.72}`}
          />
        ) : null}
      </svg>
      <span
        className={`relative text-[10.5px] font-semibold tabular-nums ${
          tone === 'idle' ? 'text-outline' : 'text-on-surface'
        }`}
      >
        {children}
      </span>
    </span>
  )
}
