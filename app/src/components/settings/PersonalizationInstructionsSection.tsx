import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  createInstructionProjectionCursor,
  invalidateInstructionProjection,
  type InstructionProjectionCursor,
} from '../../agent/instructionProjectionCursor.ts'
import {
  observeInstructionProjectionEvent,
  requestInstructionProjection,
} from '../../agent/instructionProjectionUpdate.ts'
import type { InstructionDeliveryMode } from '../../agent/instructionSnapshot.ts'
import { updateDraftStateAtomically } from './draftState.ts'
import { SettingsGroup, SettingsStack, settingsBtnCls, settingsBtnPrimaryCls, settingsInputCls } from './SettingsChrome'

type Projection = Awaited<ReturnType<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']['resolve']>>['instructionSnapshot']
type Instructions = Awaited<ReturnType<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']['get']>>['instructions']
type ImportPreview = Awaited<ReturnType<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']['previewImport']>>['preview']
type InstructionBridge = NonNullable<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']>
type LegacyInput = { personality?: string; aboutUser?: string; responseStyle?: string; soul?: string; agents?: string }
type InstructionPresence = 'unset' | 'blank' | 'value'
type DraftField = { value: string; presence: InstructionPresence; edited: boolean }
type DraftValues = { global: DraftField; personality: DraftField; preset: DraftField; about: DraftField; response: DraftField }
type ProjectEdit = { target: 'AGENTS.md' | 'AGENTS.override.md' | 'CLAUDE.md'; expectedHash: string; content: string }
type GlobalConflict = { current: Instructions; baseRevision: number }
type ConflictField = {
  key: keyof DraftValues
  label: string
  hostValue: string | undefined
  hostPresence: InstructionPresence
  localValue: string | undefined
  localPresence: InstructionPresence
}

const emptyInstructions: Instructions = {
  schemaVersion: 1,
  revision: 0,
  globalCustomInstructions: '',
  advancedPersonalityInstructions: '',
  hash: '',
  updatedAt: '1970-01-01T00:00:00.000Z',
}
const personalityPresetValues = ['default', 'none', 'friendly', 'efficient', 'professional', 'candid', 'quirky'] as const

function sourceFileName(source: Projection['sources'][number]): string | undefined {
  return source.path?.split(/[\\/]/u).at(-1)
}

function sourceLabel(source: Projection['sources'][number]): string {
  if (source.kind === 'global-custom') return '全域自訂指令'
  if (source.kind === 'personality') return '進階人格'
  if (source.kind === 'project-override') return 'Project override'
  if (source.kind === 'project-parent') return `Project parent${sourceFileName(source) ? ` · ${sourceFileName(source)}` : ''}`
  if (source.kind === 'project-root') return `Project root${sourceFileName(source) ? ` · ${sourceFileName(source)}` : ''}`
  if (source.kind === 'project-directory') return `Project directory${sourceFileName(source) ? ` · ${sourceFileName(source)}` : ''}`
  if (source.kind === 'fallback') return 'Fallback instruction'
  if (source.kind === 'include') return `Included local file${sourceFileName(source) ? ` · ${sourceFileName(source)}` : ''}`
  return source.kind
}

function sourceBytes(source: Projection['sources'][number]): string {
  if (!source.bytesKnown) return 'bytes unavailable'
  return source.applied ? `${source.includedBytes}/${source.bytes} B applied` : `${source.bytes} B observed`
}

function sourceStatus(source: Projection['sources'][number]): string {
  if (source.applied) return `applied · effective order ${source.effectiveOrder ?? 'unavailable'}`
  if (source.shadowed) return 'shadowed · not applied'
  if (source.deduplicated) return 'deduplicated · not applied'
  return 'degraded/not applied'
}

function sourceCanOpen(source: Projection['sources'][number]): boolean {
  return Boolean(source.path && source.openable && source.metadataStatus === 'content')
}

function sourceOpenability(source: Projection['sources'][number]): string | null {
  if (!source.path || sourceCanOpen(source)) return null
  if (source.metadataStatus !== 'content') return `Host metadata ${source.metadataStatus}；目前不可開啟。`
  return '此 source 在目前 project boundary 外；Host 不提供開啟動作。'
}

function sourceLayer(source: Projection['sources'][number]): string {
  if (source.kind === 'project-parent') return `parent layer ${Math.abs(source.directoryDepth)}`
  if (source.kind === 'project-root') return 'project root layer'
  if (source.kind === 'project-directory') return `work directory layer ${source.directoryDepth}`
  if (source.kind === 'include') return `include depth ${source.includeDepth ?? 0}`
  return source.scope === 'global' ? 'global layer' : 'project layer'
}

function deliveryModeLabel(mode: InstructionDeliveryMode): string {
  if (mode === 'native') return 'native（provider-owned discovery；Host 不宣稱 exact text）'
  if (mode === 'unverified') return 'unverified（provider discovery 未獲證明）'
  return 'explicit（Host 明確送出 snapshot）'
}

function contextPressure(included: number, budget: number): string {
  if (!budget) return 'budget unavailable'
  const percent = Math.min(999, Math.round((included / budget) * 100))
  if (included > budget) return `${percent}% · 超出 slot budget，Host 將拒絕超額 source`
  if (percent >= 90) return `${percent}% · 接近 slot budget`
  return `${percent}%`
}

function hasLegacyMigrationInput(legacy: LegacyInput, presence: { personality: boolean; aboutUser: boolean; responseStyle: boolean }): boolean {
  return Boolean(legacy.soul?.trim() || legacy.agents?.trim() || legacy.soul !== undefined || legacy.agents !== undefined
    || presence.personality || presence.aboutUser || presence.responseStyle)
}

function legacyMigrationPayload(legacy: LegacyInput): LegacyInput {
  return {
    ...(legacy.agents !== undefined ? { agents: legacy.agents } : {}),
    ...(legacy.soul !== undefined ? { soul: legacy.soul } : {}),
    ...(legacy.personality !== undefined ? { personality: legacy.personality } : {}),
    ...(legacy.aboutUser !== undefined ? { aboutUser: legacy.aboutUser } : {}),
    ...(legacy.responseStyle !== undefined ? { responseStyle: legacy.responseStyle } : {}),
  }
}

async function readReadyLegacySource(): Promise<{ ready: true } | { ready: false; error?: string }> {
  const { useLearningStore } = await import('../../store/learningStore.ts')
  if (!useLearningStore.getState().loaded) await useLearningStore.getState().load()
  const { getLegacyInstructionHydration } = await import('../../agent/hermes/promptBuilder.ts')
  let readiness = getLegacyInstructionHydration()
  if (readiness.status === 'failed') {
    await useLearningStore.getState().reloadLegacyInstructionSource()
    readiness = getLegacyInstructionHydration()
  }
  return readiness.status === 'ready' ? { ready: true } : { ready: false, error: readiness.error || 'hydrating' }
}

