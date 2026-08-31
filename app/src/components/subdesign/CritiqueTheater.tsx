import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { runTask } from '../../agent/taskRunCoordinator'
import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique, SubDesignCritiquePanelist, SubDesignCritiqueRound } from '../../agent/subdesign/types'
import { Icon } from '../Icon'
import { AgentThinking } from '../primitives/AgentThinking'
import { useAgentStore } from '../../store/agentStore'
import { useProjectStore } from '../../store/projectStore'
import { useRunActivityStore } from '../../store/runActivityStore'
import { useSubDesignCritiqueStore } from '../../store/subDesignCritiqueStore'
import { useSubDesignCritiqueSessionStore } from '../../store/subDesignCritiqueSessionStore'
import { prepareSubDesignRun } from '../../agent/subdesign/pluginExecutionPreparation.ts'
import {
  DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS,
  loadChromeDevToolsProviderState,
  saveChromeDevToolsProviderSettings,
  validateChromeDevToolsProviderEndpoint,
  type ChromeDevToolsProviderSettings,
  DEFAULT_HARNESS_PROVIDER_SETTINGS,
  loadHarnessProviderState,
  saveHarnessProviderSettings,
  type HarnessProviderSettings,
} from '../../agent/subdesign/providers/providerSettings.ts'
import type { SubDesignPluginExecutionProjection } from '../../agent/subdesign/pluginExecution.ts'
import { chromeDevToolsEvidenceAllowsPass } from '../../agent/subdesign/providers/chromeDevToolsProvider.ts'

/** Tools blocked in both Critique Theater rounds: it's read-only against the artifact. */
const CRITIQUE_BLOCKED_TOOLS = [
  'bash',
  'workspace_write',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
  'design_artifact_register',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_export',
]

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

function buildRound1Objective(brief: SubDesignBrief, artifact: SubDesignArtifact): string {
  return [
    `請執行 SubDesign Critique Theater 第一輪（獨立審查），針對 brief ${brief.id} 的 artifact ${artifact.id} revision ${artifact.revision} 做 evidence-based review。`,
    `Brief objective：${brief.objective}`,
    `Artifact entry：${artifact.entry}；renderer=${artifact.renderer}；kind=${artifact.kind}。`,
    '這是一個 read-only review：不可修改任何專案檔（若專案提供 DESIGN.md，它也只是可選的唯讀參考）、不可 patch/tweak/export，也不可寫入 workspace。',
    '先使用 design_artifact_capture 取得 screenshot 與 DOM，再使用 design_artifact_lint 取得語意證據。',
    '接著呼叫 design_critique_note 三次（round=1），分別代表 panelistId=visual（brief coverage／brand conformance）、accessibility（a11y／evidence integrity）、implementation（readiness／artifact boundary）。三次的 score 與 summary 必須反映該 panelist 自己的判斷 —— 不可三次寫相同的分數或文字，那是三個獨立觀點，不是一個分數拆三份。',
    '這一輪不要呼叫 design_critique；那是第二輪交叉核對之後才寫的最終結果。',
  ].join('\n')
}

