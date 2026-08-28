import { useEffect, useMemo, useState } from 'react'
import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique } from '../../agent/subdesign/types'
import type { SubDesignPinnedComment } from '../../agent/subdesign/pinnedComments.ts'
import type { SubDesignWorkspaceViewModel } from '../../agent/subdesign/workspace'
import type { Thread } from '../../store/threadStore'
import { useProjectStore } from '../../store/projectStore'
import { useRunActivityStore } from '../../store/runActivityStore'
import { Icon } from '../Icon'
import { ArtifactDeliveryPanel } from './ArtifactDeliveryPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactRevisionDiff } from './ArtifactRevisionDiff'
import { useSubDesignPinnedCommentsStore } from '../../store/subDesignPinnedCommentsStore'
import { ArtifactTweakPanel } from './ArtifactTweakPanel'
import { CritiquePanel } from './CritiquePanel'
import { CritiqueTheater } from './CritiqueTheater'
import { McpAppSurface } from './McpAppSurface'
import { SURFACE_STATUS_LABELS } from '../../agent/subdesign/surfaceStatus.ts'
import { PluginInputForm } from './PluginInputForm'
import { PluginTrustPanel } from './PluginTrustPanel'
import { SubDesignConversationPane } from './SubDesignConversationPane'
import { ExperimentalSurfaceControl } from './ExperimentalSurfaceControl'
import { StorybookContextControl } from './StorybookContextControl'
import type { ExperimentalSurfaceSettings, StorybookProviderSettings } from '../../agent/subdesign/providers/providerSettings.ts'
import type { SubDesignPluginExecutionProjection } from '../../agent/subdesign/pluginExecution.ts'
import type { SubDesignStreamingPresentation } from '../../agent/subdesign/streamingProjection.ts'
import type { PluginInputValues } from '../../agent/subdesign/pluginInputs.ts'
import type { PluginInput } from '../../agent/openDesign/pluginContract.ts'

type StudioTab = 'files' | 'edit' | 'critique' | 'deliver'

type SubDesignProjectStudioProps = {
  brief: SubDesignBrief
  workspace: SubDesignWorkspaceViewModel
  thread: Thread | null
  artifacts: SubDesignArtifact[]
  selectedArtifact: SubDesignArtifact | null
  critique: SubDesignCritique | null
  critiquePassed: boolean
  runIsLive: boolean
  runId: string | null
  startingRun: boolean
  onBack: () => void
  onStartRun: () => void
  onStopRun: () => void
  onSubmitFollowUp: (value: string) => Promise<void>
  onSubmitPinnedComments?: (input: { artifact: { id: string; title?: string; revision: number }; pins: SubDesignPinnedComment[] }) => Promise<{ ok: boolean; runId?: string; error?: string }>
  onOpenTranscript: () => void
  onSelectArtifact: (artifact: SubDesignArtifact) => void
  onSelectDirection: (directionId: string) => void
  storybookSettings: StorybookProviderSettings
  latestStorybookRun: SubDesignPluginExecutionProjection | null
  /** Experimental surface support, shown so users can see what degrades. */
  experimentalSettings?: ExperimentalSurfaceSettings
  onSaveExperimentalSettings?: (
    value: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>,
  ) => Promise<{ ok: boolean; reason?: string }>
  /** Stream projection for the selected artifact, recovered from Host state. */
  artifactStream?: SubDesignStreamingPresentation | null
  /** The plugin's declared inputs, shown when a run is blocked on them. */
  pluginDeclaredInputs?: readonly PluginInput[]
  onSubmitPluginInputs?: (values: PluginInputValues) => void
  onSaveStorybookSettings: (value: Pick<StorybookProviderSettings, 'enabled' | 'endpoint'>) => Promise<{ ok: boolean; reason?: string }>
}

function stageTone(state: SubDesignWorkspaceViewModel['stages'][number]['state']): string {
  if (state === 'completed') return 'text-primary'
  if (state === 'active') return 'text-on-surface'
  if (state === 'pending') return 'text-outline'
  return 'text-outline/45'
}