async function migrateLegacyIfNeeded(
  bridge: InstructionBridge,
  current: Instructions,
  legacy: LegacyInput,
  presence: { personality: boolean; aboutUser: boolean; responseStyle: boolean },
): Promise<{ instructions: Instructions; status?: string }> {
  if (current.revision !== 0 || !hasLegacyMigrationInput(legacy, presence)) return { instructions: current }
  const migrated = await bridge.migrateLegacy(legacyMigrationPayload(legacy))
  return { instructions: migrated.instructions, status: migrated.instructionMigrationReport.status }
}

async function readCurrentInstructions(input: ProjectionRefreshInput): Promise<{ instructions: Instructions; migrationStatus?: string }> {
  const current = (await input.bridge!.get()).instructions
  const migration = await migrateLegacyIfNeeded(input.bridge!, current, input.legacy, input.legacyPresence)
  return { instructions: migration.instructions, migrationStatus: migration.status }
}

function reconcileHostRevisionAndDraft(current: Instructions, previous: Instructions, drafts: DraftValues): { accepted: boolean; preserveDirty: boolean; status?: string } {
  if (current.revision < previous.revision) {
    return { accepted: false, preserveDirty: false, status: `Host 回傳較舊的 committed revision ${current.revision}；保留目前 revision ${previous.revision} projection。` }
  }
  const preserveDirty = draftsDifferFromInstructions(drafts, previous)
  return {
    accepted: true,
    preserveDirty,
    status: preserveDirty && current.revision !== previous.revision
      ? 'Host 已有較新的 revision。請在下方比較 Host 與本地內容，選擇載入 Host 或以 Host revision 重基。'
      : undefined,
  }
}

function inferredPresence(value: string | undefined, explicit?: InstructionPresence): InstructionPresence {
  if (explicit) return explicit
  if (value === undefined) return 'unset'
  return value === '' ? 'blank' : 'value'
}

function hostDraftField(value: string | undefined, explicit?: InstructionPresence, fallback = ''): DraftField {
  const presence = inferredPresence(value, explicit)
  return { value: value ?? fallback, presence, edited: false }
}

function draftsFromInstructions(instructions: Instructions): DraftValues {
  return {
    global: hostDraftField(instructions.globalCustomInstructions, instructions.globalCustomInstructionsPresence),
    personality: hostDraftField(instructions.advancedPersonalityInstructions, instructions.advancedPersonalityInstructionsPresence),
    preset: hostDraftField(instructions.personality, undefined, 'default'),
    about: hostDraftField(instructions.aboutUser),
    response: hostDraftField(instructions.responseStyle),
  }
}

function hostFieldForDraft(key: keyof DraftValues, instructions: Instructions): DraftField {
  if (key === 'global') return hostDraftField(instructions.globalCustomInstructions, instructions.globalCustomInstructionsPresence)
  if (key === 'personality') return hostDraftField(instructions.advancedPersonalityInstructions, instructions.advancedPersonalityInstructionsPresence)
  if (key === 'preset') return hostDraftField(instructions.personality, undefined, 'default')
  if (key === 'about') return hostDraftField(instructions.aboutUser)
  return hostDraftField(instructions.responseStyle)
}

function draftsDifferFromInstructions(drafts: DraftValues, instructions: Instructions): boolean {
  return (Object.keys(drafts) as Array<keyof DraftValues>).some((key) => {
    const draft = drafts[key]
    const host = hostFieldForDraft(key, instructions)
    return draft.edited || draft.value !== host.value || draft.presence !== host.presence
  })
}

type SaveInput = Parameters<InstructionBridge['save']>[0]

function buildSavePayload(drafts: DraftValues, expectedRevision: number): SaveInput {
  const payload: SaveInput = {
    expectedRevision,
    globalCustomInstructions: drafts.global.presence === 'unset' ? '' : drafts.global.value,
    advancedPersonalityInstructions: drafts.personality.presence === 'unset' ? '' : drafts.personality.value,
    globalCustomInstructionsPresence: drafts.global.presence,
    advancedPersonalityInstructionsPresence: drafts.personality.presence,
  }
  if (drafts.preset.presence !== 'unset') payload.personality = drafts.preset.value
  if (drafts.about.presence !== 'unset') payload.aboutUser = drafts.about.value
  if (drafts.response.presence !== 'unset') payload.responseStyle = drafts.response.value
  return payload
}

function nextDraftValue(current: DraftValues, key: keyof DraftValues, value: SetStateAction<string>): DraftValues {
  const currentField = current[key]
  const next = typeof value === 'function' ? value(currentField.value) : value
  return { ...current, [key]: { value: next, presence: inferredPresence(next), edited: true } }
}

function semanticValue(value: string | undefined, presence: InstructionPresence): string {
  if (presence === 'unset') return '（unset；沒有此欄位）'
  if (presence === 'blank') return '（explicit blank；欄位存在但內容為空白）'
  return value || '（value 為空；資料不完整）'
}

function conflictFields(conflict: GlobalConflict, drafts: DraftValues): ConflictField[] {
  const host = conflict.current
  const definitions: Array<{ key: keyof DraftValues; label: string; hostValue: string | undefined; hostPresence?: InstructionPresence }> = [
    { key: 'preset', label: 'personalityPreset', hostValue: host.personality },
    { key: 'about', label: 'aboutUser', hostValue: host.aboutUser },
    { key: 'response', label: 'responseStyle', hostValue: host.responseStyle },
    { key: 'global', label: 'globalCustomInstructions', hostValue: host.globalCustomInstructions, hostPresence: host.globalCustomInstructionsPresence },
    { key: 'personality', label: 'advancedPersonalityInstructions', hostValue: host.advancedPersonalityInstructions, hostPresence: host.advancedPersonalityInstructionsPresence },
  ]
  return definitions.flatMap((definition) => {
    const hostPresence = inferredPresence(definition.hostValue, definition.hostPresence)
    const localField = drafts[definition.key]
    if (hostPresence === localField.presence && (definition.hostValue || '') === localField.value) return []
    return [{ ...definition, hostPresence, localValue: localField.value, localPresence: localField.presence }]
  })
}

