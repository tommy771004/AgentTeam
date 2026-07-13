import { useEffect, useMemo, useState } from 'react'
import { runTask } from '../../agent/runExternal'
import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique, SubDesignCritiqueRound } from '../../agent/subdesign/types'
import { Icon } from '../Icon'
import { useAgentStore } from '../../store/agentStore'
import { useProjectStore } from '../../store/projectStore'
import { useRunActivityStore } from '../../store/runActivityStore'
import { useSubDesignCritiqueStore } from '../../store/subDesignCritiqueStore'
import { useSubDesignCritiqueSessionStore } from '../../store/subDesignCritiqueSessionStore'

function roundTone(round: SubDesignCritiqueRound): string {
  if (round.status === 'complete') return 'border-primary/20 bg-primary/[0.05]'
  if (round.status === 'active') return 'border-secondary/25 bg-secondary/[0.06]'
  if (round.status === 'interrupted') return 'border-error/20 bg-error/[0.05]'
  return 'border-white/8 bg-white/[0.02]'
}

function panelistTone(status: string): string {
  if (status === 'complete') return 'text-primary'
  if (status === 'active') return 'text-secondary'
  if (status === 'interrupted') return 'text-error'
  return 'text-outline'
}

function statusLabel(status: string): string {
  if (status === 'complete') return '完成'
  if (status === 'active') return '即時審查'
  if (status === 'interrupted') return '已中止'
  return '等待'
}

function buildCritiqueObjective(brief: SubDesignBrief, artifact: SubDesignArtifact): string {
  return [
    `請執行 SubDesign Critique Theater，針對 brief ${brief.id} 的 artifact ${artifact.id} revision ${artifact.revision} 做 evidence-based review。`,
    `Brief objective：${brief.objective}`,
    `Artifact entry：${artifact.entry}；renderer=${artifact.renderer}；kind=${artifact.kind}。`,
    '這是一個 read-only review：不可修改 DESIGN.md、不可 patch/tweak/export，也不可寫入 workspace。',
    '請依序完成兩輪、三個 panelist focus：視覺與品牌（brief coverage / brand conformance）、可及性審查（accessibility / screenshot / DOM）、實作就緒（lint / implementation readiness）。',
    '每輪都先使用 design_artifact_capture 取得 screenshot 與 DOM，再使用 design_artifact_lint；最後只用 design_critique 寫入一份結構化 critique，包含四項 0–100 分數、evidence、findings 與 verdict。',
    '若 evidence 或 blocker 不足，請明確回報 needs-revision，不得猜測 pass。',
  ].join('\n')
}