function LifecycleRoute({ workspace }: { workspace: SubDesignWorkspaceViewModel }) {
  return (
    <ol className="flex min-w-0 flex-1 items-center justify-end gap-2" aria-label="SubDesign lifecycle">
      {workspace.stages.map((stage, index) => (
        <li key={stage.id} className="flex min-w-0 items-center gap-2">
          <span className={`flex items-center gap-1.5 ${stageTone(stage.state)}`} title={`${stage.label} · ${stage.description}`}>
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold ${
              stage.state === 'completed'
                ? 'bg-primary/16 text-primary'
                : stage.state === 'active'
                  ? 'bg-white/[0.08] text-on-surface'
                  : 'bg-white/[0.035] text-outline/60'
            }`}>
              {stage.state === 'completed' ? <Icon name="check" size={11} /> : index + 1}
            </span>
            <span className="hidden text-[9px] font-medium xl:block">{stage.label}</span>
          </span>
          {index < workspace.stages.length - 1 ? (
            <span className={`h-px w-5 2xl:w-8 ${stage.state === 'completed' ? 'bg-primary/35' : 'bg-white/[0.08]'}`} />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

export function SubDesignProjectStudio({
  brief,
  workspace,
  thread,
  artifacts,
  selectedArtifact,
  critique,
  critiquePassed,
  runIsLive,
  runId,
  startingRun,
  onBack,
  onStartRun,
  onStopRun,
  onSubmitFollowUp,
  onSubmitPinnedComments,
  onOpenTranscript,
  onSelectArtifact,
  onSelectDirection,
  storybookSettings,
  latestStorybookRun,
  artifactStream,
  experimentalSettings,
  onSaveExperimentalSettings,
  pluginDeclaredInputs,
  onSubmitPluginInputs,
  onSaveStorybookSettings,
}: SubDesignProjectStudioProps) {
  const projectRoot = useProjectStore((state) => state.root)

  useEffect(() => {
    if (!projectRoot) return
    void useSubDesignPinnedCommentsStore.getState().hydrateCanonical(projectRoot)
  }, [projectRoot])
  const [tab, setTab] = useState<StudioTab>('files')
  const [previewMode, setPreviewMode] = useState<'preview' | 'source' | 'diff'>('preview')
  const [candidateDirectionId, setCandidateDirectionId] = useState(brief.selectedDirectionId || '')
  const directionSurfaceId = `subdesign-direction-${brief.id}`
  const pushRunActivity = useRunActivityStore((state) => state.push)

  useEffect(() => {
    setCandidateDirectionId(brief.selectedDirectionId || '')
  }, [brief.id, brief.selectedDirectionId])

  const selectedDirection = useMemo(
    () => brief.directions.find((direction) => direction.id === candidateDirectionId) || null,
    [brief.directions, candidateDirectionId],
  )
  const hasArtifact = Boolean(selectedArtifact)
  const canCritique = workspace.hasCompleteArtifact
  const awaitingChoice = brief.directions.length > 0 && !brief.selectedDirectionId

  const tabs: Array<{ id: StudioTab; label: string; disabled?: boolean }> = [
    { id: 'files', label: '輸出' },
    { id: 'edit', label: 'Edit', disabled: !hasArtifact },
    { id: 'critique', label: 'Critique', disabled: !canCritique },
    { id: 'deliver', label: 'Deliver', disabled: !critiquePassed },
  ]

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-on-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.08] px-3 lg:px-4">
        <button
          type="button"
          onClick={onBack}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-outline transition-colors hover:bg-white/[0.05] hover:text-on-surface"
          aria-label="回到 SubDesign Home"
        >
          <Icon name="arrow_back" size={17} />
        </button>
        <div className="min-w-0 max-w-[360px]">
          <p className="truncate text-[12px] font-semibold text-on-surface">{brief.objective}</p>
          <p className="mt-0.5 truncate text-[9px] text-outline">SubDesign task · {workspace.nextGate.title}</p>
        </div>
        <div className="ml-auto hidden min-w-[300px] max-w-[540px] flex-1 xl:flex">
          <LifecycleRoute workspace={workspace} />
        </div>
        <button
          type="button"
          onClick={onOpenTranscript}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-medium text-outline transition-colors hover:bg-white/[0.045] hover:text-on-surface"
        >
          <Icon name="receipt_long" size={14} />
          <span className="hidden sm:inline">執行摘要</span>
        </button>
        <StorybookContextControl
          settings={storybookSettings}
          latestRun={latestStorybookRun}
          disabled={runIsLive || startingRun}
          onSave={onSaveStorybookSettings}
        />
        {experimentalSettings && onSaveExperimentalSettings ? (
          <ExperimentalSurfaceControl
            settings={experimentalSettings}
            disabled={runIsLive || startingRun}
            onSave={onSaveExperimentalSettings}
          />
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[350px_minmax(0,1fr)]">
        <SubDesignConversationPane
          brief={brief}
          workspace={workspace}
          thread={thread}
          runIsLive={runIsLive}
          runId={runId}
          startingRun={startingRun}
          onOpenTranscript={onOpenTranscript}
          onStartRun={onStartRun}
          onStopRun={onStopRun}
          onSubmitFollowUp={onSubmitFollowUp}
        />

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4">
            <nav className="flex h-full items-center gap-1" aria-label="SubDesign workspace views">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => setTab(item.id)}
                  className={`h-full border-b-2 px-3 text-[10px] font-semibold transition-colors ${
                    tab === item.id
                      ? 'border-primary text-on-surface'
                      : 'border-transparent text-outline hover:text-on-surface disabled:cursor-not-allowed disabled:text-outline/35'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            {tab === 'files' ? (
              <div className="flex min-w-0 items-center gap-2">
                {artifacts.length > 1 ? (
                  <label className="relative hidden sm:block">
                    <span className="sr-only">Artifact revision</span>
                    <select
                      value={selectedArtifact ? `${selectedArtifact.id}:${selectedArtifact.revision}` : ''}
                      onChange={(event) => {
                        const artifact = artifacts.find((item) => `${item.id}:${item.revision}` === event.target.value)
                        if (artifact) onSelectArtifact(artifact)
                      }}
                      className="h-7 max-w-[190px] appearance-none rounded-lg bg-white/[0.04] pl-2 pr-7 text-[9px] text-outline outline-none hover:text-on-surface"
                    >
                      {artifacts.map((artifact) => (
                        <option key={`${artifact.id}:${artifact.revision}`} value={`${artifact.id}:${artifact.revision}`}>
                          {artifact.title} · r{artifact.revision}
                        </option>
                      ))}
                    </select>
                    <Icon name="expand_more" size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-outline" />
                  </label>
                ) : selectedArtifact ? (
                  <span className="hidden max-w-[180px] truncate text-[9px] text-outline sm:block">{selectedArtifact.title} · r{selectedArtifact.revision}</span>
                ) : null}
                <div className="inline-flex items-center rounded-lg bg-white/[0.04] p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('preview')}
                    className={`rounded-md px-2 py-1 text-[9px] font-semibold ${previewMode === 'preview' ? 'bg-white/[0.08] text-on-surface' : 'text-outline'}`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    disabled={!selectedArtifact}
                    onClick={() => setPreviewMode('source')}
                    className={`rounded-md px-2 py-1 text-[9px] font-semibold disabled:opacity-35 ${previewMode === 'source' ? 'bg-white/[0.08] text-on-surface' : 'text-outline'}`}
                  >
                    Code
                  </button>
                  <button
                    type="button"
                    disabled={!selectedArtifact}
                    onClick={() => setPreviewMode('diff')}
                    className={`rounded-md px-2 py-1 text-[9px] font-semibold disabled:opacity-35 ${previewMode === 'diff' ? 'bg-white/[0.08] text-on-surface' : 'text-outline'}`}
                  >
                    Diff
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3 custom-scrollbar lg:p-4">
            {tab === 'files' ? (
              <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col">
                {selectedArtifact && previewMode === 'diff' ? (
                  <ArtifactRevisionDiff artifactId={selectedArtifact.id} projectRoot={projectRoot || undefined} />
                ) : selectedArtifact ? (
                  <ArtifactPreview
                    artifact={selectedArtifact}
                    mode={previewMode === 'source' ? 'source' : 'preview'}
                    streaming={artifactStream}
                    onSubmitPinnedComments={onSubmitPinnedComments && !runIsLive ? async (pins) => {
                      const result = await onSubmitPinnedComments({ artifact: { id: selectedArtifact.id, title: selectedArtifact.title, revision: selectedArtifact.revision }, pins })
                      if (!result.ok) return { ok: false, error: result.error || '無法啟動 pin 修正。' }
                      if (!projectRoot) return { ok: true, warning: '修正已送出，但目前沒有 projectRoot，稽核記錄尚未同步。' }
                      const audit = await useSubDesignPinnedCommentsStore.getState().recordSubmission({
                        artifactId: selectedArtifact.id,
                        revision: selectedArtifact.revision,
                        briefId: selectedArtifact.briefId,
                        runId: result.runId,
                        pins,
                      }, projectRoot)
                      return audit.persisted
                        ? { ok: true }
                        : { ok: true, warning: '修正已送出，但 canonical 稽核記錄寫入失敗；已保留本機副本。' }
                    } : undefined}
                  />
                ) : (
                  <section className="grid min-h-[420px] flex-1 place-items-center bg-surface-container-low/20 px-6 text-center">
                    <div className="max-w-[360px]">
                      <Icon name="gallery_thumbnail" size={28} className="mx-auto text-outline/55" />
                      <p className="mt-3 text-[13px] font-semibold text-on-surface">等待第一個 visual artifact</p>
                      <p className="mt-2 text-[11px] leading-relaxed text-outline">
                        Agent 產生 reference image 或可編輯 artifact 後，會在此自動顯示，不需要切換到另一個功能。
                      </p>
                    </div>
                  </section>
                )}

                {brief.directions.length ? (
                  <section className="mt-3 border-t border-white/[0.07] pt-3" aria-label="Visual directions">
                    {/*
                      Direction choice runs as a sandboxed MCP Apps surface when
                      that flag is on. Unavailable, invalid, expired or crashed,
                      it falls back to this native grid — either way the choice
                      backfills the brief's direction.
                    */}
                    <McpAppSurface
                      surfaceId={directionSurfaceId}
                      declaration={{ kind: 'choice', scope: 'conversation', allowlist: [] }}
                      runId={runId || undefined}
                      threadId={brief.threadId}
                      projectRoot={projectRoot || undefined}
                      choiceOptions={brief.directions.map((direction) => ({
                        id: direction.id,
                        label: direction.title,
                        summary: direction.summary,
                      }))}
                      onChoice={(directionId) => {
                        if (!brief.directions.some((direction) => direction.id === directionId)) return
                        setCandidateDirectionId(directionId)
                        onSelectDirection(directionId)
                      }}
                      onStatusChange={(status, detail) => {
                        // Real execution messages, not one blanket spinner.
                        pushRunActivity({
                          runId: runId || undefined,
                          kind: status === 'error' || status === 'invalid' ? 'error' : 'status',
                          title: `方向選擇介面：${SURFACE_STATUS_LABELS[status]}`,
                          detail,
                        })
                      }}
                      fallback={(surfaceActions) => (
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {brief.directions.map((direction, index) => {
                            const selected = direction.id === candidateDirectionId
                            const committed = direction.id === brief.selectedDirectionId
                            return (
                              <button
                                key={direction.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => surfaceActions.choose(direction.id)}
                                className={`min-h-[92px] rounded-xl px-3 py-3 text-left transition-colors ${
                                  selected ? 'bg-primary/[0.09] text-on-surface' : 'bg-white/[0.025] text-on-surface-variant hover:bg-white/[0.045]'
                                }`}
                              >
                                <span className="flex items-center gap-2 text-[10px]">
                                  <span className={`grid h-5 w-5 place-items-center rounded-full ${selected ? 'bg-primary/18 text-primary' : 'bg-white/[0.05] text-outline'}`}>
                                    {committed ? <Icon name="check" size={11} /> : index + 1}
                                  </span>
                                  <span className="font-semibold">{direction.title}</span>
                                </span>
                                <span className="mt-2 line-clamp-2 block text-[10px] leading-relaxed text-outline">{direction.summary}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    />
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 text-[10px] leading-relaxed text-outline">
                        {selectedDirection?.rationale || selectedDirection?.summary || '比較訊息、受眾與延展性後再鎖定方向。'}
                      </p>
                      {awaitingChoice ? (
                        <button
                          type="button"
                          disabled={!selectedDirection}
                          onClick={() => selectedDirection && onSelectDirection(selectedDirection.id)}
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-35"
                        >
                          <Icon name="check" size={14} />採用此方向
                        </button>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-primary">
                          <Icon name="lock" size={13} />方向已鎖定
                        </span>
                      )}
                    </div>
                  </section>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3 text-[10px] text-outline">
                    <span>下一個 gate：{workspace.nextGate.title}</span>
                    <span>{workspace.nextGate.label}</span>
                  </div>
                )}
              </div>
            ) : null}

            {tab === 'edit' ? <div className="mx-auto max-w-[920px]"><ArtifactTweakPanel artifact={selectedArtifact} /></div> : null}
            {tab === 'critique' ? (
              <div className="mx-auto max-w-[1040px] space-y-4">
                <PluginTrustPanel brief={brief} projectRoot={projectRoot || undefined} />
                {pluginDeclaredInputs?.length ? (
                  <PluginInputForm
                    briefId={brief.id}
                    threadId={brief.threadId}
                    runId={runId || undefined}
                    projectRoot={projectRoot || undefined}
                    inputs={pluginDeclaredInputs}
                    onSubmit={(values) => onSubmitPluginInputs?.(values)}
                  />
                ) : null}
                <CritiqueTheater brief={brief} artifact={selectedArtifact} critique={critique} />
                <CritiquePanel critique={critique} />
              </div>
            ) : null}
            {tab === 'deliver' ? <div className="mx-auto max-w-[920px]"><ArtifactDeliveryPanel artifact={selectedArtifact} critique={critique} critiquePassed={critiquePassed} /></div> : null}
          </div>
        </main>
      </div>
    </div>
  )
}