type ProjectionRefreshInput = {
  bridge?: InstructionBridge
  projectRoot?: string
  legacy: LegacyInput
  legacyPresence: { personality: boolean; aboutUser: boolean; responseStyle: boolean }
  cursorRef: MutableRefObject<InstructionProjectionCursor>
  savedRef: MutableRefObject<Instructions>
  draftsRef: MutableRefObject<DraftValues>
  projectionRef: MutableRefObject<Projection | null>
  isCurrent: () => boolean
  setSaved: Dispatch<SetStateAction<Instructions>>
  setDraftBaseRevision: Dispatch<SetStateAction<number>>
  setDrafts: Dispatch<SetStateAction<DraftValues>>
  setProjection: Dispatch<SetStateAction<Projection | null>>
  setStatus: (value: string) => void
  setGlobalConflict: Dispatch<SetStateAction<GlobalConflict | null>>
}

async function refreshInstructionProjection(input: ProjectionRefreshInput): Promise<boolean> {
  if (!input.bridge) {
    if (!input.isCurrent()) return false
    input.setStatus('目前是 browser compatibility 模式，Host-owned 個人化不可用。')
    return false
  }
  try {
    // Sequence the complete Host read transaction. Starting the cursor only
    // around resolve() lets an older refresh stalled in get() begin later and
    // overwrite a newer committed read with a mixed old-read/new-projection
    // result.
    const transaction = await requestInstructionProjection(
      input.cursorRef.current,
      async () => {
        const readiness = await readReadyLegacySource()
        if (!readiness.ready) throw new Error(`Legacy Hermes 尚未完成 authoritative read，migration 保留 pending：${readiness.error}`)
        const hostRead = await readCurrentInstructions(input)
        const projection = (await input.bridge!.resolve({ projectRoot: input.projectRoot, workPath: input.projectRoot })).instructionSnapshot
        return { revision: projection.revision, hostRead, projection }
      },
    )
    if (!input.isCurrent()) return false
    if (!transaction.accepted) return true
    const { hostRead, projection: next } = transaction.snapshot
    if (hostRead.migrationStatus) input.setStatus(`既有 Personalization / SOUL / internal AGENTS 遷移結果：${hostRead.migrationStatus}。backup 與 source hash 已和 marker 同 transaction 保存。`)
    const reconciliation = reconcileHostRevisionAndDraft(hostRead.instructions, input.savedRef.current, input.draftsRef.current)
    if (!reconciliation.accepted) {
      input.setStatus(reconciliation.status || 'Host revision reconciliation failed.')
      return false
    }
    if (!input.isCurrent()) return false
    input.savedRef.current = hostRead.instructions
    input.setSaved(hostRead.instructions)
    if (!reconciliation.preserveDirty) {
      input.setDraftBaseRevision(hostRead.instructions.revision)
      input.draftsRef.current = draftsFromInstructions(hostRead.instructions)
      input.setDrafts(input.draftsRef.current)
      input.setGlobalConflict(null)
    } else if (reconciliation.status) {
      input.setGlobalConflict({ current: hostRead.instructions, baseRevision: hostRead.instructions.revision })
      input.setStatus(reconciliation.status)
    }
    input.projectionRef.current = next
    input.setProjection(next)
    return true
  } catch (error) {
    if (!input.isCurrent()) return false
    input.setStatus(error instanceof Error ? error.message : '無法讀取個人化 Host projection。')
    return false
  }
}

function useInstructionProjection(input: {
  bridge?: InstructionBridge
  projectRoot?: string
  legacy: LegacyInput
  legacyPresence: { personality: boolean; aboutUser: boolean; responseStyle: boolean }
  setProjectEdit: Dispatch<SetStateAction<ProjectEdit | null>>
}) {
  const [saved, setSaved] = useState<Instructions>(emptyInstructions)
  const [draftBaseRevision, setDraftBaseRevision] = useState(0)
  const initialDrafts: DraftValues = draftsFromInstructions(emptyInstructions)
  const [drafts, setDrafts] = useState<DraftValues>(initialDrafts)
  const [projection, setProjection] = useState<Projection | null>(null)
  const [status, setStatus] = useState('')
  const [globalConflict, setGlobalConflict] = useState<GlobalConflict | null>(null)
  const projectionCursorRef = useRef(createInstructionProjectionCursor())
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null)
  const { bridge, projectRoot: selectedProjectRoot, legacy, legacyPresence, setProjectEdit } = input
  const projectRootRef = useRef(selectedProjectRoot || '')
  const savedRef = useRef(saved)
  const projectionRef = useRef<Projection | null>(null)
  const draftsRef = useRef(initialDrafts)
  const generationRef = useRef(0)
  const legacyRef = useRef(legacy)
  const legacyPresenceRef = useRef(legacyPresence)
  legacyRef.current = legacy
  legacyPresenceRef.current = legacyPresence
  const legacyFingerprint = JSON.stringify({ legacy, legacyPresence })
  const updateDrafts = useCallback((next: SetStateAction<DraftValues>) => {
    updateDraftStateAtomically(draftsRef, setDrafts, next)
  }, [])
  const setGlobalDraft = useCallback((value: SetStateAction<string>) => updateDrafts((current) => nextDraftValue(current, 'global', value)), [updateDrafts])
  const setPersonalityDraft = useCallback((value: SetStateAction<string>) => updateDrafts((current) => nextDraftValue(current, 'personality', value)), [updateDrafts])
  const setPresetDraft = useCallback((value: SetStateAction<string>) => updateDrafts((current) => nextDraftValue(current, 'preset', value)), [updateDrafts])
  const setAboutDraft = useCallback((value: SetStateAction<string>) => updateDrafts((current) => nextDraftValue(current, 'about', value)), [updateDrafts])
  const setResponseDraft = useCallback((value: SetStateAction<string>) => updateDrafts((current) => nextDraftValue(current, 'response', value)), [updateDrafts])
  const isCurrent = useCallback((root: string, generation: number) => projectRootRef.current === root && generationRef.current === generation, [])
  const refresh = useCallback(async () => {
    const rootAtStart = selectedProjectRoot || ''
    const generationAtStart = generationRef.current
    const run = refreshInstructionProjection({
      bridge,
      projectRoot: selectedProjectRoot,
      legacy: legacyRef.current,
      legacyPresence: legacyPresenceRef.current,
      cursorRef: projectionCursorRef,
      savedRef,
      draftsRef,
      projectionRef,
      isCurrent: () => isCurrent(rootAtStart, generationAtStart),
      setSaved,
      setDraftBaseRevision,
      setDrafts: updateDrafts,
      setProjection,
      setStatus,
      setGlobalConflict,
    })
    refreshInFlightRef.current = run
    try { return await run } finally {
      if (refreshInFlightRef.current === run) refreshInFlightRef.current = null
    }
  }, [bridge, isCurrent, selectedProjectRoot, updateDrafts])

  useEffect(() => { savedRef.current = saved }, [saved])
  useEffect(() => {
    const nextRoot = selectedProjectRoot || ''
    if (projectRootRef.current === nextRoot) return
    projectRootRef.current = nextRoot
    generationRef.current += 1
    invalidateInstructionProjection(projectionCursorRef.current)
    projectionRef.current = null
    setProjection(null)
    setProjectEdit(null)
  }, [selectedProjectRoot, setProjectEdit])
  useEffect(() => { void refresh() }, [legacyFingerprint, refresh])
  useEffect(() => {
    const unsubscribe = window.subagents?.piHost?.onEvent?.((event) => {
      const revision = Number((event as { payload?: { revision?: unknown } }).payload?.revision)
      if (event.event === 'instruction/changed') observeInstructionProjectionEvent(projectionCursorRef.current, revision, () => { void refresh() })
    })
    return () => { unsubscribe?.() }
  }, [refresh])
  useEffect(() => {
    if (!bridge || typeof document === 'undefined') return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 3_000)
    return () => window.clearInterval(timer)
  }, [bridge, refresh])
  const discardGlobalDraft = useCallback(() => {
    if (!globalConflict) return
    const current = globalConflict.current
    updateDrafts(draftsFromInstructions(current))
    setDraftBaseRevision(current.revision)
    savedRef.current = current
    setSaved(current)
    setGlobalConflict(null)
    setStatus('已載入 Host 版本；本地草稿已捨棄。')
  }, [globalConflict, updateDrafts])
  const rebaseGlobalDraft = useCallback(() => {
    if (!globalConflict) return
    setDraftBaseRevision(globalConflict.current.revision)
    setGlobalConflict(null)
    setStatus(`已以 Host revision ${globalConflict.current.revision} 為基底保留本地草稿；儲存時會建立新的 CAS commit。`)
  }, [globalConflict])
  return {
    saved, setSaved, draftBaseRevision, setDraftBaseRevision, drafts, updateDrafts, globalDraft: drafts.global.value, setGlobalDraft,
    personalityDraft: drafts.personality.value, setPersonalityDraft, presetDraft: drafts.preset.value, setPresetDraft,
    aboutDraft: drafts.about.value, setAboutDraft, responseDraft: drafts.response.value, setResponseDraft,
    projection, setProjection, status, setStatus, globalConflict, setGlobalConflict, discardGlobalDraft, rebaseGlobalDraft, refresh,
    refreshInFlightRef, projectRootRef, savedRef, projectionRef, draftsRef, projectionCursorRef,
  }
}

