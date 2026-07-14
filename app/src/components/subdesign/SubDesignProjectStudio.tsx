import { useState } from 'react'
import type { DesignSystemSummary, SubDesignArtifact, SubDesignBrief, SubDesignCritique } from '../../agent/subdesign/types'
import type { SubDesignWorkspaceViewModel } from '../../agent/subdesign/workspace'
import { RunProcessFeed } from '../RunProcessFeed'
import { Icon } from '../Icon'
import { ArtifactDeliveryPanel } from './ArtifactDeliveryPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactRail } from './ArtifactRail'
import { CritiquePanel } from './CritiquePanel'
import { CritiqueTheater } from './CritiqueTheater'
import { ReferenceImportPanel } from './ReferenceImportPanel'

type StudioTab = 'files' | 'critique' | 'deliver'

type SubDesignProjectStudioProps = {
  brief: SubDesignBrief
  workspace: SubDesignWorkspaceViewModel
  designSystem: DesignSystemSummary | null
  artifacts: SubDesignArtifact[]
  selectedArtifact: SubDesignArtifact | null
  critique: SubDesignCritique | null
  critiquePassed: boolean
  runIsLive: boolean
  runId: string | null
  executionKind?: 'loop' | 'external'
  startingRun: boolean
  onBack: () => void
  onOpenDesignSystems: () => void
  onStartRun: () => void
  onOpenTranscript: () => void
  onSelectArtifact: (artifact: SubDesignArtifact) => void
  onSelectDirection: (directionId: string) => void
}

function statusTone(state: SubDesignWorkspaceViewModel['stages'][number]['state']): string {
  if (state === 'completed') return 'bg-primary text-on-primary'
  if (state === 'active') return 'border-secondary bg-secondary/15 text-secondary'
  if (state === 'pending') return 'border-white/15 bg-white/[0.04] text-outline'
  return 'border-white/8 bg-transparent text-outline/45'
}

