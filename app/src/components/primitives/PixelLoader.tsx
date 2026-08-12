/**
 * docs/ui「Loading State」的像素格載入指示：3×3 網格，一道楔形波前往右推。
 * 週期比整趟掃描短，所以畫面上永遠同時有兩道波前，長時間執行也不會看起來卡住。
 *
 * 顏色取自 currentColor，放進任何狀態列都會沿用該列的文字色。
 * 減少動態時整格靜止在暗態（keyframes 已被全域凍結），仍看得出是進行中。
 */

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3)
  const col = i % 3
  return (col + Math.abs(row - 1)) * 90
})

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const ORBIT = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i)
  return k === -1 ? null : k * 110
})

const PATTERNS: Record<string, { delays: (number | null)[]; durationMs: number; round: boolean }> = {
  drive: { delays: CHEVRON, durationMs: 650, round: false },
  dots: { delays: CHEVRON, durationMs: 650, round: true },
  orbit: { delays: ORBIT, durationMs: 950, round: false },
}

export function PixelLoader({
  variant = 'drive',
  className = '',
}: {
  variant?: 'drive' | 'dots' | 'orbit'
  className?: string
}) {
  const { delays, durationMs, round } = PATTERNS[variant] ?? PATTERNS.drive
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] ${className}`}
    >
      {delays.map((delay, i) => (
        <span
          key={i}
          className={`size-[4px] bg-current ${round ? 'rounded-full' : 'rounded-[1px]'}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation:
              delay === null ? undefined : `pixel-on ${durationMs}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  )
}