type InstructionSource = Projection['sources'][number]

type GlobalInstructionSectionProps = {
  bridge?: InstructionBridge
  busy: boolean
  dirty: boolean
  saved: Instructions
  projection: Projection | null
  status: string
  globalConflict: GlobalConflict | null
  draftValues: DraftValues
  globalDraft: string
  personalityDraft: string
  presetDraft: string
  aboutDraft: string
  responseDraft: string
  draftPersonalizationBytes: number
  globalSources: InstructionSource[]
  exportArmed: boolean
  importCandidate: { bundle: unknown; preview: ImportPreview } | null
  setGlobalDraft: Dispatch<SetStateAction<string>>
  setPersonalityDraft: Dispatch<SetStateAction<string>>
  setPresetDraft: Dispatch<SetStateAction<string>>
  setAboutDraft: Dispatch<SetStateAction<string>>
  setResponseDraft: Dispatch<SetStateAction<string>>
  setExportArmed: Dispatch<SetStateAction<boolean>>
  setImportCandidate: Dispatch<SetStateAction<{ bundle: unknown; preview: ImportPreview } | null>>
  onSave: () => Promise<void>
  onExport: () => Promise<void>
  onPreviewImport: (file: File | undefined) => Promise<void>
  onApplyImport: () => Promise<void>
  onDiscardGlobalDraft: () => void
  onRebaseGlobalDraft: () => void
}

function GlobalSnapshotDetails({ projection, saved, status, draftPersonalizationBytes }: {
  projection: Projection | null
  saved: Instructions
  status: string
  draftPersonalizationBytes: number
}) {
  return <div className="px-4 py-3 text-[11px] leading-relaxed text-on-surface-variant" aria-live="polite">
    <p>目前 committed revision {saved.revision} · hash {saved.hash ? saved.hash.slice(0, 12) : '尚無'}</p>
    {projection && <div
      className="mt-2 break-all"
      aria-label="Host instruction snapshot"
      data-projection-ready="true"
      data-host-revision={String(projection.revision)}
      data-host-snapshot-id={projection.id}
    >
      <p className="text-on-surface">Host instruction snapshot {projection.id}</p>
      <p>revision {projection.revision} · effective hash {projection.effectiveHash}</p>
      <p>delivery mode {deliveryModeLabel(projection.deliveryMode)} · {projection.exactSnapshot ? 'exact snapshot' : 'exact text 未獲證明'}</p>
      <p>budget：global personalization {projection.usage.personalizationBytes}/{projection.usage.personalizationBudgetBytes ?? projection.usage.budgetBytes} B · project instructions {projection.usage.projectInstructionBytes}/{projection.usage.projectInstructionBudgetBytes ?? projection.usage.budgetBytes} B · total {projection.usage.totalBytes}/{projection.usage.budgetBytes} B</p>
    </div>}
    {projection && <p className="mt-1">
      Context pressure：草稿正文約 {draftPersonalizationBytes} B；Host global personalization slot {projection.usage.personalizationBytes}/{projection.usage.personalizationBudgetBytes ?? projection.usage.budgetBytes} B（{contextPressure(projection.usage.personalizationBytes, projection.usage.personalizationBudgetBytes ?? projection.usage.budgetBytes)}）。實際值包含 Host headings 與 authorized includes，儲存／重新掃描後更新。
    </p>}
    {status && <p className="mt-1 text-on-surface">{status}</p>}
  </div>
}

function ConflictValue({ field, side }: { field: ConflictField; side: 'Host' | '本地' }) {
  const value = side === 'Host' ? field.hostValue : field.localValue
  const presence = side === 'Host' ? field.hostPresence : field.localPresence
  return <div
    role="region"
    tabIndex={0}
    aria-label={`${field.label} ${side}內容`}
    onKeyDown={(event) => {
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' '].includes(event.key)) return
      event.preventDefault()
      const delta = event.key === 'ArrowUp' || event.key === 'PageUp' ? -Math.max(40, event.currentTarget.clientHeight * 0.8) : Math.max(40, event.currentTarget.clientHeight * 0.8)
      event.currentTarget.scrollTop = Math.max(0, Math.min(event.currentTarget.scrollHeight - event.currentTarget.clientHeight, event.currentTarget.scrollTop + delta))
    }}
    className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-outline/40 p-2 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  >
    <p className="mb-1 font-medium">{side} · {field.label} · {presence}</p>
    <pre className="whitespace-pre-wrap break-all">{semanticValue(value, presence)}</pre>
  </div>
}

