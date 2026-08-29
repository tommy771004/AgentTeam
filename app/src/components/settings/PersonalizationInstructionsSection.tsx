import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createInstructionProjectionCursor,
  invalidateInstructionProjection,
} from '../../agent/instructionProjectionCursor.ts'
import {
  observeInstructionProjectionEvent,
  requestInstructionProjection,
} from '../../agent/instructionProjectionUpdate.ts'
import type { InstructionDeliveryMode } from '../../agent/instructionSnapshot.ts'
import { SettingsGroup, SettingsStack, settingsBtnCls, settingsBtnPrimaryCls, settingsInputCls } from './SettingsChrome'

type Projection = Awaited<ReturnType<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']['resolve']>>['instructionSnapshot']
type Instructions = Awaited<ReturnType<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']['get']>>['instructions']
type ImportPreview = Awaited<ReturnType<NonNullable<NonNullable<typeof window.subagents>['piHost']>['instructions']['previewImport']>>['preview']

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

export function PersonalizationInstructionsSection({
  projectRoot,
  legacy,
}: {
  projectRoot?: string
  legacy: { personality?: string; aboutUser?: string; responseStyle?: string; soul?: string; agents?: string }
}) {
  const bridge = window.subagents?.piHost?.instructions
  const legacyPersonality = legacy.personality
  const legacyAboutUser = legacy.aboutUser
  const legacyResponseStyle = legacy.responseStyle
  const legacySoul = legacy.soul
  const legacyAgents = legacy.agents
  const legacyHasPersonality = Object.prototype.hasOwnProperty.call(legacy, 'personality')
  const legacyHasAboutUser = Object.prototype.hasOwnProperty.call(legacy, 'aboutUser')
  const legacyHasResponseStyle = Object.prototype.hasOwnProperty.call(legacy, 'responseStyle')
  const [saved, setSaved] = useState<Instructions>(emptyInstructions)
  const [draftBaseRevision, setDraftBaseRevision] = useState(0)
  const [globalDraft, setGlobalDraft] = useState('')
  const [personalityDraft, setPersonalityDraft] = useState('')
  const [presetDraft, setPresetDraft] = useState('default')
  const [aboutDraft, setAboutDraft] = useState('')
  const [responseDraft, setResponseDraft] = useState('')
  const [projection, setProjection] = useState<Projection | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [importCandidate, setImportCandidate] = useState<{ bundle: unknown; preview: ImportPreview } | null>(null)
  const [exportArmed, setExportArmed] = useState(false)
  const [projectEdit, setProjectEdit] = useState<{ target: 'AGENTS.md' | 'AGENTS.override.md' | 'CLAUDE.md'; expectedHash: string; content: string } | null>(null)
  const projectionCursorRef = useRef(createInstructionProjectionCursor())
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null)
  const projectRootRef = useRef(projectRoot || '')
  const savedRef = useRef(saved)
  const projectionRef = useRef<Projection | null>(null)
  const draftsRef = useRef({ global: '', personality: '', preset: 'default', about: '', response: '' })
  useEffect(() => { savedRef.current = saved }, [saved])
  useEffect(() => { draftsRef.current = { global: globalDraft, personality: personalityDraft, preset: presetDraft, about: aboutDraft, response: responseDraft } }, [aboutDraft, globalDraft, personalityDraft, presetDraft, responseDraft])

  // A project switch changes the authority boundary. Clear the old filesystem
  // projection immediately so a failed or slow resolve cannot present the
  // previous project's sources as if they belonged to the newly selected root.
  useEffect(() => {
    const nextRoot = projectRoot || ''
    if (projectRootRef.current === nextRoot) return
    projectRootRef.current = nextRoot
    invalidateInstructionProjection(projectionCursorRef.current)
    projectionRef.current = null
    setProjection(null)
    setProjectEdit(null)
  }, [projectRoot])

  const refresh = useCallback(async () => {
    const run = (async () => {
    if (!bridge) { setStatus('目前是 browser compatibility 模式，Host-owned 個人化不可用。'); return false }
    try {
      const { useLearningStore } = await import('../../store/learningStore.ts')
      if (!useLearningStore.getState().loaded) await useLearningStore.getState().load()
      const { getLegacyInstructionHydration } = await import('../../agent/hermes/promptBuilder.ts')
      let readiness = getLegacyInstructionHydration()
      if (readiness.status === 'failed') {
        await useLearningStore.getState().reloadLegacyInstructionSource()
        readiness = getLegacyInstructionHydration()
      }
      if (readiness.status !== 'ready') {
        setStatus(`Legacy Hermes 尚未完成 authoritative read，migration 保留 pending：${readiness.error || 'hydrating'}`)
        return false
      }
      let current = (await bridge.get()).instructions
      const shouldMigrate = current.revision === 0 && Boolean(
        legacySoul?.trim()
        || legacyAgents?.trim()
        || legacySoul !== undefined
        || legacyAgents !== undefined
        || legacyHasPersonality
        || legacyHasAboutUser
        || legacyHasResponseStyle,
      )
      if (shouldMigrate) {
        const migrated = await bridge.migrateLegacy({
          ...(legacyAgents !== undefined ? { agents: legacyAgents } : {}),
          ...(legacySoul !== undefined ? { soul: legacySoul } : {}),
          ...(legacyPersonality !== undefined ? { personality: legacyPersonality } : {}),
          ...(legacyAboutUser !== undefined ? { aboutUser: legacyAboutUser } : {}),
          ...(legacyResponseStyle !== undefined ? { responseStyle: legacyResponseStyle } : {}),
        })
        current = migrated.instructions
        setStatus(`既有 Personalization / SOUL / internal AGENTS 遷移結果：${migrated.instructionMigrationReport.status}。backup 與 source hash 已和 marker 同 transaction 保存。`)
      }
      const nextResult = await requestInstructionProjection(
        projectionCursorRef.current,
        async () => (await bridge.resolve({ projectRoot, workPath: projectRoot })).instructionSnapshot,
      )
      if (!nextResult.accepted) return true
      const next = nextResult.snapshot
      const previous = savedRef.current
      const drafts = draftsRef.current
      if (current.revision < previous.revision) {
        setStatus(`Host 回傳較舊的 committed revision ${current.revision}；保留目前 revision ${previous.revision} projection。`)
        return false
      }
      const preserveDirty = drafts.global !== previous.globalCustomInstructions
        || drafts.personality !== previous.advancedPersonalityInstructions
        || drafts.preset !== (previous.personality || 'default')
        || drafts.about !== (previous.aboutUser || '')
        || drafts.response !== (previous.responseStyle || '')
      savedRef.current = current
      setSaved(current)
      if (!preserveDirty) {
        setDraftBaseRevision(current.revision)
        setGlobalDraft(current.globalCustomInstructions)
        setPersonalityDraft(current.advancedPersonalityInstructions)
        setPresetDraft(current.personality || 'default')
        setAboutDraft(current.aboutUser || '')
        setResponseDraft(current.responseStyle || '')
      } else if (current.revision !== previous.revision) {
        setStatus('Host 已有較新的 revision。你的未儲存草稿已保留；儲存時會以 CAS 顯示 conflict，請先重新載入比較。')
      }
      projectionRef.current = next
      setProjection(next)
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '無法讀取個人化 Host projection。')
      return false
    }
    })()
    refreshInFlightRef.current = run
    try { return await run } finally {
      if (refreshInFlightRef.current === run) refreshInFlightRef.current = null
    }
  }, [bridge, legacyAboutUser, legacyAgents, legacyHasAboutUser, legacyHasPersonality, legacyHasResponseStyle, legacyPersonality, legacyResponseStyle, legacySoul, projectRoot])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const unsubscribe = window.subagents?.piHost?.onEvent?.((event) => {
      const revision = Number((event as { payload?: { revision?: unknown } }).payload?.revision)
      if (event.event === 'instruction/changed'
        ) observeInstructionProjectionEvent(projectionCursorRef.current, revision, () => { void refresh() })
    })
    return () => { unsubscribe?.() }
  }, [refresh])

  useEffect(() => {
    if (!bridge || typeof document === 'undefined') return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 3_000)
    return () => window.clearInterval(timer)
  }, [bridge, refresh])

  const dirty = globalDraft !== saved.globalCustomInstructions
    || personalityDraft !== saved.advancedPersonalityInstructions
    || presetDraft !== (saved.personality || 'default')
    || aboutDraft !== (saved.aboutUser || '')
    || responseDraft !== (saved.responseStyle || '')
  const draftPersonalizationBytes = useMemo(() => new TextEncoder().encode([
    globalDraft,
    personalityDraft,
    presetDraft,
    aboutDraft,
    responseDraft,
  ].join('\n')).byteLength, [aboutDraft, globalDraft, personalityDraft, presetDraft, responseDraft])
  const projectSources = useMemo(() => projection?.sources.filter((source) => source.scope === 'project') || [], [projection])
  const globalSources = useMemo(() => projection?.sources.filter((source) => source.scope === 'global') || [], [projection])

  const save = async () => {
    if (!bridge || busy || !dirty) return
    setBusy(true)
    setStatus('')
    let next: Instructions
    try {
      next = (await bridge.save({
        expectedRevision: draftBaseRevision,
        globalCustomInstructions: globalDraft,
        advancedPersonalityInstructions: personalityDraft,
        personality: presetDraft,
        aboutUser: aboutDraft,
        responseStyle: responseDraft,
      })).instructions
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '儲存失敗，前一個 committed revision 保持有效。')
      setBusy(false)
      return
    }
    savedRef.current = next
    setSaved(next)
    setDraftBaseRevision(next.revision)
    setStatus('已由 Host transaction commit。新的指令從下一個 Task run 生效。')
    try {
      const refreshedResult = await requestInstructionProjection(
        projectionCursorRef.current,
        async () => (await bridge.resolve({ projectRoot, workPath: projectRoot })).instructionSnapshot,
      )
      if (refreshedResult.accepted) {
        const refreshed = refreshedResult.snapshot
        projectionRef.current = refreshed
        setProjection(refreshed)
        setStatus('已由 Host transaction commit。新的指令從下一個 Task run 生效。')
      }
    } catch (error) {
      setStatus(`Global revision ${next.revision} 已 commit，但 projection 刷新失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
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
      <SettingsGroup
        title="全域指令"
        action={<button type="button" className={settingsBtnPrimaryCls} disabled={!dirty || busy || !bridge} onClick={() => void save()}>{busy ? '儲存中…' : '儲存 revision'}</button>}
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
        <div className="px-4 py-3 text-[11px] leading-relaxed text-on-surface-variant" aria-live="polite">
          <p>目前 committed revision {saved.revision} · hash {saved.hash ? saved.hash.slice(0, 12) : '尚無'}</p>
          {projection && <div className="mt-2 break-all" aria-label="Host instruction snapshot">
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
        {globalSources.map((source, index) => (
          <div key={source.id + index} data-source-id={source.id} data-source-kind={source.kind} data-source-scope={source.scope} data-include-depth={source.includeDepth ?? 0} data-parent-path={source.parentPath || ''} style={{ paddingInlineStart: `${16 + Math.min(source.includeDepth ?? 0, 8) * 12}px` }} className="px-4 py-3">
            <p className="text-[12px] font-medium text-on-surface">{sourceLabel(source)}</p>
            {source.path && <p className="mt-1 break-all text-[11px] text-outline">{source.path}</p>}
            {source.parentPath && <p className="mt-1 break-all text-[11px] text-on-surface-variant">由 {source.parentPath} include</p>}
            <p className="mt-1 text-[11px] text-on-surface-variant">source revision {source.revision} · {sourceBytes(source)} · {sourceStatus(source)} · dropped {source.droppedBytes} B · hash {source.hash.slice(0, 12)}{source.metadataStatus !== 'content' ? ` · metadata ${source.metadataStatus}` : ''}{source.truncated ? ' · 已裁切' : ''}</p>
          </div>
        ))}
        <SettingsStack title="備份與移轉" description="匯出只包含 global personalization；project instruction 檔案仍由 filesystem 擁有，不會被打包。匯入一定先顯示 preview，確認後才 commit。">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={settingsBtnCls} disabled={!bridge || busy} onClick={() => void exportInstructions()}>{exportArmed ? '確認匯出 plaintext JSON' : '匯出 JSON'}</button>
            {exportArmed && <button type="button" className={settingsBtnCls} onClick={() => setExportArmed(false)}>取消匯出</button>}
            <label
              className={settingsBtnCls}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.currentTarget.querySelector<HTMLInputElement>('input')?.click()
              }}
            >
              選擇匯入檔
              <input aria-label="選擇個人化匯入檔" className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void previewImport(event.target.files?.[0])} />
            </label>
            {importCandidate && !['invalid', 'conflict'].includes(importCandidate.preview.status) && (
              <button type="button" className={settingsBtnPrimaryCls} disabled={busy} onClick={() => void applyImport()}>確認套用 {importCandidate.preview.status}</button>
            )}
            {importCandidate && <button type="button" className={settingsBtnCls} onClick={() => setImportCandidate(null)}>取消預覽</button>}
          </div>
        </SettingsStack>
      </SettingsGroup>

      <SettingsGroup
        title="目前專案指令"
        action={projectRoot ? <div className="flex flex-wrap gap-2">
          <button type="button" className={settingsBtnCls} disabled={busy} onClick={() => void refresh()}>重新掃描</button>
          {!rootEditableSource && <button type="button" className={settingsBtnCls} onClick={() => setProjectEdit({ target: 'AGENTS.md', expectedHash: '', content: '# Project instructions\n' })}>建立 AGENTS.md</button>}
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
                <button type="button" className={settingsBtnCls} onClick={() => void editProjectSource(source)}>編輯</button>
              )}
              {sourceCanOpen(source) && <button type="button" className={settingsBtnCls} onClick={() => void openSource(source.path!)}>在編輯器開啟</button>}
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
              <button type="button" className={`${settingsBtnCls} ml-2`} disabled={busy} onClick={() => void authorizeInclude(diagnostic.path!)}>授權這個 exact target</button>
            )}
          </div>
        ))}
        {projectEdit && (
          <div className="px-4 py-4">
            <label className="block text-[13px] font-medium text-on-surface" htmlFor="project-instruction-editor">{projectEdit.target}</label>
            <p className="mt-1 text-[11px] text-on-surface-variant">Save 使用 observed hash CAS；外部編輯器若已更新，這份 draft 會收到 conflict，不會覆寫較新檔案。</p>
            <textarea id="project-instruction-editor" className={`${settingsInputCls} mt-3 min-h-[180px] resize-y`} value={projectEdit.content} onChange={(event) => setProjectEdit((current) => current ? { ...current, content: event.target.value } : current)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={settingsBtnPrimaryCls} disabled={busy} onClick={() => void saveProject()}>Atomic save</button>
              <button type="button" className={settingsBtnCls} disabled={busy} onClick={() => void reloadExternalProjectVersion()}>重新載入外部版本</button>
              <button type="button" className={settingsBtnCls} onClick={() => setProjectEdit(null)}>取消</button>
            </div>
          </div>
        )}
      </SettingsGroup>
    </>
  )
}
