import type { SubDesignCritique } from '../../agent/subdesign/types'
import { gateProvenanceFor } from '../../agent/subdesign/critiqueProvenance.ts'
import { Icon } from '../Icon'

const SCORE_FIELDS: Array<{ key: keyof Pick<SubDesignCritique, 'briefCoverage' | 'brandConformance' | 'accessibility' | 'implementationReadiness'>; label: string }> = [
  { key: 'briefCoverage', label: 'Brief coverage' },
  { key: 'brandConformance', label: 'Brand conformance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'implementationReadiness', label: 'Readiness' },
]

export function CritiquePanel({ critique }: { critique: SubDesignCritique | null }) {
  return (
    <section className="app-panel">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="fact_check" size={16} className="text-primary" /> Critique</div>
        {critique ? <span className={`text-[11px] font-semibold ${critique.verdict === 'pass' ? 'text-primary' : 'text-error'}`}>{critique.verdict}</span> : null}
      </div>
      {!critique ? <div className="px-4 py-7 text-center text-[12px] leading-relaxed text-outline">完成 Build 後執行 critique，這裡會顯示四項分數、evidence 與 findings。</div> : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {SCORE_FIELDS.map(({ key, label }) => {
              const score = critique[key]
              const provenance = gateProvenanceFor(critique, key)
              return (
                <div key={key}>
                  <div className="flex justify-between text-[11px] text-outline"><span>{label}</span><span className="font-mono text-on-surface">{score}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.08]"><div className={`h-1.5 rounded-full ${score >= 70 ? 'bg-primary' : score >= 45 ? 'bg-secondary' : 'bg-error'}`} style={{ width: `${score}%` }} /></div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                    {provenance.length ? provenance.map((gate) => (
                      <details key={gate.gateId} className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-primary">
                        <summary className="cursor-pointer list-none font-mono">
                          <span className="inline-flex items-center gap-0.5"><Icon name="verified" size={10} />{gate.gateId}</span>
                        </summary>
                        <dl className="mt-1 grid gap-0.5 border-t border-primary/15 pt-1 font-sans text-[9px] leading-4 text-on-surface-variant">
                          <div><dt className="inline text-outline">量測：</dt><dd className="inline">{gate.summary}</dd></div>
                          <div><dt className="inline text-outline">時間：</dt><dd className="inline font-mono">{gate.capturedAt || '未提供'}</dd></div>
                          {gate.path ? <div><dt className="inline text-outline">證據：</dt><dd className="inline break-all font-mono">{gate.path}</dd></div> : null}
                          {gate.sha256 ? <div><dt className="inline text-outline">SHA-256：</dt><dd className="inline font-mono">{gate.sha256.slice(0, 12)}…</dd></div> : null}
                        </dl>
                      </details>
                    )) : (
                      <span className="text-outline">not verified — 尚無對應的 gate 量測</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-white/[0.08] pt-3"><div className="mb-2 text-[11px] font-semibold text-on-surface">Evidence</div><div className="flex flex-wrap gap-1.5">{critique.evidence?.length ? critique.evidence.map((item, index) => <span key={`${item.kind}:${index}`} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] text-primary">{item.kind}</span>) : <span className="text-[11px] text-error">尚未提供 screenshot / DOM / lint evidence</span>}</div></div>
          {critique.findings.length ? <div className="space-y-2 border-t border-white/[0.08] pt-3">{critique.findings.map((finding, index) => <div key={`${finding.severity}:${index}`} className="flex items-start gap-2 text-[12px] text-on-surface-variant"><Icon name={finding.severity === 'blocker' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info'} size={14} className={finding.severity === 'blocker' ? 'text-error' : finding.severity === 'warning' ? 'text-secondary' : 'text-outline'} /><span className="min-w-0 flex-1">{finding.message}{finding.path ? <span className="ml-1 font-mono text-[11px] text-outline">· {finding.path}</span> : null}</span></div>)}</div> : <div className="border-t border-white/[0.08] pt-3 text-[12px] text-primary">沒有 findings。</div>}
          <div className="text-[11px] text-outline">Critique revision {critique.revision || 1}</div>
        </div>
      )}
    </section>
  )
}