function GlobalConflictPanel({ conflict, drafts, busy, onDiscard, onRebase }: {
  conflict: GlobalConflict | null
  drafts: DraftValues
  busy: boolean
  onDiscard: () => void
  onRebase: () => void
}) {
  if (!conflict) return null
  const fields = conflictFields(conflict, drafts)
  return <div className="mx-4 my-2 space-y-3 border-l-2 border-danger pl-3 text-[12px]" role="alert" aria-label="Global instruction conflict">
    <p className="font-medium text-on-surface">Host revision {conflict.current.revision} 與本地未儲存草稿衝突</p>
    <p className="text-on-surface-variant">請在下方比較 Host 與本地內容，再選擇載入 Host 或以 Host revision 重基；不會自動覆蓋本地草稿。載入 Host 會捨棄以下所有差異欄位；重基會保留所有本地差異欄位並以 Host revision 作為 CAS 基底。</p>
    {fields.map((field) => <div key={field.key} className="space-y-2" data-conflict-field={field.key}>
      <p className="font-medium text-on-surface">{field.label}</p>
      <ConflictValue field={field} side="Host" />
      <ConflictValue field={field} side="本地" />
    </div>)}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={settingsBtnCls} disabled={busy} onClick={onDiscard}>載入 Host 版本（捨棄本地草稿）</button>
      <button type="button" className={settingsBtnPrimaryCls} disabled={busy} onClick={onRebase}>以 Host revision 為基底保留草稿</button>
    </div>
  </div>
}

function GlobalSourceList({ sources }: { sources: InstructionSource[] }) {
  return <>{sources.map((source, index) => (
    <div key={source.id + index} data-source-id={source.id} data-source-kind={source.kind} data-source-scope={source.scope} data-include-depth={source.includeDepth ?? 0} data-parent-path={source.parentPath || ''} style={{ paddingInlineStart: `${16 + Math.min(source.includeDepth ?? 0, 8) * 12}px` }} className="px-4 py-3">
      <p className="text-[12px] font-medium text-on-surface">{sourceLabel(source)}</p>
      {source.path && <p className="mt-1 break-all text-[11px] text-outline">{source.path}</p>}
      {source.parentPath && <p className="mt-1 break-all text-[11px] text-on-surface-variant">由 {source.parentPath} include</p>}
      <p className="mt-1 text-[11px] text-on-surface-variant">source revision {source.revision} · {sourceBytes(source)} · {sourceStatus(source)} · dropped {source.droppedBytes} B · hash {source.hash.slice(0, 12)}{source.metadataStatus !== 'content' ? ` · metadata ${source.metadataStatus}` : ''}{source.truncated ? ' · 已裁切' : ''}</p>
    </div>
  ))}</>
}

function BackupMigrationControls({ bridge, busy, exportArmed, importCandidate, setExportArmed, setImportCandidate, onExport, onPreviewImport, onApplyImport }: {
  bridge?: InstructionBridge
  busy: boolean
  exportArmed: boolean
  importCandidate: { bundle: unknown; preview: ImportPreview } | null
  setExportArmed: Dispatch<SetStateAction<boolean>>
  setImportCandidate: Dispatch<SetStateAction<{ bundle: unknown; preview: ImportPreview } | null>>
  onExport: () => Promise<void>
  onPreviewImport: (file: File | undefined) => Promise<void>
  onApplyImport: () => Promise<void>
}) {
  return <SettingsStack title="備份與移轉" description="匯出只包含 global personalization；project instruction 檔案仍由 filesystem 擁有，不會被打包。匯入一定先顯示 preview，確認後才 commit。">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={settingsBtnCls} disabled={!bridge || busy} onClick={() => void onExport()}>{exportArmed ? '確認匯出 plaintext JSON' : '匯出 JSON'}</button>
      {exportArmed && <button type="button" className={settingsBtnCls} onClick={() => setExportArmed(false)}>取消匯出</button>}
      <label className={settingsBtnCls} role="button" tabIndex={0} onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.currentTarget.querySelector<HTMLInputElement>('input')?.click()
      }}>
        選擇匯入檔
        <input aria-label="選擇個人化匯入檔" className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void onPreviewImport(event.target.files?.[0])} />
      </label>
      {importCandidate && !['invalid', 'conflict'].includes(importCandidate.preview.status) && (
        <button type="button" className={settingsBtnPrimaryCls} disabled={busy} onClick={() => void onApplyImport()}>確認套用 {importCandidate.preview.status}</button>
      )}
      {importCandidate && <button type="button" className={settingsBtnCls} onClick={() => setImportCandidate(null)}>取消預覽</button>}
    </div>
  </SettingsStack>
}

