import type { SubDesignArtifact } from '../../agent/subdesign/types'
import { Icon } from '../Icon'

export function ArtifactRail({
  artifacts,
  selectedKey,
  onSelect,
}: {
  artifacts: SubDesignArtifact[]
  selectedKey: string | null
  onSelect: (artifact: SubDesignArtifact) => void
}) {
  return (
    <section className="app-panel">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><Icon name="note_stack" size={16} className="text-primary" /> Artifacts</div>
        <span className="text-[11px] text-outline">{artifacts.length} revisions</span>
      </div>
      {artifacts.length ? (
        <div className="space-y-1.5 p-2.5">
          {artifacts.map((artifact) => (
            <button
              key={`${artifact.id}:${artifact.revision}`}
              type="button"
              onClick={() => onSelect(artifact)}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors ${selectedKey === `${artifact.id}:${artifact.revision}` ? 'bg-primary/12 text-primary' : 'text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface'}`}
            >
              <Icon name={artifact.renderer === 'html' || artifact.renderer === 'deck-html' ? 'web' : 'description'} size={15} className="shrink-0" />
              <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">{artifact.title}</span><span className="mt-1 block truncate text-[11px] text-outline">{artifact.entry} · r{artifact.revision}</span></span>
              <span className={`shrink-0 text-[11px] ${artifact.status === 'complete' ? 'text-primary' : artifact.status === 'error' ? 'text-error' : 'text-outline'}`}>{artifact.status}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-7 text-center text-[12px] leading-relaxed text-outline">Agent 登記 artifact manifest 後，preview 與 revision 會出現在這裡。</div>
      )}
    </section>
  )
}
