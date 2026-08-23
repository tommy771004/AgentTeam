/**
 * 「Composer Loader」狀態特效(BoardUI 語彙):一道彩虹光帶以等速繞行
 * 輸入框的邊框,前端是一條清晰折射線、後方帶著向內暈開的柔光。
 * active 切換時整個效果淡入淡出,輸入框看起來是「被點亮」而非切換狀態。
 *
 * 放在輸入框根元素(relative + 圓角)內側即可,border-radius 沿用父層。
 * 顏色取自主題 tokens(accent / primary / tertiary);減少動態時由全域
 * prefers-reduced-motion 凍結掃描,僅保留淡入淡出。
 */
export function ComposerLoader({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`composer-loader-overlay${active ? ' composer-loader-on' : ''}`}
    >
      <span className="composer-loader-band composer-loader-bloom" />
      <span className="composer-loader-band composer-loader-ring" />
    </div>
  )
}
