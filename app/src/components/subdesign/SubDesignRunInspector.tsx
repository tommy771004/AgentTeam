import type { SubDesignWorkspaceViewModel } from '../../agent/subdesign/workspace'
import { RunProcessFeed } from '../RunProcessFeed'
import { Icon } from '../Icon'

type SubDesignRunInspectorProps = {
  workspace: SubDesignWorkspaceViewModel
  runId: string
  executionKind?: 'loop' | 'external'
  onOpenTranscript: () => void
}

export function SubDesignRunInspector({ workspace, runId, executionKind, onOpenTranscript }: SubDesignRunInspectorProps) {
  const waitingForUser = workspace.runStatus === 'awaiting-user'
  return (
    <section className="mx-auto mb-7 max-w-[1120px] overflow-hidden rounded-2xl border border-secondary/25 bg-secondary/[0.04]" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3 border-b border-secondary/15 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center text-secondary"><Icon name={waitingForUser ? 'front_hand' : 'progress_activity'} size={17} className={waitingForUser ? '' : 'animate-spin'} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-on-surface">{waitingForUser ? 'Build 等待你的決定' : 'Build 正在執行'}</p>
          <p className="truncate text-[11px] text-outline">{executionKind === 'external' ? '外部 CLI 執行中；不會宣稱內建 DoD 已完成。' : `完成後將進入 ${workspace.nextGate.label} gate。`}</p>
        </div>
        <span className="rounded-full border border-secondary/25 px-2 py-1 text-[10px] font-semibold text-secondary">{waitingForUser ? 'ACTION NEEDED' : 'LIVE'}</span>
      </div>
      <div className="px-4 pb-3">
        <RunProcessFeed runId={runId} depthLabel="SubDesign Build" onOpenPanel={onOpenTranscript} />
      </div>
    </section>
  )
}