export function CritiqueTheater({
  brief,
  artifact,
  critique,
}: {
  brief: SubDesignBrief | null
  artifact: SubDesignArtifact | null
  critique: SubDesignCritique | null
}) {
  const projectRoot = useProjectStore((state) => state.root)
  const isRunning = useAgentStore((state) => state.isRunning)
  const stopExecution = useAgentStore((state) => state.stopExecution)
  const activity = useRunActivityStore((state) => state)
  const session = useSubDesignCritiqueSessionStore((state) => state.current)
  const startSession = useSubDesignCritiqueSessionStore((state) => state.start)
  const advancePreview = useSubDesignCritiqueSessionStore((state) => state.advancePreview)
  const finishSession = useSubDesignCritiqueSessionStore((state) => state.finish)
  const interruptSession = useSubDesignCritiqueSessionStore((state) => state.interrupt)
  const failSession = useSubDesignCritiqueSessionStore((state) => state.fail)
  const latestForArtifact = useSubDesignCritiqueStore((state) => state.latestForArtifact)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const latestActivity = useMemo(() => {
    const event = activity.events[activity.events.length - 1]
    return activity.statusLine || event?.title || event?.detail || ''
  }, [activity.events, activity.statusLine])
  const sessionStatus = session?.status

  useEffect(() => {
    if (sessionStatus !== 'running') return undefined
    const timer = window.setInterval(() => advancePreview(latestActivity), 900)
    return () => window.clearInterval(timer)
  }, [advancePreview, latestActivity, sessionStatus])

  const runCritique = async () => {
    if (!brief || !artifact || busy || isRunning) return
    setBusy(true)
    setMessage('正在啟動 evidence capture…')
    const baselineRevision = latestForArtifact(artifact.id, artifact.revision)?.revision || 0
    startSession({ briefId: brief.id, artifactId: artifact.id, artifactRevision: artifact.revision })
    try {
      const result = await runTask({
        objective: buildCritiqueObjective(brief, artifact),
        sourceKind: 'composer',
        reuseThreadId: brief.threadId,
        runner: 'builtin',
        loopType: 'Goal-based',
        projectRoot: projectRoot || undefined,
        overrides: {
          agentMode: 'plan',
          maxIterations: 3,
          maxToolRounds: 18,
          blockedTools: [
            'bash',
            'workspace_write',
            'workspace_mkdir',
            'workspace_move',
            'workspace_delete',
            'design_system_create',
            'design_system_update',
            'design_artifact_register',
            'design_artifact_patch',
            'design_artifact_tweak',
            'design_artifact_export',
          ],
          extraSystemContext: 'Critique Theater is an evidence-only review. Keep all workspace mutation and export tools blocked.',
        },
      })
      if (result.queued || result.skipped) {
        failSession(result.error || '目前已有執行中的任務，critique 未啟動。')
        setMessage(result.error || 'Critique 未啟動。')
        return
      }
      if (useSubDesignCritiqueSessionStore.getState().current?.status !== 'running') return
      const nextCritique = latestForArtifact(artifact.id, artifact.revision)
      if (!nextCritique || (nextCritique.revision || 0) <= baselineRevision) {
        failSession('Agent run 完成，但沒有寫入新的 evidence-based critique。')
        setMessage('Agent run 完成，但沒有寫入新的 evidence-based critique。')
        return
      }
      finishSession(nextCritique)
      setMessage(nextCritique ? `Critique 完成 · ${nextCritique.verdict}` : 'Agent run 完成，但沒有可驗證 critique。')
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failSession(`Critique 失敗：${detail}`)
      setMessage(`Critique 失敗：${detail}`)
    } finally {
      setBusy(false)
    }
  }

  const interrupt = () => {
    stopExecution()
    interruptSession('使用者中止 Critique Theater')
    setBusy(false)
    setMessage('Critique 已中止；尚未完成的 round 不會進入 Deliver gate。')
  }

  const sessionRunning = session?.status === 'running'
  const currentScore = session?.compositeScore ?? (critique
    ? Math.round((critique.briefCoverage + critique.brandConformance + critique.accessibility + critique.implementationReadiness) / 4)
    : null)

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/20 bg-surface-container-low/55 shadow-[0_12px_35px_rgba(0,0,0,0.14)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${sessionRunning ? 'bg-secondary/15 text-secondary' : 'bg-primary/12 text-primary'}`}>
            <Icon name={sessionRunning ? 'radar' : 'fact_check'} size={19} className={sessionRunning ? 'motion-safe:animate-pulse' : ''} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-on-surface">Critique Theater</h3>
              <span className="rounded-full border border-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">2 rounds · 3 panelists</span>
            </div>
            <p className="mt-1 text-[11px] text-outline">即時 evidence review · 只讀 · threshold {session?.threshold || 70}</p>
          </div>
        </div>
        {sessionRunning ? (
          <button type="button" onClick={interrupt} className="inline-flex items-center gap-1.5 rounded-lg border border-error/30 px-3 py-1.5 text-[11px] font-semibold text-error hover:bg-error/10 focus:outline-none focus:ring-2 focus:ring-error/35">
            <Icon name="stop_circle" size={14} />中止 review
          </button>
        ) : (
          <button type="button" onClick={() => void runCritique()} disabled={!artifact || !brief || busy || isRunning} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-45">
            <Icon name="play_arrow" size={14} />{busy ? '啟動中…' : session?.status === 'completed' ? '重新執行 review' : '開始多輪 review'}
          </button>
        )}
      </div>

      {!artifact || !brief ? (
        <div className="px-4 py-6 text-center text-[12px] text-outline">選擇一個 artifact 後，才能啟動 Critique Theater。</div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-[11px] text-outline"><span>目前焦點</span><span className="font-mono text-on-surface">{session ? `${Math.min(session.previewStep, 6)}/6 panelists` : '尚未啟動'}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${session ? Math.min(100, (session.previewStep / 6) * 100) : 0}%` }} /></div>
              <p className="mt-2 truncate text-[11px] text-on-surface-variant">{latestActivity || message || '先建立 screenshot / DOM / lint evidence，再進行交叉核對。'}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-black/10 px-4 py-2.5 text-right">
              <div className="text-[10px] uppercase tracking-[0.14em] text-outline">Composite</div>
              <div className="mt-0.5 text-[25px] font-semibold tracking-tight text-on-surface">{currentScore == null ? '—' : currentScore}<span className="ml-1 text-[11px] font-normal text-outline">/100</span></div>
              <div className={`text-[10px] font-semibold ${currentScore != null && currentScore >= (session?.threshold || 70) ? 'text-primary' : 'text-outline'}`}>{session?.status === 'completed' ? (critique?.verdict || 'needs-revision') : `目標 ≥ ${session?.threshold || 70}`}</div>
            </div>
          </div>

          {session ? (
            <div className="grid gap-3 md:grid-cols-2">
              {session.rounds.map((round) => (
                <div key={round.id} className={`rounded-xl border p-3 transition-colors ${roundTone(round)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-on-surface">{round.label}</span>
                    <span className={`text-[10px] font-semibold ${round.status === 'complete' ? 'text-primary' : round.status === 'active' ? 'text-secondary' : round.status === 'interrupted' ? 'text-error' : 'text-outline'}`}>{statusLabel(round.status)}</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {round.panelists.map((panelist) => (
                      <div key={panelist.id} className="flex items-center gap-2 text-[11px]">
                        <Icon name={panelist.status === 'complete' ? 'check_circle' : panelist.status === 'active' ? 'radio_button_checked' : panelist.status === 'interrupted' ? 'cancel' : 'radio_button_unchecked'} size={14} className={panelistTone(panelist.status)} />
                        <span className="min-w-0 flex-1 truncate text-on-surface-variant">{panelist.label}<span className="ml-1 text-outline">· {panelist.focus}</span></span>
                        {panelist.score != null ? <span className="font-mono text-on-surface">{panelist.score}</span> : null}
                      </div>
                    ))}
                  </div>
                  {round.panelists.some((panelist) => panelist.summary) ? <p className="mt-2 border-t border-white/8 pt-2 text-[10px] text-outline">{round.panelists.find((panelist) => panelist.summary)?.summary}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {session?.events.length ? (
            <div className="border-t border-white/8 pt-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold text-on-surface"><span>Live review trace</span><span className="font-normal text-outline">{session.events.length} events</span></div>
              <div className="max-h-28 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                {session.events.slice(-6).map((item) => <div key={item.id} className="flex items-start gap-2 text-[10px] text-outline"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" /><span className="min-w-0 flex-1">{item.message}</span></div>)}
              </div>
            </div>
          ) : null}
          {message ? <p className="text-[11px] text-outline">{message}</p> : null}
        </div>
      )}
    </section>
  )
}