export function SubDesignProjectStudio({
  brief,
  workspace,
  designSystem,
  artifacts,
  selectedArtifact,
  critique,
  critiquePassed,
  runIsLive,
  runId,
  executionKind,
  startingRun,
  onBack,
  onOpenDesignSystems,
  onStartRun,
  onOpenTranscript,
  onSelectArtifact,
  onSelectDirection,
}: SubDesignProjectStudioProps) {
  const [tab, setTab] = useState<StudioTab>('files')
  const [previewMode, setPreviewMode] = useState<'preview' | 'source'>('preview')
  const canStart = workspace.nextGate.action === 'start-build' && !runIsLive

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-on-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-outline hover:bg-white/[0.05] hover:text-on-surface" aria-label="回到 SubDesign Home"><Icon name="arrow_back" size={17} /></button>
          <div className="min-w-0"><p className="truncate text-[12px] font-semibold text-on-surface">{brief.objective}</p><p className="mt-0.5 text-[9px] text-outline">Project Studio · {brief.surface} · {brief.platform || 'responsive'}</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onOpenDesignSystems} className="inline-flex h-8 max-w-[210px] items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[10px] font-semibold text-outline hover:border-primary/30 hover:text-primary"><Icon name="palette" size={13} /><span className="truncate">{designSystem?.title || 'Project default'}</span><Icon name="expand_more" size={13} /></button>
          <span className={`hidden rounded-full border px-2 py-1 text-[9px] font-semibold sm:inline ${runIsLive ? 'border-secondary/30 bg-secondary/10 text-secondary' : critiquePassed ? 'border-primary/25 bg-primary/10 text-primary' : 'border-white/10 text-outline'}`}>{runIsLive ? 'AGENT RUNNING' : critiquePassed ? 'READY TO DELIVER' : workspace.currentStage.toUpperCase()}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-white/10 bg-surface-container-low/30 lg:border-b-0 lg:border-r">
          <div className="border-b border-white/8 px-4 py-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-outline">Design journey</p>
            <div className="mt-3 flex items-center gap-1.5">
              {workspace.stages.map((stage, index) => <div key={stage.id} className="flex min-w-0 flex-1 items-center"><span title={`${stage.label} · ${stage.description}`} className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[9px] font-semibold ${statusTone(stage.state)}`}>{stage.state === 'completed' ? <Icon name="check" size={11} /> : index + 1}</span>{index < workspace.stages.length - 1 ? <span className={`h-px min-w-0 flex-1 ${stage.state === 'completed' ? 'bg-primary/50' : 'bg-white/10'}`} /> : null}</div>)}
            </div>
            <div className="mt-3 flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold text-on-surface">{workspace.nextGate.title}</p>{workspace.nextGate.reason ? <p className="mt-1 text-[9px] leading-relaxed text-outline">{workspace.nextGate.reason}</p> : null}</div><span className="rounded-full border border-white/10 px-2 py-1 text-[8px] uppercase text-outline">{workspace.nextGate.label}</span></div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3 custom-scrollbar">
            <section className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-outline">Direction</p>{brief.selectedDirectionId ? <span className="inline-flex items-center gap-1 text-[8px] font-semibold text-primary"><Icon name="lock" size={10} />LOCKED</span> : null}</div>
              {brief.directions.length ? <div className="mt-2 space-y-1.5">{brief.directions.map((direction) => {
                const selected = direction.id === brief.selectedDirectionId
                return <button key={direction.id} type="button" onClick={() => onSelectDirection(direction.id)} className={`w-full rounded-lg border px-2.5 py-2 text-left ${selected ? 'border-primary/35 bg-primary/[0.08]' : 'border-white/8 hover:border-primary/25 hover:bg-white/[0.03]'}`}><span className={`block text-[10px] font-semibold ${selected ? 'text-primary' : 'text-on-surface'}`}>{direction.title}</span><span className="mt-1 line-clamp-2 block text-[9px] leading-relaxed text-outline">{direction.summary}</span></button>
              })}</div> : <p className="mt-2 text-[9px] leading-relaxed text-outline">執行 Agent 或匯入 reference，產生最多三個方向後在此鎖定。</p>}
            </section>

            {runIsLive && runId ? <section className="mt-3 overflow-hidden rounded-xl border border-secondary/25 bg-secondary/[0.04]"><div className="flex items-center gap-2 border-b border-secondary/15 px-3 py-2"><Icon name="progress_activity" size={13} className="animate-spin text-secondary" /><span className="text-[10px] font-semibold text-on-surface">Agent 正在執行</span><span className="ml-auto text-[8px] text-secondary">{executionKind === 'external' ? 'CLI' : 'LIVE'}</span></div><div className="px-3 pb-2"><RunProcessFeed runId={runId} depthLabel="SubDesign Studio" onOpenPanel={onOpenTranscript} /></div></section> : (
              <section className="mt-3 rounded-xl border border-white/8 p-3"><div className="flex items-center gap-2"><Icon name="smart_toy" size={14} className="text-primary" /><p className="text-[10px] font-semibold text-on-surface">Design Agent</p></div><p className="mt-2 text-[9px] leading-relaxed text-outline">Agent 會讀取 brief、Skill、Design System 與已選方向；所有 artifact 都必須登記 manifest，才能進入 Preview 與 Critique。</p></section>
            )}

            <div className="mt-3"><ReferenceImportPanel brief={brief} /></div>
          </div>

          <div className="border-t border-white/8 p-3">
            <button type="button" onClick={canStart ? onStartRun : workspace.nextGate.action === 'inspect' ? onOpenTranscript : undefined} disabled={!canStart && workspace.nextGate.action !== 'inspect'} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-[10px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-40"><Icon name={runIsLive ? 'visibility' : 'arrow_upward'} size={14} />{startingRun ? 'Starting…' : runIsLive ? 'Open agent transcript' : canStart ? 'Start / continue Agent' : workspace.nextGate.title}</button>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
            <div className="flex h-full items-center gap-1">
              {([['files', 'Design Files'], ['critique', 'Critique'], ['deliver', 'Deliver']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`h-full border-b-2 px-3 text-[10px] font-semibold ${tab === id ? 'border-primary text-on-surface' : 'border-transparent text-outline hover:text-on-surface'}`}>{label}</button>)}
            </div>
            {tab === 'files' ? <div className="inline-flex rounded-lg border border-white/10 p-0.5"><button type="button" onClick={() => setPreviewMode('preview')} className={`rounded-md px-2 py-1 text-[9px] font-semibold ${previewMode === 'preview' ? 'bg-white/[0.08] text-on-surface' : 'text-outline'}`}>Preview</button><button type="button" onClick={() => setPreviewMode('source')} className={`rounded-md px-2 py-1 text-[9px] font-semibold ${previewMode === 'source' ? 'bg-white/[0.08] text-on-surface' : 'text-outline'}`}>Code</button></div> : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4 custom-scrollbar">
            {tab === 'files' ? <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]"><ArtifactRail artifacts={artifacts} selectedKey={selectedArtifact ? `${selectedArtifact.id}:${selectedArtifact.revision}` : null} onSelect={onSelectArtifact} /><ArtifactPreview artifact={selectedArtifact} mode={previewMode} /></div> : null}
            {tab === 'critique' ? <div className="space-y-4"><CritiqueTheater brief={brief} artifact={selectedArtifact} critique={critique} /><CritiquePanel critique={critique} /></div> : null}
            {tab === 'deliver' ? <ArtifactDeliveryPanel artifact={selectedArtifact} critique={critique} critiquePassed={critiquePassed} /> : null}
          </div>
        </main>
      </div>
    </div>
  )
}
