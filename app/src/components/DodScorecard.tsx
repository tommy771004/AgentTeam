import { Icon } from './Icon'
import type { DodVerdict } from '../agent/types'
import { EXTERNAL_CLI_DOD_LABEL } from '../agent/runners/types'

/**
 * DoD Scorecard（dod-verified-reports 票 07）— run 摘要卡內嵌的驗收計分卡。
 * 三種形態：已驗證完成（最終輪語意驗收通過）／未達成（缺口清單）／
 * 無判定（外部 CLI run 顯示誠實標章；builtin 無判定不渲染）。
 */
export function DodScorecard({
  verdicts,
  runnerKind,
}: {
  verdicts?: DodVerdict[]
  runnerKind?: 'builtin' | 'external'
}) {
  if (runnerKind === 'external' && (!verdicts || verdicts.length === 0)) {
    return (
      <div
        data-testid="dod-scorecard"
        className="border-t border-line bg-amber-500/10 px-3.5 py-2 text-[11px] text-amber-100"
      >
        <Icon name="info" size={13} className="mr-1 inline align-[-2px]" />
        {EXTERNAL_CLI_DOD_LABEL}
      </div>
    )
  }

  if (!verdicts || verdicts.length === 0) return null

  const final = verdicts[verdicts.length - 1]
  const convergence = verdicts.map((v) => v.missing.length)
  const convergenceText = convergence
    .map((n, i) => `第${i + 1}輪剩 ${n}`)
    .join(' → ')

  if (final.met && final.semantic) {
    return (
      <div
        data-testid="dod-scorecard"
        className="border-t border-line bg-primary/10 px-3.5 py-2 text-[11px]"
      >
        <span className="font-semibold text-primary">
          <Icon name="verified" size={13} className="mr-1 inline align-[-2px]" />
          DoD 已驗證完成
        </span>
        <span className="ml-2 text-outline">
          語意驗收通過 · 信心度 {final.confidence.toFixed(2)} · {verdicts.length} 輪
        </span>
        {convergence.length > 1 && (
          <span className="ml-2 text-outline">（收斂：{convergenceText}）</span>
        )}
      </div>
    )
  }

  if (final.met && !final.semantic) {
    return (
      <div
        data-testid="dod-scorecard"
        className="border-t border-line bg-surface-container-low px-3.5 py-2 text-[11px] text-on-surface-variant"
      >
        <span className="font-semibold">執行完畢（未驗證）</span>
        <span className="ml-2 text-outline">最終輪僅啟發式判定，未經語意驗收</span>
      </div>
    )
  }

  return (
    <div
      data-testid="dod-scorecard"
      className="border-t border-line bg-amber-500/10 px-3.5 py-2 text-[11px]"
    >
      <span className="font-semibold text-amber-100">DoD 未達成 · 剩 {final.missing.length} 項缺口</span>
      {convergence.length > 1 && <span className="ml-2 text-outline">（收斂：{convergenceText}）</span>}
      {final.missing.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-outline">
          {final.missing.slice(0, 6).map((gap, i) => (
            <li key={i}>{gap}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
