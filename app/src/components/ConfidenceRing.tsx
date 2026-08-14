export function ConfidenceRing({
  value,
  size = 120,
  label = '信心度',
}: {
  value: number
  size?: number
  label?: string
}) {
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, value))
  const offset = c * (1 - clamped)

  return (
    <div className="flex flex-col items-center gap-3">
      <span className="font-semibold text-xs tracking-widest text-on-surface-variant uppercase">
        {label}
      </span>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-outline-variant)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-[family-name:var(--font-sora)] text-3xl font-bold text-primary glow-text">
            {clamped.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}
