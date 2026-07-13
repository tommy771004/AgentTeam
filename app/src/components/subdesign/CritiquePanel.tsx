import type { SubDesignCritique } from '../../agent/subdesign/types'
import { Icon } from '../Icon'

const SCORE_FIELDS: Array<{ key: keyof Pick<SubDesignCritique, 'briefCoverage' | 'brandConformance' | 'accessibility' | 'implementationReadiness'>; label: string }> = [
  { key: 'briefCoverage', label: 'Brief coverage' },
  { key: 'brandConformance', label: 'Brand conformance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'implementationReadiness', label: 'Readiness' },
]

export function CritiquePanel({ critique }: { critique: SubDesignCritique | null }) {
  return (
    <section className="rounded-md border border-[#e7e3de] bg-white">
      <div className="flex items-center justify-between border-b border-[#efebe6] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold"><Icon name="fact_check" size={15} className="text-[#c96646]" /> Critique</div>
        {critique ? <span className={`text-[9px] font-semibold ${critique.verdict === 'pass' ? 'text-[#5b8d58]' : 'text-[#b95638]'}`}>{critique.verdict}</span> : null}
      </div>
      {!critique ? <div className="px-3 py-5 text-center text-[10px] text-[#a39b93]">完成 Build 後執行 critique，這裡會顯示四項分數與 findings。</div> : (
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {SCORE_FIELDS.map(({ key, label }) => {
              const score = critique[key]
              return <div key={key}><div className="flex justify-between text-[9px] text-[#817a73]"><span>{label}</span><span className="font-mono">{score}</span></div><div className="mt-1 h-1 rounded-full bg-[#ece8e3]"><div className={`h-1 rounded-full ${score >= 70 ? 'bg-[#6e9465]' : score >= 45 ? 'bg-[#c99a52]' : 'bg-[#c96646]'}`} style={{ width: `${score}%` }} /></div></div>
            })}
          </div>
          {critique.findings.length ? <div className="space-y-1.5 border-t border-[#f0ece7] pt-2">{critique.findings.map((finding, index) => <div key={`${finding.severity}:${index}`} className="flex items-start gap-1.5 text-[10px] text-[#6f6861]"><Icon name={finding.severity === 'blocker' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info'} size={13} className={finding.severity === 'blocker' ? 'text-[#b95638]' : finding.severity === 'warning' ? 'text-[#b98235]' : 'text-[#9b938a]'} /><span className="min-w-0 flex-1">{finding.message}{finding.path ? <span className="ml-1 font-mono text-[9px] text-[#a19a92]">· {finding.path}</span> : null}</span></div>)}</div> : <div className="border-t border-[#f0ece7] pt-2 text-[10px] text-[#5b8d58]">沒有 findings。</div>}
          <div className="text-[9px] text-[#aaa29a]">Critique revision {critique.revision || 1}</div>
        </div>
      )}
    </section>
  )
}