function buildRound2Objective(brief: SubDesignBrief, artifact: SubDesignArtifact, round1Notes: SubDesignCritiquePanelist[]): string {
  const notesText = round1Notes
    .map((panelist) => {
      const findings = (panelist.findings || [])
        .map((item) => `  - [${item.severity}] ${item.message}${item.path ? `（${item.path}）` : ''}`)
        .join('\n')
      return [
        `- ${panelist.label}（${panelist.id}）· score ${panelist.score ?? '—'}`,
        `  summary：${panelist.summary || '（無）'}`,
        findings || '  findings：無',
      ].join('\n')
    })
    .join('\n')
  return [
    `請執行 SubDesign Critique Theater 第二輪（交叉核對），針對 brief ${brief.id} 的 artifact ${artifact.id} revision ${artifact.revision}。`,
    '以下是第一輪三位 panelist 各自的獨立審查結果：',
    notesText,
    '請針對上面列出的每一個 blocker 具體重新查核 —— 不是照抄第一輪的文字；需要的話重新使用 design_artifact_capture／design_artifact_lint 取得最新證據。',
    '接著呼叫 design_critique_note 三次（round=2），分別代表 visual、accessibility、implementation，反映交叉核對後的結論。',
    '最後呼叫 design_critique 恰好一次，寫入四項 0–100 綜合分數、evidence（可重用你在 note 中用過的 screenshot／dom／lint entry，或重新擷取）、findings 與 verdict。',
    '若 evidence 或 blocker 仍不足，請明確回報 needs-revision，不得猜測 pass。',
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
  const canStartRun = useAgentStore((state) => state.canStartRun)
  const getRunIdForThread = useAgentStore((state) => state.getRunIdForThread)
  const stopExecution = useAgentStore((state) => state.stopExecution)
  const threadRunId = brief?.threadId ? getRunIdForThread(brief.threadId) : null
  const activity = useRunActivityStore((state) =>
    threadRunId ? state.presentations[threadRunId] : null,
  )
  const session = useSubDesignCritiqueSessionStore((state) => state.current)
  const startSession = useSubDesignCritiqueSessionStore((state) => state.start)
  const startRound = useSubDesignCritiqueSessionStore((state) => state.startRound)
  const finishSession = useSubDesignCritiqueSessionStore((state) => state.finish)
  const interruptSession = useSubDesignCritiqueSessionStore((state) => state.interrupt)
  const failSession = useSubDesignCritiqueSessionStore((state) => state.fail)
  const latestForArtifact = useSubDesignCritiqueStore((state) => state.latestForArtifact)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [cdtSettings, setCdtSettings] = useState<ChromeDevToolsProviderSettings>(DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS)
  const [cdtEndpoint, setCdtEndpoint] = useState(DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS.endpoint)
  const [cdtRuns, setCdtRuns] = useState<SubDesignPluginExecutionProjection[]>([])
  const [providerMessage, setProviderMessage] = useState('')
  const [harnessSettings, setHarnessSettings] = useState<HarnessProviderSettings>(DEFAULT_HARNESS_PROVIDER_SETTINGS)
  const [harnessGoal, setHarnessGoal] = useState('完成此設計的主要任務，並指出任何卡住或不清楚的操作。')
  const [harnessPersona, setHarnessPersona] = useState('第一次使用此產品、沒有受過操作訓練的使用者。')
  const [harnessRuns, setHarnessRuns] = useState<SubDesignPluginExecutionProjection[]>([])
  const [harnessStatus, setHarnessStatus] = useState<{ available: boolean; platform: string; version: string | null; reason: string | null; screenRecording: string; accessibility: string } | null>(null)
  const capacity = canStartRun(undefined, brief?.threadId || undefined)
  const isRunning = Boolean(threadRunId) || !capacity.allowed

  const refreshCdtState = useCallback(async () => {
    const [cdtState, harnessState] = await Promise.all([
      loadChromeDevToolsProviderState(projectRoot || undefined),
      loadHarnessProviderState(projectRoot || undefined),
    ])
    setCdtSettings(cdtState.settings)
    setCdtEndpoint(cdtState.settings.endpoint)
    setCdtRuns(cdtState.runs)
    setHarnessSettings(harnessState.settings)
    setHarnessRuns(harnessState.runs)
    const status = await window.subagents?.subdesign.harnessStatus?.(harnessState.settings.binaryPath)
    if (status) setHarnessStatus(status)
  }, [projectRoot])

  useEffect(() => {
    void refreshCdtState()
  }, [refreshCdtState])

  const latestActivity = useMemo(() => {
    const event = activity?.events[activity.events.length - 1]
    return activity?.statusLine || event?.title || event?.detail || ''
  }, [activity])
  const latestCdtRun = useMemo(() => cdtRuns.find((run) => run.briefId === brief?.id), [brief?.id, cdtRuns])
  const latestHarnessRun = useMemo(() => harnessRuns.find((run) => run.briefId === brief?.id), [brief?.id, harnessRuns])

  const runCritique = async () => {
    if (!brief || !artifact || busy || isRunning) return
    setBusy(true)
    setMessage('正在啟動第一輪獨立審查…')
    const baselineRevision = latestForArtifact(artifact.id, artifact.revision)?.revision || 0
    startSession({ briefId: brief.id, artifactId: artifact.id, artifactRevision: artifact.revision })
    try {
      let harnessGateReason = ''
      if (harnessSettings.enabled) {
        setMessage('正在執行 Harness goal-based UX check…')
        const harnessRunId = `run_${uuid().slice(0, 12)}`
        const preparedHarness = await prepareSubDesignRun({
          brief,
          runId: harnessRunId,
          projectRoot: projectRoot || undefined,
          providerOverride: {
            providerId: 'harness',
            failurePolicy: 'continue-on-blocked',
            providerConfig: {
              enabled: true,
              resolvedVersion: harnessSettings.resolvedVersion,
              binaryPath: harnessSettings.binaryPath,
              targetUrl: harnessSettings.targetUrl,
              platform: 'web',
              goal: harnessGoal,
              persona: harnessPersona,
              artifactId: artifact.id,
              stepBudget: 20,
            },
          },
        })
        if (preparedHarness.overrides) {
          await runTask({
            runId: harnessRunId,
            objective: `執行 Harness UX check：${harnessGoal}`,
            sourceKind: 'composer',
            reuseThreadId: brief.threadId,
            runner: 'builtin',
            loopType: 'Goal-based',
            projectRoot: projectRoot || undefined,
            overrides: { agentMode: 'plan', maxIterations: 1, maxToolRounds: 1, blockedTools: CRITIQUE_BLOCKED_TOOLS, ...preparedHarness.overrides, extraSystemContext: 'Harness is optional execution evidence. Summarize its Host projection only; do not manufacture steps, screenshots, friction, or a passing verdict.' },
          })
          const state = await loadHarnessProviderState(projectRoot || undefined)
          setHarnessRuns(state.runs)
          const projection = state.runs.find((run) => run.runId === harnessRunId)
          if (!projection?.goalResult || projection.goalResult.outcome !== 'success') harnessGateReason = projection?.summary || 'Harness 沒有可信的 success goal result。'
        } else harnessGateReason = preparedHarness.blockedReason || 'Harness 尚未就緒。'
      }
      startRound(1)
      const round1RunId = `run_${uuid().slice(0, 12)}`
      const round1Provider = cdtSettings.enabled
        ? await prepareSubDesignRun({
            brief,
            runId: round1RunId,
            projectRoot: projectRoot || undefined,
            providerOverride: {
              providerId: 'chrome-devtools',
              failurePolicy: 'continue-on-blocked',
              providerConfig: {
                enabled: true,
                endpoint: cdtSettings.endpoint,
                resolvedVersion: cdtSettings.resolvedVersion,
                artifactId: artifact.id,
              },
            },
          })
        : null
      const round1 = await runTask({
        runId: round1RunId,
        objective: buildRound1Objective(brief, artifact),
        sourceKind: 'composer',
        reuseThreadId: brief.threadId,
        runner: 'builtin',
        loopType: 'Goal-based',
        projectRoot: projectRoot || undefined,
        overrides: {
          agentMode: 'plan',
          maxIterations: 3,
          maxToolRounds: 10,
          blockedTools: [...CRITIQUE_BLOCKED_TOOLS, 'design_critique'],
          extraSystemContext: `Critique Theater round 1: independent review. Write exactly three design_critique_note calls (round=1), one per panelist, each with its own reasoning. Do not call design_critique yet — that only happens after round 2.${cdtSettings.enabled && !round1Provider?.overrides ? ` Browser runtime evidence was requested but unavailable (${round1Provider?.blockedReason || 'unknown'}); do not treat it as passed evidence.` : ''}`,
          ...(round1Provider?.overrides ?? {}),
        },
      })
      if (round1.queued || round1.skipped) {
        failSession(round1.error || '目前已有執行中的任務，critique 未啟動。')
        setMessage(round1.error || 'Critique 未啟動。')
        return
      }
      if (useSubDesignCritiqueSessionStore.getState().current?.status !== 'running') return
      const round1Notes = useSubDesignCritiqueSessionStore.getState().current?.rounds[0]?.panelists || []
      if (!round1Notes.every((panelist) => panelist.status === 'complete')) {
        failSession('第一輪未完成三位 panelist 的獨立審查，Critique Theater 中止。')
        setMessage('第一輪未完成三位 panelist 的獨立審查。')
        return
      }

      setMessage('正在啟動第二輪交叉核對…')
      startRound(2)
      const round2RunId = `run_${uuid().slice(0, 12)}`
      const round2Provider = cdtSettings.enabled
        ? await prepareSubDesignRun({
            brief,
            runId: round2RunId,
            projectRoot: projectRoot || undefined,
            providerOverride: {
              providerId: 'chrome-devtools',
              failurePolicy: 'continue-on-blocked',
              providerConfig: {
                enabled: true,
                endpoint: cdtSettings.endpoint,
                resolvedVersion: cdtSettings.resolvedVersion,
                artifactId: artifact.id,
              },
            },
          })
        : null
      const round2 = await runTask({
        runId: round2RunId,
        objective: buildRound2Objective(brief, artifact, round1Notes),
        sourceKind: 'composer',
        reuseThreadId: brief.threadId,
        runner: 'builtin',
        loopType: 'Goal-based',
        projectRoot: projectRoot || undefined,
        overrides: {
          agentMode: 'plan',
          maxIterations: 4,
          maxToolRounds: 14,
          blockedTools: CRITIQUE_BLOCKED_TOOLS,
          extraSystemContext: `Critique Theater round 2: cross-check round 1 blockers specifically (do not just restate them), write three design_critique_note calls (round=2), then call design_critique exactly once with the final synthesis.${cdtSettings.enabled && !round2Provider?.overrides ? ` Browser runtime evidence was requested but unavailable (${round2Provider?.blockedReason || 'unknown'}); final verdict cannot pass based on missing runtime evidence.` : ''}`,
          ...(round2Provider?.overrides ?? {}),
        },
      })
      if (round2.queued || round2.skipped) {
        failSession(round2.error || '第二輪未啟動。')
        setMessage(round2.error || '第二輪未啟動。')
        return
      }
      if (useSubDesignCritiqueSessionStore.getState().current?.status !== 'running') return
      const nextCritique = latestForArtifact(artifact.id, artifact.revision)
      if (!nextCritique || (nextCritique.revision || 0) <= baselineRevision) {
        failSession('Agent run 完成，但沒有寫入新的 evidence-based critique。')
        setMessage('Agent run 完成，但沒有寫入新的 evidence-based critique。')
        return
      }
      if (cdtSettings.enabled) {
        const providerState = await loadChromeDevToolsProviderState(projectRoot || undefined)
        const runtimeGate = chromeDevToolsEvidenceAllowsPass(
          providerState.runs.find((run) => run.runId === round2RunId),
          { runId: round2RunId, artifactId: artifact.id },
        )
        if (!runtimeGate.allowed) {
          failSession(`Browser runtime evidence 未通過：${runtimeGate.reason}`)
          setMessage(`Browser runtime evidence 未通過：${runtimeGate.reason}`)
          setCdtRuns(providerState.runs)
          return
        }
      }
      if (harnessGateReason) {
        failSession(`Harness UX check 未通過：${harnessGateReason}`)
        setMessage(`靜態與 browser evidence 已完成，但 Harness UX check 未通過：${harnessGateReason}`)
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
      void refreshCdtState()
    }
  }

  const interrupt = () => {
    if (threadRunId) stopExecution(threadRunId)
    interruptSession('使用者中止 Critique Theater')
    setBusy(false)
    setMessage('Critique 已中止；尚未完成的 round 不會進入 Deliver gate。')
  }

  const sessionRunning = session?.status === 'running'
  const currentScore = session?.compositeScore ?? (critique
    ? Math.round((critique.briefCoverage + critique.brandConformance + critique.accessibility + critique.implementationReadiness) / 4)
    : null)

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/20 bg-surface-container-low/55">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center ${sessionRunning ? 'text-secondary' : 'text-primary'}`}>
            {sessionRunning ? <AgentThinking variant="wave" /> : <Icon name="fact_check" size={19} />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold text-on-surface">Critique Theater</h3>
              <span className="text-[11px] text-on-surface-variant">2 rounds · 3 panelists</span>
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

      <div className="flex flex-wrap items-center gap-3 border-b border-white/8 px-4 py-2.5">
        <label className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-on-surface">
          <input
            type="checkbox"
            checked={cdtSettings.enabled}
            disabled={busy || sessionRunning}
            onChange={async (event) => {
              const enabled = event.target.checked
              const result = await saveChromeDevToolsProviderSettings({ enabled, endpoint: cdtEndpoint }, projectRoot || undefined)
              if (result.ok) {
                setCdtSettings(result.settings)
                setProviderMessage(enabled ? 'Browser runtime evidence 已啟用。' : '維持靜態 critique。')
              } else setProviderMessage(result.reason)
            }}
            className="h-4 w-4 accent-primary"
          />
          Browser runtime evidence
        </label>
        {cdtSettings.enabled ? (
          <>
            <label className="min-w-[190px] flex-1">
              <span className="sr-only">Chrome DevTools endpoint</span>
              <input
                type="url"
                value={cdtEndpoint}
                disabled={busy || sessionRunning}
                onChange={(event) => setCdtEndpoint(event.target.value)}
                className="h-8 w-full rounded-lg bg-background/50 px-2.5 text-[11px] text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary/55"
              />
            </label>
            <button
              type="button"
              disabled={busy || sessionRunning}
              onClick={async () => {
                const validation = validateChromeDevToolsProviderEndpoint(cdtEndpoint)
                if (validation) return setProviderMessage(validation)
                const result = await saveChromeDevToolsProviderSettings({ enabled: true, endpoint: cdtEndpoint }, projectRoot || undefined)
                if (result.ok) {
                  setCdtSettings(result.settings)
                  setProviderMessage('CDP endpoint 已儲存。')
                } else setProviderMessage(result.reason)
              }}
              className="h-8 rounded-lg px-3 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
            >
              儲存 endpoint
            </button>
          </>
        ) : null}
        <span className="min-w-0 truncate text-[11px] text-on-surface-variant" aria-live="polite" title={providerMessage || latestCdtRun?.summary}>
          {providerMessage || (latestCdtRun ? `Last: ${latestCdtRun.findings?.length || 0} findings${latestCdtRun.partial ? ' · partial' : ''}` : 'Optional · CDP 1.3 · localhost only')}
        </span>
      </div>

      {latestCdtRun ? (
        <div className="border-b border-white/8 px-4 py-3" data-testid="cdt-evidence-summary">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[11px] font-semibold text-on-surface">Browser evidence · {latestCdtRun.state}</p>
            <p className="text-[10px] text-on-surface-variant">chrome-devtools · {latestCdtRun.stageId}{latestCdtRun.partial ? ' · partial' : ''}</p>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-on-surface-variant">{latestCdtRun.summary}</p>
          {latestCdtRun.findings?.length ? (
            <ul className="mt-2 space-y-1.5">
              {latestCdtRun.findings.slice(0, 3).map((finding, index) => (
                <li key={`${finding.kind}-${finding.capturedAt}-${index}`} className="grid grid-cols-[64px_1fr] gap-2 text-[10px] leading-4">
                  <span className={finding.severity === 'blocker' ? 'font-semibold text-error' : finding.severity === 'warning' ? 'font-semibold text-secondary' : 'text-on-surface-variant'}>{finding.severity}</span>
                  <span className="min-w-0 text-on-surface-variant"><span className="font-medium text-on-surface">{finding.kind}</span> · {finding.message}{finding.path ? ` · ${finding.path}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {latestCdtRun.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {latestCdtRun.attachments.map((attachment) => (
                <button
                  key={attachment.locator}
                  type="button"
                  title={attachment.locator}
                  onClick={async () => {
                    const result = await window.subagents?.subdesign.revealProviderAttachment({ locator: attachment.locator, projectRoot: projectRoot || undefined })
                    setProviderMessage(result?.ok ? `已在 Finder 顯示 ${attachment.kind}。` : result?.error || '無法開啟附件。')
                  }}
                  className="text-[10px] font-medium text-primary transition-colors hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/45"
                >
                  顯示 {attachment.kind} · {Math.max(1, Math.ceil(attachment.bytes / 1024))} KB
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="border-b border-white/8 px-4 py-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-on-surface">Goal-based UX check <span className="ml-2 font-normal text-on-surface-variant">Harness {harnessSettings.enabled ? 'On' : 'Off'} · web · {harnessStatus ? (harnessStatus.available ? `${harnessStatus.version} ready` : harnessStatus.reason) : 'desktop status unavailable'}</span></summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-[10px] text-on-surface-variant">Goal
            <textarea value={harnessGoal} disabled={busy || sessionRunning} onChange={(event) => setHarnessGoal(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg bg-background/50 px-2.5 py-2 text-[11px] leading-4 text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary/55" />
          </label>
          <label className="text-[10px] text-on-surface-variant">Persona
            <textarea value={harnessPersona} disabled={busy || sessionRunning} onChange={(event) => setHarnessPersona(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg bg-background/50 px-2.5 py-2 text-[11px] leading-4 text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary/55" />
          </label>
          <label className="text-[10px] text-on-surface-variant">Local web target
            <input value={harnessSettings.targetUrl} disabled={busy || sessionRunning} onChange={(event) => setHarnessSettings((current) => ({ ...current, targetUrl: event.target.value }))} className="mt-1 h-8 w-full rounded-lg bg-background/50 px-2.5 text-[11px] text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary/55" />
          </label>
          <label className="text-[10px] text-on-surface-variant">harness-mcp 0.7.0 binary
            <input value={harnessSettings.binaryPath} disabled={busy || sessionRunning} onChange={(event) => setHarnessSettings((current) => ({ ...current, binaryPath: event.target.value }))} className="mt-1 h-8 w-full rounded-lg bg-background/50 px-2.5 text-[11px] text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary/55" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] font-medium text-on-surface"><input type="checkbox" checked={harnessSettings.enabled} disabled={busy || sessionRunning} onChange={(event) => setHarnessSettings((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-primary" />Run before Critique</label>
          <button type="button" disabled={busy || sessionRunning} onClick={async () => {
            const result = await saveHarnessProviderSettings({ enabled: harnessSettings.enabled, binaryPath: harnessSettings.binaryPath, targetUrl: harnessSettings.targetUrl }, projectRoot || undefined)
            if (result.ok) { setHarnessSettings(result.settings); setProviderMessage('Harness project settings 已儲存。') } else setProviderMessage(result.reason)
          }} className="text-[10px] font-semibold text-primary hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/45">儲存 Harness 設定</button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-on-surface-variant">Target platform: web. Web run 不需要 Screen Recording / Accessibility；macOS app run 才需要（目前狀態：Screen Recording {harnessStatus?.screenRecording || 'unknown'} / Accessibility {harnessStatus?.accessibility || 'unknown'}）。</p>
        {latestHarnessRun ? <div className="mt-3 text-[10px] leading-4 text-on-surface-variant"><p><span className="font-semibold text-on-surface">Latest · {latestHarnessRun.goalResult?.outcome || latestHarnessRun.state}</span> · {latestHarnessRun.goalResult?.steps.length || 0} steps · {latestHarnessRun.goalResult?.frictionEvents.length || 0} friction</p><p>{latestHarnessRun.summary}</p>{latestHarnessRun.goalResult?.steps.at(-1) ? <p>Last: {latestHarnessRun.goalResult.steps.at(-1)?.action} · {latestHarnessRun.goalResult.steps.at(-1)?.observation}</p> : null}{latestHarnessRun.goalResult?.frictionEvents.at(-1) ? <p>Friction: {latestHarnessRun.goalResult.frictionEvents.at(-1)?.type} · {latestHarnessRun.goalResult.frictionEvents.at(-1)?.detail}</p> : null}{latestHarnessRun.attachments?.length ? <div className="mt-1 flex flex-wrap gap-x-4">{latestHarnessRun.attachments.map((attachment) => <button key={attachment.locator} type="button" title={attachment.locator} onClick={async () => { const result = await window.subagents?.subdesign.revealProviderAttachment({ locator: attachment.locator, projectRoot: projectRoot || undefined }); setProviderMessage(result?.ok ? `已在 Finder 顯示 ${attachment.kind}。` : result?.error || '無法開啟附件。') }} className="font-medium text-primary hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/45">顯示 {attachment.kind}</button>)}</div> : null}</div> : null}
      </details>

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
