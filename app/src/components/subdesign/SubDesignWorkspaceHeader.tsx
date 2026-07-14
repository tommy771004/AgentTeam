import type { SubDesignWorkspaceViewModel } from '../../agent/subdesign/workspace'
import type { DesignSystemSummary } from '../../agent/subdesign/types'
import { Icon } from '../Icon'

type SubDesignWorkspaceHeaderProps = {
  workspace: SubDesignWorkspaceViewModel
  onPrimaryAction?: () => void
  primaryActionLabel?: string
  designSystem?: DesignSystemSummary | null
  onOpenDesignSystem?: () => void
}

const stageIcons: Record<string, string> = {
  brief: 'edit_note',
  direction: 'palette',
  build: 'auto_awesome',
  critique: 'rate_review',
  deliver: 'rocket_launch',
}

function stageTone(state: SubDesignWorkspaceViewModel['stages'][number]['state']): string {
  if (state === 'completed') return 'border-primary/25 bg-primary/10 text-primary'
  if (state === 'active') return 'border-secondary/45 bg-secondary/10 text-secondary'
  if (state === 'locked') return 'border-white/8 bg-white/[0.02] text-outline/60'
  return 'border-white/10 bg-white/[0.04] text-outline'
}

function critiqueTone(status: SubDesignWorkspaceViewModel['critiqueStatus']): string {
  if (status === 'passed') return 'border-primary/25 bg-primary/[0.06] text-primary'
  if (status === 'running') return 'border-secondary/30 bg-secondary/[0.06] text-secondary'
  if (status === 'needs-revision' || status === 'interrupted' || status === 'failed') return 'border-error/25 bg-error/[0.06] text-error'
  return 'border-white/10 bg-white/[0.03] text-outline'
}

function critiqueLabel(status: SubDesignWorkspaceViewModel['critiqueStatus']): string {
  return {
    'not-started': '尚未開始',
    running: 'Review 正在執行',
    passed: '已通過 · 可交付',
    'needs-revision': '需要修訂',
    interrupted: '已中止',
    failed: '執行失敗',
  }[status]
}

export function SubDesignWorkspaceHeader({ workspace, onPrimaryAction, primaryActionLabel, designSystem, onOpenDesignSystem }: SubDesignWorkspaceHeaderProps) {
  const gate = workspace.nextGate
  const canAct = Boolean(onPrimaryAction) && gate.status === 'ready'
  const runLabel = workspace.runStatus === 'active'
    ? 'LIVE'
    : workspace.runStatus === 'awaiting-user'
      ? 'ACTION NEEDED'
      : workspace.runStatus === 'failed'
        ? 'FAILED'
        : workspace.runStatus === 'halted'
          ? 'HALTED'
          : workspace.currentStage === 'deliver'
            ? 'READY'
            : 'IDLE'
  const runTone = workspace.runStatus === 'active' || workspace.runStatus === 'awaiting-user'
    ? 'border-secondary/35 bg-secondary/10 text-secondary'
    : workspace.runStatus === 'failed' || workspace.runStatus === 'halted'
      ? 'border-error/25 bg-error/10 text-error'
      : 'border-white/10 text-outline'
  return (
    <section className="mx-auto mb-7 max-w-[1120px] overflow-hidden rounded-3xl border border-primary/20 bg-primary/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-primary">SUBDESIGN / PROJECT</p>
          <h1 className="mt-1 truncate text-xl font-semibold text-on-surface">{workspace.objective || '未命名設計'}</h1>
          <p className="mt-1 text-[11px] text-outline">brief {workspace.briefId} · 目前階段 {workspace.currentStage.toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpenDesignSystem} className="inline-flex h-8 max-w-[210px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.025] px-2.5 text-[10px] font-semibold text-outline hover:border-primary/30 hover:text-primary">
            <Icon name="palette" size={13} /><span className="truncate">{designSystem?.title || 'Project default'}</span><Icon name="expand_more" size={13} />
          </button>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${runTone}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${workspace.runStatus === 'active' ? 'animate-pulse bg-secondary' : workspace.runStatus === 'failed' || workspace.runStatus === 'halted' ? 'bg-error' : 'bg-outline/60'}`} />
            {runLabel}
          </span>
          {canAct ? <button type="button" onClick={onPrimaryAction} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-on-primary"><Icon name="arrow_forward" size={14} />{primaryActionLabel || gate.title}</button> : null}
        </div>
      </div>
      <div className="grid gap-2 px-5 py-4 sm:grid-cols-5">
        {workspace.stages.map((stage) => (
          <div key={stage.id} className={`rounded-xl border px-3 py-2.5 ${stageTone(stage.state)}`}>
            <div className="flex items-center gap-2">
              <Icon name={stage.state === 'completed' ? 'check_circle' : stageIcons[stage.id]} size={15} />
              <span className="text-[11px] font-semibold">{stage.label}</span>
            </div>
            <p className="mt-1 text-[10px] opacity-75">{stage.description}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 border-t border-white/10 px-5 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] text-outline">NEXT GATE · {gate.label.toUpperCase()}</p>
          <p className="mt-1 text-[13px] font-semibold text-on-surface">{gate.title}</p>
          {gate.reason ? <p className="mt-1 text-[11px] leading-relaxed text-outline">{gate.reason}</p> : null}
        </div>
        <div className={`rounded-xl border px-3 py-2 text-right ${critiqueTone(workspace.critiqueStatus)}`}><p className="text-[10px] opacity-75">CRITIQUE</p><p className="mt-1 text-[11px] font-semibold">{critiqueLabel(workspace.critiqueStatus)}</p></div>
        {workspace.latestArtifact ? <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-right"><p className="text-[10px] text-outline">LATEST ARTIFACT</p><p className="mt-1 max-w-[230px] truncate text-[11px] font-semibold text-on-surface">{workspace.latestArtifact.title}</p><p className="mt-0.5 text-[10px] text-outline">revision {workspace.latestArtifact.revision}</p></div> : <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-right"><p className="text-[10px] text-outline">OUTPUT</p><p className="mt-1 text-[11px] font-semibold text-on-surface">尚未產生 artifact</p></div>}
      </div>
    </section>
  )
}
