/**
 * 「Agent Thinking」狀態動畫(BoardUI 語彙):依 run 階段切換變體的載入指示。
 * - wave:3×3 點陣上由左上滑向右下的對角波前(思考中的預設)
 * - spin:同一點陣上順時針繞行的彗星頭(啟動/撰寫回覆的穩定旋轉)
 * - stars:五枚四角閃星交錯明滅(規劃與收尾,讀起來比點陣安靜)
 * - infinity:橫越 8 字軌道的彗尾(長時間執行,沒有起訖點)
 *
 * 顏色取自 currentColor,放進任何狀態列都會沿用該列的文字色。
 * 減少動態時全域 keyframes 凍結(index.css 的 prefers-reduced-motion 區塊),
 * 各變體靜止在可辨識的暗態,仍看得出是進行中。
 */

export type AgentThinkingVariant = 'wave' | 'spin' | 'stars' | 'infinity'

/** 對角波前:延遲随 row+col 遞增,亮帶由左上進入、右下離開。 */
const WAVE_DELAYS = Array.from({ length: 9 }, (_, i) => (Math.floor(i / 3) + (i % 3)) * 90)

/** 順時針軌道:左上起頭,中心點不參與。 */
const SPIN_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const SPIN_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const k = SPIN_ORDER.indexOf(i)
  return k === -1 ? null : k * 110
})

/** 五枚閃星的散布位置、縮放與交錯延遲。 */
const STAR_LAYOUT = [
  { x: 4, y: 10, s: 0.6, delay: 0 },
  { x: 12, y: 3, s: 0.85, delay: 280 },
  { x: 20, y: 9, s: 0.55, delay: 560 },
  { x: 9, y: 17, s: 0.7, delay: 140 },
  { x: 17, y: 16, s: 0.95, delay: 420 },
]

/** 8 字軌道(lemniscate),中心交叉、左右兩圈等長。 */
const INFINITY_PATH =
  'M24 12 C20 5 8 5 8 12 C8 19 20 19 24 12 C28 5 40 5 40 12 C40 19 28 19 24 12'

/** 四角星:path 以原點為中心,靠外層 translate/scale 擺位。 */
const STAR_PATH = 'M0 -6 Q1.6 -1.6 6 0 Q1.6 1.6 0 6 Q-1.6 1.6 -6 0 Q-1.6 -1.6 0 -6 Z'

function DotGrid({ delays, round }: { delays: Array<number | null>; round: boolean }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]`}>
      {delays.map((delay, i) => (
        <span
          key={i}
          className={`size-[4px] bg-current ${round ? 'rounded-full' : 'rounded-[1px]'}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation:
              delay === null ? undefined : `pixel-on 650ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  )
}

function Stars() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 21" className="h-[15px] w-[17px] shrink-0" fill="currentColor">
      {STAR_LAYOUT.map(({ x, y, s, delay }, i) => (
        <path
          key={i}
          d={STAR_PATH}
          transform={`translate(${x} ${y}) scale(${s})`}
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center',
            animation: `star-twinkle 1.3s ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </svg>
  )
}

function InfinityTrack() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 24" className="h-[13px] w-[26px] shrink-0" fill="none">
      <path d={INFINITY_PATH} stroke="currentColor" strokeWidth={2} opacity={0.18} strokeLinecap="round" />
      <path
        d={INFINITY_PATH}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="16 84"
        style={{ animation: 'infinity-comet 1.6s linear infinite' }}
      />
    </svg>
  )
}

export function AgentThinking({
  variant = 'wave',
  className = '',
}: {
  variant?: AgentThinkingVariant
  className?: string
}) {
  return (
    <span role="status" aria-label="執行中" className={`inline-flex shrink-0 items-center ${className}`}>
      {variant === 'stars' ? (
        <Stars />
      ) : variant === 'infinity' ? (
        <InfinityTrack />
      ) : (
        <DotGrid delays={variant === 'spin' ? SPIN_DELAYS : WAVE_DELAYS} round={variant === 'spin'} />
      )}
    </span>
  )
}