function GlobalInstructionSection({
  bridge, busy, dirty, saved, projection, status, globalConflict, draftValues, globalDraft, personalityDraft, presetDraft, aboutDraft, responseDraft,
  draftPersonalizationBytes, globalSources, exportArmed, importCandidate, setGlobalDraft, setPersonalityDraft,
  setPresetDraft, setAboutDraft, setResponseDraft, setExportArmed, setImportCandidate, onSave, onExport,
  onPreviewImport, onApplyImport, onDiscardGlobalDraft, onRebaseGlobalDraft,
}: GlobalInstructionSectionProps) {
  return (
    <SettingsGroup
      title="全域指令"
      action={<button type="button" className={settingsBtnPrimaryCls} disabled={!dirty || busy || !bridge} onClick={() => void onSave()}>{busy ? '儲存中…' : '儲存 revision'}</button>}
    >
      <SettingsStack title="預設人格" description="改變語氣，不改變模型能力或權限。">
        <select aria-label="預設人格" className={settingsInputCls} value={presetDraft} onChange={(event) => setPresetDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          const current = personalityPresetValues.indexOf(presetDraft as typeof personalityPresetValues[number])
          const delta = event.key === 'ArrowDown' ? 1 : -1
          const next = (current + delta + personalityPresetValues.length) % personalityPresetValues.length
          setPresetDraft(personalityPresetValues[next])
        }}>
          <option value="default">預設</option><option value="none">無（中性）</option><option value="friendly">友善</option><option value="efficient">務實精簡</option><option value="professional">專業</option><option value="candid">直率</option><option value="quirky">俏皮</option>
        </select>
      </SettingsStack>
      <SettingsStack title="關於你" description="職業、專案、偏好語言與常用工具。">
        <textarea aria-label="關於你" className={`${settingsInputCls} min-h-[96px] resize-y`} value={aboutDraft} onChange={(event) => setAboutDraft(event.target.value)} />
      </SettingsStack>
      <SettingsStack title="希望如何回覆" description="結構、語言與程式碼風格。">
        <textarea aria-label="希望如何回覆" className={`${settingsInputCls} min-h-[96px] resize-y`} value={responseDraft} onChange={(event) => setResponseDraft(event.target.value)} />
      </SettingsStack>
      <SettingsStack title="自訂指令" description="套用至每個新 Task run。這是跨專案預設，不能改寫 managed policy、核准或工具權限。">
        <textarea aria-label="全域自訂指令" className={`${settingsInputCls} min-h-[180px] resize-y`} value={globalDraft} onChange={(event) => setGlobalDraft(event.target.value)} placeholder="例如：所有回覆使用繁體中文。可用一整行 @/absolute/local/file 引用本機規則。" />
      </SettingsStack>
      <SettingsStack title="進階人格指令" description="只定義穩定語氣與表達方式，與行為規則、能力及權限分開。">
        <textarea aria-label="進階人格指令" className={`${settingsInputCls} min-h-[112px] resize-y`} value={personalityDraft} onChange={(event) => setPersonalityDraft(event.target.value)} />
      </SettingsStack>
      <GlobalSnapshotDetails projection={projection} saved={saved} status={status} draftPersonalizationBytes={draftPersonalizationBytes} />
      <GlobalConflictPanel conflict={globalConflict} drafts={draftValues} busy={busy} onDiscard={onDiscardGlobalDraft} onRebase={onRebaseGlobalDraft} />
      <GlobalSourceList sources={globalSources} />
      <BackupMigrationControls bridge={bridge} busy={busy} exportArmed={exportArmed} importCandidate={importCandidate} setExportArmed={setExportArmed} setImportCandidate={setImportCandidate} onExport={onExport} onPreviewImport={onPreviewImport} onApplyImport={onApplyImport} />
    </SettingsGroup>
  )
}

type ProjectInstructionSectionProps = {
  projectRoot?: string
  busy: boolean
  projection: Projection | null
  projectSources: InstructionSource[]
  rootEditableSource: InstructionSource | undefined
  projectEdit: ProjectEdit | null
  setProjectEdit: Dispatch<SetStateAction<ProjectEdit | null>>
  onRefresh: () => Promise<boolean>
  onCreate: () => void
  onEdit: (source: InstructionSource) => Promise<void>
  onOpen: (path: string) => Promise<void>
  onAuthorize: (target: string) => Promise<void>
  onReloadExternal: () => Promise<void>
  onSave: () => Promise<void>
}

function ProjectInstructionSection({
  projectRoot, busy, projection, projectSources, rootEditableSource, projectEdit, setProjectEdit,
  onRefresh, onCreate, onEdit, onOpen, onAuthorize, onReloadExternal, onSave,
}: ProjectInstructionSectionProps) {
  return (
    <SettingsGroup
      title="目前專案指令"
      action={projectRoot ? <div className="flex flex-wrap gap-2">
        <button type="button" className={settingsBtnCls} disabled={busy} onClick={() => void onRefresh()}>重新掃描</button>
        {!rootEditableSource && <button type="button" className={settingsBtnCls} onClick={onCreate}>建立 AGENTS.md</button>}
      </div> : undefined}
    >
      <div className="px-4 py-3 text-[12px] leading-relaxed text-on-surface-variant">
        <p>組裝順序由全域到較近目錄，當前請求最後送入。衝突 authority 則相反：較近的 project override 高於 project instructions，再高於全域預設與 learned memory。</p>
        {projection && <p className="mt-2">lower-authority remainder {projection.usage.lowerAuthorityAvailableBytes ?? Math.max(0, projection.usage.budgetBytes - projection.usage.totalBytes)} B；source rows below are Host metadata, including include parent/depth and effective order.</p>}
      </div>
      {projectSources.length ? projectSources.map((source, index) => (
        <div key={source.id + index} data-source-id={source.id} data-source-kind={source.kind} data-source-scope={source.scope} data-include-depth={source.includeDepth ?? 0} data-parent-path={source.parentPath || ''} style={{ paddingInlineStart: `${16 + Math.min(source.includeDepth ?? 0, 8) * 12}px` }} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-on-surface">{sourceLabel(source)}{source.shadowed ? '（被同層較高優先來源取代）' : ''}</p>
            <p className="mt-1 break-all text-[11px] text-outline">{source.path}</p>
            {source.parentPath && <p className="mt-1 break-all text-[11px] text-on-surface-variant">由 {source.parentPath} include</p>}
            <p className="mt-1 text-[11px] text-on-surface-variant">scope {source.scope} · {sourceLayer(source)} · source revision {source.revision} · {sourceBytes(source)} · {sourceStatus(source)} · dropped {source.droppedBytes} B · hash {source.hash.slice(0, 12)}{source.metadataStatus !== 'content' ? ` · metadata ${source.metadataStatus}` : ''}{source.truncated ? ' · 已裁切' : ''}</p>
          </div>
          {source.path && <div className="flex flex-wrap justify-end gap-2">
            {!source.truncated && source.directoryDepth === 0 && source.openable && source.metadataStatus === 'content' && ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].includes(sourceFileName(source) || '') && (
              <button type="button" className={settingsBtnCls} onClick={() => void onEdit(source)}>編輯</button>
            )}
            {sourceCanOpen(source) && <button type="button" className={settingsBtnCls} onClick={() => void onOpen(source.path!)}>在編輯器開啟</button>}
            {sourceOpenability(source) && <span className="text-[11px] text-on-surface-variant" role="status">{sourceOpenability(source)}</span>}
          </div>}
        </div>
      )) : (
        <div className="px-4 py-4 text-[12px] text-on-surface-variant">{projectRoot ? '此 project root 尚未找到 instruction file。建立檔案必須由明確 create action 進行。' : '先選擇專案，才能發現 filesystem-owned instructions。'}</div>
      )}
      {projection?.diagnostics.map((diagnostic, index) => (
        <div key={`${diagnostic.code}-${index}`} className="px-4 py-3 text-[12px] text-danger" role="status">
          {diagnostic.code}：{diagnostic.message}{diagnostic.path ? ` · ${diagnostic.path}` : ''}
          {diagnostic.code === 'unauthorized' && diagnostic.path?.startsWith('/') && (
            <button type="button" className={`${settingsBtnCls} ml-2`} disabled={busy} onClick={() => void onAuthorize(diagnostic.path!)}>授權這個 exact target</button>
          )}
        </div>
      ))}
      {projectEdit && (
        <div className="px-4 py-4">
          <label className="block text-[13px] font-medium text-on-surface" htmlFor="project-instruction-editor">{projectEdit.target}</label>
          <p className="mt-1 text-[11px] text-on-surface-variant">Save 使用 observed hash CAS；外部編輯器若已更新，這份 draft 會收到 conflict，不會覆寫較新檔案。</p>
          <textarea id="project-instruction-editor" className={`${settingsInputCls} mt-3 min-h-[180px] resize-y`} value={projectEdit.content} onChange={(event) => setProjectEdit((current) => current ? { ...current, content: event.target.value } : current)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={settingsBtnPrimaryCls} disabled={busy} onClick={() => void onSave()}>Atomic save</button>
            <button type="button" className={settingsBtnCls} disabled={busy} onClick={() => void onReloadExternal()}>重新載入外部版本</button>
            <button type="button" className={settingsBtnCls} onClick={() => setProjectEdit(null)}>取消</button>
          </div>
        </div>
      )}
    </SettingsGroup>
  )
}

