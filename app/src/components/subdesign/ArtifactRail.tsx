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
    <section className="rounded-md border border-[#e7e3de] bg-white">
      <div className="flex items-center justify-between border-b border-[#efebe6] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#322f2b]"><Icon name="note_stack" size={15} className="text-[#c96646]" /> Artifacts</div>
        <span className="text-[9px] text-[#a19a92]">{artifacts.length} revisions</span>
      </div>
      {artifacts.length ? (
        <div className="space-y-1 p-2">
          {artifacts.map((artifact) => (
            <button
              key={`${artifact.id}:${artifact.revision}`}
              type="button"
              onClick={() => onSelect(artifact)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${selectedKey === `${artifact.id}:${artifact.revision}` ? 'bg-[#fff5ef] text-[#8d422b]' : 'hover:bg-[#faf8f5]'}`}
            >
              <Icon name={artifact.renderer === 'html' || artifact.renderer === 'deck-html' ? 'web' : 'description'} size={15} className="shrink-0" />
              <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium">{artifact.title}</span><span className="mt-0.5 block truncate text-[9px] text-[#a19a92]">{artifact.entry} · r{artifact.revision}</span></span>
              <span className={`shrink-0 text-[9px] ${artifact.status === 'complete' ? 'text-[#6e9465]' : artifact.status === 'error' ? 'text-[#b95638]' : 'text-[#a19a92]'}`}>{artifact.status}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-5 text-center text-[10px] text-[#a39b93]">Agent 登記 artifact manifest 後，preview 與 revision 會出現在這裡。</div>
      )}
    </section>
  )
}