export function PersonalizationInstructionsSection({
  projectRoot,
  legacy,
}: {
  projectRoot?: string
  legacy: { personality?: string; aboutUser?: string; responseStyle?: string; soul?: string; agents?: string }
}) {
  const bridge = window.subagents?.piHost?.instructions
  const [projectEdit, setProjectEdit] = useState<ProjectEdit | null>(null)
  const {
    saved, setSaved, draftBaseRevision, setDraftBaseRevision, drafts, updateDrafts, globalDraft, setGlobalDraft,
    personalityDraft, setPersonalityDraft, presetDraft, setPresetDraft, aboutDraft, setAboutDraft,
    responseDraft, setResponseDraft, projection, status, setStatus, globalConflict, setGlobalConflict,
    discardGlobalDraft, rebaseGlobalDraft, refresh,
    refreshInFlightRef, projectRootRef, savedRef, projectionRef, projectionCursorRef,
  } = useInstructionProjection({
    bridge,
    projectRoot,
    legacy,
    legacyPresence: {
      personality: Object.prototype.hasOwnProperty.call(legacy, 'personality'),
      aboutUser: Object.prototype.hasOwnProperty.call(legacy, 'aboutUser'),
      responseStyle: Object.prototype.hasOwnProperty.call(legacy, 'responseStyle'),
    },
    setProjectEdit,
  })
  const [busy, setBusy] = useState(false)
  const [importCandidate, setImportCandidate] = useState<{ bundle: unknown; preview: ImportPreview } | null>(null)
  const [exportArmed, setExportArmed] = useState(false)

  const dirty = draftsDifferFromInstructions(drafts, saved)
  const draftPersonalizationBytes = useMemo(() => new TextEncoder().encode([
    drafts.global.value,
    drafts.personality.value,
    drafts.preset.value,
    drafts.about.value,
    drafts.response.value,
  ].join('\n')).byteLength, [drafts.about.value, drafts.global.value, drafts.personality.value, drafts.preset.value, drafts.response.value])
  const projectSources = useMemo(() => projection?.sources.filter((source) => source.scope === 'project') || [], [projection])
  const globalSources = useMemo(() => projection?.sources.filter((source) => source.scope === 'global') || [], [projection])

  const save = async () => {
    if (!bridge || busy || !dirty) return
    setBusy(true)
    setStatus('')
    let next: Instructions
    try {
      next = (await bridge.save(buildSavePayload(drafts, draftBaseRevision))).instructions
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '儲存失敗，前一個 committed revision 保持有效。')
      setBusy(false)
      return
    }
    savedRef.current = next
    setSaved(next)
    setDraftBaseRevision(next.revision)
    updateDrafts(draftsFromInstructions(next))
    setGlobalConflict(null)
    setStatus('已由 Host transaction commit。新的指令從下一個 Task run 生效。')
    const refreshed = await refresh()
    if (!refreshed && projectRootRef.current === (projectRoot || '')) {
      setStatus(`Global revision ${next.revision} 已 commit，但 projection 刷新失敗；目前 committed data 仍有效。`)
    }
    setBusy(false)
  }

  const openSource = async (path: string) => {
    if (!projectRoot) return
    try {
      const result = await window.subagents?.piHost?.instructions?.openSource?.({ projectRoot, workPath: projectRoot, path })
      if (result?.ok) setStatus(`已開啟 canonical instruction source：${result.path}`)
      else if (result) setStatus(result.error || '無法開啟 instruction source。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '無法開啟 instruction source。')
    }
  }

  const readEditableProjectSource = async (source: Projection['sources'][number], rootAtRequest: string, requestSequence: number) => {
    if (!bridge?.projectRead) throw new Error('Host project-read contract 不可用。')
    const target = sourceFileName(source)
    if (!target || !['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].includes(target)) throw new Error('目前 source 不可編輯。')
    const read = await bridge.projectRead({ projectRoot: rootAtRequest, workPath: rootAtRequest, target: target as 'AGENTS.md' | 'AGENTS.override.md' | 'CLAUDE.md' })
    const current = projectionRef.current
      if (projectRootRef.current !== rootAtRequest
        || projectRoot !== rootAtRequest
        || projectionCursorRef.current.latestRequestSequence !== requestSequence
        || !current?.projectIdentity
        || !current.sources.some((candidate) => candidate.id === source.id && candidate.path === source.path && candidate.hash === source.hash)) {
      throw new Error('project projection 已更新；捨棄舊 source read 結果。')
    }
    if (read.path !== source.path) throw new Error('Host project-read identity 與目前 projection 不一致。')
    return { target: target as 'AGENTS.md' | 'AGENTS.override.md' | 'CLAUDE.md', read }
  }

  const editProjectSource = async (source: Projection['sources'][number]) => {
    if (!bridge?.projectRead || !projectRoot || busy) return
    const requestSequence = projectionCursorRef.current.latestRequestSequence
    const rootAtRequest = projectRoot
    setBusy(true)
    try {
      const { target, read } = await readEditableProjectSource(source, rootAtRequest, requestSequence)
      setProjectEdit({ target, expectedHash: read.hash, content: read.content })
      setStatus(`已從 Host 讀取 ${target} revision/hash；可編輯後 Atomic save。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Host project source read 失敗；draft 未變更。')
    } finally { setBusy(false) }
  }

  const authorizeInclude = async (target: string) => {
    if (!bridge?.authorizeInclude || busy) return
    setBusy(true)
    try {
      await bridge.authorizeInclude(target)
      setStatus(`已持久授權 exact canonical include target：${target}。下一個 run 生效。`)
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Include authorization 失敗。')
    } finally { setBusy(false) }
  }

  const reloadExternalProjectVersion = async () => {
    if (!projectEdit || busy) return
    const editAtRequest = projectEdit
    const rootAtRequest = projectRoot
    setBusy(true)
    try {
      await refresh()
      // A Host filesystem observation emits an instruction/changed event,
      // whose refresh may race this request. Await that newer projection before
      // selecting the editable source; otherwise the old draft can be loaded
      // while the event-driven refresh is still in flight.
      const followUp = refreshInFlightRef.current
      if (followUp) await followUp
      if (projectRootRef.current !== (rootAtRequest || '') || projectRoot !== rootAtRequest) {
        setStatus('project 已切換；捨棄舊 project 的 external reload 結果。')
        return
      }
      const current = projectionRef.current
      const source = current?.sources.find((candidate) =>
        candidate.scope === 'project'
        && candidate.directoryDepth === 0
        && sourceFileName(candidate) === editAtRequest.target
        && candidate.metadataStatus === 'content'
        && candidate.openable
        && (candidate.applied || candidate.shadowed),
      )
      if (!source) {
        setStatus('無法重新載入目前 external project version；draft 保留，原檔未修改。')
        return
      }
      const requestSequence = projectionCursorRef.current.latestRequestSequence
      const { read } = await readEditableProjectSource(source, rootAtRequest || '', requestSequence)
      setProjectEdit({ ...editAtRequest, expectedHash: read.hash, content: read.content })
      setStatus(`已重新載入 external ${projectEdit.target} revision/hash；可檢查內容後再儲存。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '重新載入 external project version 失敗；draft 保留。')
    } finally { setBusy(false) }
  }

  const saveProject = async () => {
    if (!bridge || !projectRoot || !projectEdit || busy) return
    setBusy(true)
    try {
      const result = await bridge.projectWrite({ projectRoot, ...projectEdit })
      if (!result.ok) {
        setStatus(`${result.error.code}：${result.error.message}`)
        setBusy(false)
        return
      }
    } catch (error) {
      const typed = error as { code?: unknown; message?: unknown }
      const code = typeof typed.code === 'string' ? `${typed.code}：` : ''
      setStatus(`${code}${typeof typed.message === 'string' ? typed.message : 'Project instruction 儲存失敗，原檔保持不變。'}`)
      setBusy(false)
      return
    }
    setProjectEdit(null)
    setStatus('Project instruction 已 atomic commit。既有 run 維持 frozen snapshot，下一個 run 生效。')
    const refreshed = await refresh()
    if (!refreshed) setStatus('Project instruction 已 atomic commit，但 projection 刷新失敗；請重新掃描。')
    setBusy(false)
  }

  const exportInstructions = async () => {
    if (!bridge) return
    if (!exportArmed) {
      setExportArmed(true)
      setStatus('匯出檔是可讀的 plaintext JSON，可能包含個人偏好與敏感背景。確認保存位置安全後，再按一次「確認匯出」。')
      return
    }
    const { bundle } = await bridge.exportBundle()
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `agentstudio-personalization-r${bundle.snapshot.revision}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setExportArmed(false)
    setStatus('已匯出全域個人化。Project instruction bodies 不會進入匯出檔。')
  }

  const previewImport = async (file: File | undefined) => {
    if (!bridge || !file) return
    try {
      const bundle = JSON.parse(await file.text()) as unknown
      const { preview } = await bridge.previewImport(bundle)
      setImportCandidate({ bundle, preview })
      setStatus(preview.message || `匯入預覽：${preview.status}，本機 revision ${preview.localRevision}${preview.incomingRevision === undefined ? '' : `，匯入 revision ${preview.incomingRevision}`}。`)
    } catch (error) {
      setImportCandidate(null)
      setStatus(error instanceof Error ? error.message : '無法讀取匯入檔。')
    }
  }

  const applyImport = async () => {
    if (!bridge || !importCandidate || busy) return
    setBusy(true)
    try {
      await bridge.applyImport(importCandidate.bundle, saved.revision)
      setImportCandidate(null)
      await refresh()
      setStatus('匯入已 atomic commit。重複套用同一 bundle 不會新增 revision。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '匯入失敗，原 revision 保持有效。')
    } finally { setBusy(false) }
  }

  const rootEditableSource = projectSources.find((source) => source.directoryDepth === 0 && source.path && ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].includes(sourceFileName(source) || ''))

  return (
    <>
      <GlobalInstructionSection
        bridge={bridge}
        busy={busy}
        dirty={dirty}
        saved={saved}
        projection={projection}
        status={status}
        globalConflict={globalConflict}
        draftValues={drafts}
        globalDraft={globalDraft}
        personalityDraft={personalityDraft}
        presetDraft={presetDraft}
        aboutDraft={aboutDraft}
        responseDraft={responseDraft}
        draftPersonalizationBytes={draftPersonalizationBytes}
        globalSources={globalSources}
        exportArmed={exportArmed}
        importCandidate={importCandidate}
        setGlobalDraft={setGlobalDraft}
        setPersonalityDraft={setPersonalityDraft}
        setPresetDraft={setPresetDraft}
        setAboutDraft={setAboutDraft}
        setResponseDraft={setResponseDraft}
        setExportArmed={setExportArmed}
        setImportCandidate={setImportCandidate}
        onSave={save}
        onExport={exportInstructions}
        onPreviewImport={previewImport}
        onApplyImport={applyImport}
        onDiscardGlobalDraft={discardGlobalDraft}
        onRebaseGlobalDraft={rebaseGlobalDraft}
      />

      <ProjectInstructionSection
        projectRoot={projectRoot}
        busy={busy}
        projection={projection}
        projectSources={projectSources}
        rootEditableSource={rootEditableSource}
        projectEdit={projectEdit}
        setProjectEdit={setProjectEdit}
        onRefresh={refresh}
        onCreate={() => setProjectEdit({ target: 'AGENTS.md', expectedHash: '', content: '# Project instructions\n' })}
        onEdit={editProjectSource}
        onOpen={openSource}
        onAuthorize={authorizeInclude}
        onReloadExternal={reloadExternalProjectVersion}
        onSave={saveProject}
      />
    </>
  )
}
