import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import { SettingsHeader } from '../components/settings/SettingsChrome'
import { useLearningStore, type InstalledSkill } from '../store/learningStore'
import { useAgentStore } from '../store/agentStore'
import { PluginMarketplace } from '../components/PluginMarketplace'
import { useProjectStore } from '../store/projectStore'
import { buildLearningExportPlan } from '../agent/hermes/learningExport'
import { failedSkillMigrations, useSkillMigrationStore } from '../store/skillMigrationStore'
import { pushSkillsToHost } from '../agent/hermes/skillHostSync'
import { MemoryImportPanel } from '../components/MemoryImportPanel'
import type { MemoryEntry } from '../agent/hermes/types'

const SECTIONS = [
  { id: 'memory', label: '持久記憶', icon: 'psychology' },
  { id: 'skills', label: '技能庫', icon: 'auto_awesome' },
  { id: 'drafts', label: '學習草稿', icon: 'rate_review' },
  { id: 'search', label: '跨會話搜尋', icon: 'manage_search' },
  { id: 'plugins', label: '擴充能力', icon: 'extension' },
]

function SkillPinButton({
  name,
  pinned,
  pin,
  unpin,
}: {
  name: string
  pinned: boolean
  pin: (name: string) => Promise<void>
  unpin: (name: string) => Promise<void>
}) {
  if (pinned) {
    return (
      <button type="button" onClick={() => void unpin(name)} className="text-xs text-outline hover:text-on-surface">
        取消釘選
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void pin(name)}
      className="text-xs text-primary"
      title="釘選後每次執行都會自動展開到系統提示，不需關鍵字匹配"
    >
      釘選（自動載入）
    </button>
  )
}

const SKILL_SOURCE_LABEL: Record<InstalledSkill['source'], string> = {
  agentstudio: 'AgentStudio',
  project: '專案',
  user: '本機',
  system: '系統',
}

const SKILL_SOURCE_ICON: Record<InstalledSkill['source'], string> = {
  agentstudio: 'auto_awesome',
  project: 'folder_open',
  user: 'extension',
  system: 'settings_suggest',
}

function projectVisibleSkills(input: {
  catalog: InstalledSkill[]
  query: string
  scope: string
  showAllInstalled: boolean
}): { normalizedQuery: string; scopedMatches: InstalledSkill[]; visibleSkills: InstalledSkill[] } {
  const normalizedQuery = input.query.trim().toLocaleLowerCase()
  const queryMatches = input.catalog.filter((skill) => !normalizedQuery
    || `${skill.meta.name} ${skill.meta.description} ${skill.scope}`.toLocaleLowerCase().includes(normalizedQuery))
  const scopedMatches = input.scope === 'all'
    ? queryMatches
    : queryMatches.filter((skill) => `${skill.source}:${skill.scope}` === input.scope)
  const visibleSkills = input.scope === 'all' && !normalizedQuery && !input.showAllInstalled
    ? scopedMatches.slice(0, 6)
    : scopedMatches
  return { normalizedQuery, scopedMatches, visibleSkills }
}

function SkillLibrary({
  catalog,
  diagnostics,
  projectRoot,
  saveSkill,
  pinSkill,
  unpinSkill,
  restoreSkill,
  removeSkill,
  reload,
  exportSkills,
  exportStatus,
}: {
  catalog: InstalledSkill[]
  diagnostics: Array<{ path: string; message: string }>
  projectRoot?: string
  saveSkill: (name: string, description: string, body: string) => Promise<void>
  pinSkill: (name: string) => Promise<void>
  unpinSkill: (name: string) => Promise<void>
  restoreSkill: (name: string) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  reload: (projectRoot?: string) => Promise<void>
  exportSkills: () => void
  exportStatus: string
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [showAllInstalled, setShowAllInstalled] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newBody, setNewBody] = useState('')

  const scopeOptions = [...new Map(catalog.map((skill) => [`${skill.source}:${skill.scope}`, {
    id: `${skill.source}:${skill.scope}`,
    label: skill.scope,
  }])).values()]
  const { normalizedQuery, scopedMatches, visibleSkills } = projectVisibleSkills({
    catalog,
    query,
    scope,
    showAllInstalled,
  })
  const selected = catalog.find((skill) => skill.meta.name === selectedName)

  useEffect(() => {
    setSelectedName(null)
  }, [query, scope])

  const mutate = async (operation: () => Promise<void>) => {
    await operation()
    await reload(projectRoot)
  }

  const create = async () => {
    if (!newName.trim() || !newBody.trim()) return
    await mutate(() => saveSkill(newName.trim(), newDescription.trim(), newBody.trim()))
    setNewName('')
    setNewDescription('')
    setNewBody('')
    setShowCreate(false)
    setSelectedName(newName.trim())
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-medium tracking-tight text-on-surface">技能</h2>
          <p className="mt-1 text-sm text-outline">用任務專用技能擴充 AgentStudio</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportSkills} className="rounded-lg px-3 py-2 text-xs text-outline hover:bg-white/5 hover:text-on-surface">
            匯出技能
          </button>
          <button type="button" onClick={() => setShowCreate((value) => !value)} className="rounded-lg bg-primary/15 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20">
            {showCreate ? '取消新增' : '新增技能'}
          </button>
        </div>
      </div>

      <label className="flex h-12 items-center gap-3 rounded-full border border-white/15 bg-white/[0.055] px-4 text-outline focus-within:border-primary/55 focus-within:text-on-surface">
        <Icon name="search" size={21} />
        <span className="sr-only">搜尋技能</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋技能"
          className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-outline"
        />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="清除搜尋"><Icon name="close" size={18} /></button>}
      </label>

      {showCreate && (
        <section className="app-panel space-y-3 p-4" aria-label="新增技能">
          <div className="grid gap-3 md:grid-cols-2">
            <input className={input} placeholder="技能名稱" value={newName} onChange={(event) => setNewName(event.target.value)} />
            <input className={input} placeholder="簡短描述" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
          </div>
          <textarea className={`${input} min-h-36 font-[family-name:var(--font-mono)]`} placeholder="SKILL.md 指引內容" value={newBody} onChange={(event) => setNewBody(event.target.value)} />
          <div className="flex justify-end"><button type="button" onClick={() => void create()} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary">建立技能</button></div>
        </section>
      )}

      <section aria-labelledby="installed-skills-title">
        <div className="mb-3 flex items-center justify-between">
          <h3 id="installed-skills-title" className="text-sm font-semibold text-on-surface">{scope === 'all' ? '已安裝' : scopeOptions.find((option) => option.id === scope)?.label || '已安裝'}</h3>
          <span className="text-xs text-outline">{scopedMatches.length} / {catalog.length}</span>
        </div>
        {visibleSkills.length ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2" role="listbox" aria-label="已安裝技能">
            {visibleSkills.map((skill) => {
              const active = selected?.meta.name === skill.meta.name
              return (
                <button
                  key={`${skill.source}:${skill.path}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedName(active ? null : skill.meta.name)}
                  className={`group flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${active ? 'bg-white/8' : 'hover:bg-white/[0.045]'}`}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-black/20 text-outline"><Icon name={SKILL_SOURCE_ICON[skill.source]} size={22} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-on-surface">{skill.meta.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-outline">{skill.meta.description || '沒有描述'}</span>
                  </span>
                  <Icon name={skill.readOnly ? 'lock' : 'check'} size={19} className="shrink-0 text-outline/80" />
                </button>
              )
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-outline">找不到符合條件的技能。</p>
        )}
        {scope === 'all' && !normalizedQuery && scopedMatches.length > 6 && (
          <button type="button" onClick={() => setShowAllInstalled((value) => !value)} className="mt-3 text-xs text-outline hover:text-on-surface">
            {showAllInstalled ? '收起完整清單' : `查看另外 ${scopedMatches.length - 6} 項`}
          </button>
        )}
      </section>

      <div className="flex gap-1 overflow-x-auto border-b border-white/8 pb-2 custom-scrollbar" role="tablist" aria-label="技能來源">
        <button type="button" role="tab" aria-selected={scope === 'all'} onClick={() => setScope('all')} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${scope === 'all' ? 'bg-white/8 text-on-surface' : 'text-outline hover:text-on-surface'}`}>全部</button>
        {scopeOptions.map((option) => (
          <button key={option.id} type="button" role="tab" aria-selected={scope === option.id} onClick={() => setScope(option.id)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${scope === option.id ? 'bg-white/8 text-on-surface' : 'text-outline hover:text-on-surface'}`}>{option.label}</button>
        ))}
      </div>

      {selected && (
        <section className="app-panel space-y-4 p-5" aria-label={`${selected.meta.name} 詳細資料`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-on-surface">{selected.meta.name}</h3>
                <span className="rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-outline">{SKILL_SOURCE_LABEL[selected.source]} · {selected.scope}</span>
                {selected.readOnly && <span className="rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-outline">唯讀</span>}
              </div>
              <p className="mt-1 text-xs text-outline">{selected.meta.description || '沒有描述'}</p>
              <p className="mt-2 break-all font-[family-name:var(--font-mono)] text-[10px] text-outline/80">{selected.path}</p>
            </div>
            {selected.managed && (
              <div className="flex items-center gap-3">
                {selected.meta.status === 'archived' ? (
                  <button type="button" onClick={() => void mutate(() => restoreSkill(selected.meta.name))} className="text-xs text-primary">復原技能</button>
                ) : (
                  <SkillPinButton name={selected.meta.name} pinned={selected.meta.status === 'pinned'} pin={(name) => mutate(() => pinSkill(name))} unpin={(name) => mutate(() => unpinSkill(name))} />
                )}
                <button type="button" onClick={() => void mutate(() => removeSkill(selected.meta.name)).then(() => setSelectedName(null))} className="text-xs text-error">刪除</button>
              </div>
            )}
          </div>
          <details className="rounded-lg border border-white/10 bg-surface px-3 py-2">
            <summary className="cursor-pointer text-xs text-outline">查看 SKILL.md</summary>
            <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap text-[12px] text-on-surface-variant custom-scrollbar font-[family-name:var(--font-mono)]">{selected.raw}</pre>
          </details>
        </section>
      )}

      {diagnostics.length > 0 && (
        <details className="text-xs text-outline">
          <summary className="cursor-pointer">{diagnostics.length} 個技能載入提示</summary>
          <ul className="mt-2 space-y-1 pl-4">{diagnostics.slice(0, 20).map((item, index) => <li key={`${item.path}:${index}`}>{item.message}{item.path ? ` · ${item.path}` : ''}</li>)}</ul>
        </details>
      )}
      {exportStatus && <p className="text-xs text-outline">{exportStatus}</p>}
    </div>
  )
}

const SECTION_IDS = new Set(SECTIONS.map((s) => s.id))

function LearningMemoryScopeBar() {
  const projection = useLearningStore((state) => state.memoryProjection)
  const setScope = useLearningStore((state) => state.setMemoryScope)
  const projectRoot = useProjectStore((state) => state.root)
  const chooseProject = () => {
    if (projectRoot) void setScope({ kind: 'project', project: projectRoot })
  }
  useEffect(() => {
    if (projection.scope.kind === 'project' && projectRoot && projection.scope.project !== projectRoot) {
      void setScope({ kind: 'project', project: projectRoot })
    }
  }, [projectRoot, projection.scope, setScope])
  return (
    <>
      <div className="app-panel px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold">記憶範圍</div>
          <div className="text-[10px] text-outline">{projection.error ? '長期記憶 unavailable；目前數字不是 canonical count' : `Host revision ${projection.revision} · ${projection.total} 筆`}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void setScope({ kind: 'global' })} className={`px-3 py-1.5 rounded-lg text-xs ${projection.scope.kind === 'global' ? 'bg-primary/20 text-primary' : 'text-outline hover:bg-white/5'}`}>全域</button>
          <button type="button" disabled={!projectRoot} onClick={chooseProject} className={`px-3 py-1.5 rounded-lg text-xs disabled:opacity-40 ${projection.scope.kind === 'project' ? 'bg-primary/20 text-primary' : 'text-outline hover:bg-white/5'}`}>目前專案</button>
        </div>
      </div>
      {projection.error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{projection.error}</div>}
    </>
  )
}

function LearningMemoryPagination() {
  const projection = useLearningStore((state) => state.memoryProjection)
  const next = useLearningStore((state) => state.nextMemoryPage)
  const previous = useLearningStore((state) => state.previousMemoryPage)
  const disabled = memoryControlsDisabled(projection)
  return (
    <div className="flex items-center justify-end gap-2 text-[10px]">
      <button type="button" disabled={!projection.previousCursors.length || disabled} onClick={() => void previous()} className="px-2 py-1 rounded border border-white/10 disabled:opacity-30">上一頁</button>
      <button type="button" disabled={!projection.nextCursor || disabled} onClick={() => void next()} className="px-2 py-1 rounded border border-white/10 disabled:opacity-30">下一頁</button>
    </div>
  )
}

function requestMemoryEdit(id: string, text: string, update: (id: string, text: string) => Promise<void>) {
  const next = window.prompt('編輯記憶', text)
  if (next === null || next.trim() === text.trim()) return
  void update(id, next).catch(() => undefined)
}

function memoryControlsDisabled(projection: { loading: boolean; error: string | null }): boolean {
  return projection.loading || Boolean(projection.error)
}

function LearningMemoryEntries({ error, entries, update, remove }: {
  error: string | null
  entries: MemoryEntry[]
  update: (id: string, text: string) => Promise<void>
  remove: (id: string) => Promise<void>
}) {
  if (error) return <p className="text-xs text-error">無法讀取 canonical memory；已停用寫入，不會把 unavailable 當成 0 筆。</p>
  return <ul className="text-sm text-on-surface-variant space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
    {entries.map((entry) => (
      <li key={entry.id} className="border-b border-white/5 py-1 flex items-start gap-2">
        <span className="min-w-0 flex-1"><span className="text-[10px] text-outline font-[family-name:var(--font-mono)]">{entry.createdAt.slice(0, 16)}</span>{' '}{entry.text}</span>
        <span className="flex gap-2 shrink-0">
          <button type="button" className="text-[10px] text-primary" onClick={() => requestMemoryEdit(entry.id, entry.text, update)}>編輯</button>
          <button type="button" className="text-[10px] text-error" onClick={() => void remove(entry.id).catch(() => undefined)}>刪除</button>
        </span>
      </li>
    ))}
  </ul>
}

async function canonicalMemoryExportFile(): Promise<{
  file?: ReturnType<typeof buildLearningExportPlan>[number]
  status?: string
}> {
  const exportBundle = window.subagents?.piHost?.memoryProjection?.exportBundle
  if (!exportBundle) {
    return { status: '目前執行環境不支援 Host canonical memory export；未產生空白或 legacy 匯出檔。' }
  }
  if (!window.confirm('記憶匯出檔包含 plaintext user data，未加密。要繼續嗎？')) {
    return { status: '已取消記憶匯出。' }
  }
  try {
    const bundle = await exportBundle()
    return { file: {
      kind: 'memory',
      relativePath: '.subagents/memory/durable-memory-v1.json',
      content: `${JSON.stringify(bundle, null, 2)}\n`,
    } }
  } catch (error) {
    return { status: `Host 記憶匯出失敗：${error instanceof Error ? error.message : String(error)}` }
  }
}

const META: Record<string, { title: string; subtitle: string }> = {
  memory: { title: '持久記憶', subtitle: 'USER / MEMORY · 跨 session 保留。' },
  skills: { title: '技能', subtitle: '用任務專用技能擴充 AgentStudio。' },
  drafts: { title: '學習草稿', subtitle: '成功執行後自動產生的技能草稿。' },
  search: { title: '跨會話搜尋', subtitle: '在記憶、技能與封存中檢索。' },
  plugins: {
    title: '擴充能力',
    subtitle: '連線授權後，在「新任務」直接下指令即可。',
  },
}

export function LearningPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') || 'memory'
  const section = SECTION_IDS.has(tabParam) ? tabParam : 'memory'
  const setSection = (id: string) => {
    setParams(id === 'memory' ? {} : { tab: id })
  }
  const {
    load,
    memory,
    memoryProjection,
    skills,
    skillCatalog,
    skillDiagnostics,
    events,
    pendingDrafts,
    searchHits,
    searchSummary,
    setUserProfile,
    setMemoryDoc,
    appendMemory,
    updateMemoryEntry,
    deleteMemoryEntry,
    approveDraft,
    rejectDraft,
    search,
    saveSkill,
    pinSkill,
    unpinSkill,
    restoreSkill,
    removeSkill,
    loadSkillCatalog,
  } = useLearningStore()
  const archive = useAgentStore((s) => s.archive)
  const loadArchive = useAgentStore((s) => s.loadArchive)
  const knowledge = useAgentStore((s) => s.agent.knowledge)
  const projectRoot = useProjectStore((s) => s.root)
  const memoryDisabled = memoryControlsDisabled(memoryProjection)

  const [userEdit, setUserEdit] = useState('')
  const [memEdit, setMemEdit] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [exportStatus, setExportStatus] = useState('')

  useEffect(() => {
    void load()
    void loadArchive()
  }, [load, loadArchive])

  useEffect(() => {
    if (section === 'skills') void loadSkillCatalog(projectRoot)
  }, [loadSkillCatalog, projectRoot, section])

  useEffect(() => {
    setUserEdit(memory.userProfile)
    setMemEdit(memory.memory)
  }, [memory.userProfile, memory.memory])


  const meta = META[section] || META.memory

  const exportLearning = async (kind: 'skill' | 'memory' | 'knowledge') => {
    let files = buildLearningExportPlan({ skills, knowledge }).filter((file) => file.kind === kind)
    if (kind === 'memory') {
      const canonical = await canonicalMemoryExportFile()
      if (!canonical.file) {
        setExportStatus(canonical.status || 'Host 記憶匯出失敗。')
        return
      }
      files = [canonical.file]
    }
    if (!files.length) {
      setExportStatus('目前沒有可匯出的資料。')
      return
    }
    if (!projectRoot) {
      setExportStatus('請先選擇 project root，匯出會寫入該專案的 .subagents/。')
      return
    }
    const api = window.subagents?.learning?.export
    if (!api) {
      for (const file of files) {
        const blob = new Blob([file.content], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = file.relativePath.split('/').pop() || 'learning-export.md'
        anchor.click()
        URL.revokeObjectURL(url)
      }
      setExportStatus(`瀏覽器模式已下載 ${files.length} 個檔案（無法直接寫入 project root）。`)
      return
    }
    let overwrite = false
    let written = 0
    for (const file of files) {
      let result = await api({ relativePath: file.relativePath, content: file.content, projectRoot })
      if (!result.ok && result.exists && !overwrite) {
        overwrite = window.confirm('部分學習檔案已存在。要覆寫這批匯出檔嗎？')
        if (!overwrite) break
        result = await api({ relativePath: file.relativePath, content: file.content, projectRoot, overwrite: true })
      }
      if (!result.ok) {
        setExportStatus(`匯出中止：${result.error || file.relativePath}`)
        return
      }
      written += 1
    }
    setExportStatus(`已匯出 ${written}/${files.length} 個檔案至專案 .subagents/。`)
  }

  return (
    <ThemePage
      title="學習中心"
      sections={SECTIONS}
      activeId={section}
      onChange={setSection}
      narrow={section !== 'plugins' && section !== 'skills'}
      immersive={section === 'plugins'}
    >
      {section !== 'plugins' && section !== 'skills' && <SettingsHeader title={meta.title} subtitle={meta.subtitle} />}
      {section !== 'plugins' && section !== 'skills' && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[10px] text-outline">Project learning export</span>
          <button type="button" onClick={() => void exportLearning('skill')} className="px-2.5 py-1.5 rounded border border-primary/30 text-primary text-[10px] font-semibold">匯出技能</button>
          <button type="button" onClick={() => void exportLearning('memory')} className="px-2.5 py-1.5 rounded border border-secondary/30 text-secondary text-[10px] font-semibold">匯出記憶</button>
          <button type="button" onClick={() => void exportLearning('knowledge')} className="px-2.5 py-1.5 rounded border border-tertiary/30 text-tertiary text-[10px] font-semibold">匯出 entities</button>
          {exportStatus && <span className="text-[10px] text-on-surface-variant">{exportStatus}</span>}
        </div>
      )}
      <div className="flex flex-col gap-4">
        {section === 'memory' && (
          <div className="space-y-4">
            <LearningMemoryScopeBar />
            <MemoryImportPanel />
            <div className="app-panel p-5 space-y-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Icon name="person" size={18} className="text-primary" />
                USER.md — 使用者檔案
              </h2>
              <textarea
                className={ta}
                rows={5}
                value={userEdit}
                onChange={(e) => setUserEdit(e.target.value)}
                placeholder="偏好、專案、環境…（跨 session 保留）"
              />
              <button
                type="button"
                disabled={memoryDisabled}
                onClick={() => void setUserProfile(userEdit).catch(() => undefined)}
                className="px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold"
              >
                儲存使用者檔案
              </button>
            </div>
            <div className="app-panel p-5 space-y-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Icon name="menu_book" size={18} className="text-secondary" />
                MEMORY.md — 長期記憶
              </h2>
              <textarea
                className={ta}
                rows={8}
                value={memEdit}
                onChange={(e) => setMemEdit(e.target.value)}
              />
              <button
                type="button"
                disabled={memoryDisabled}
                onClick={() => void setMemoryDoc(memEdit).catch(() => undefined)}
                className="px-3 py-2 rounded-lg border border-primary/40 text-primary text-xs font-semibold"
              >
                儲存記憶文件
              </button>
            </div>
            <div className="app-panel p-5 space-y-3">
              <h2 className="font-semibold text-sm">快速追加一則記憶</h2>
              <div className="flex gap-2">
                <input
                  className={input}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：使用者偏好繁中回覆、報告用表格…"
                />
                <button
                  type="button"
                  disabled={memoryDisabled}
                  onClick={() => {
                    if (!note.trim()) return
                    void appendMemory(note.trim()).then(() => setNote('')).catch(() => undefined)
                  }}
                  className="px-3 py-2 rounded-lg bg-primary/20 text-primary text-xs font-semibold shrink-0"
                >
                  追加
                </button>
              </div>
              <LearningMemoryEntries error={memoryProjection.error} entries={memory.entries} update={updateMemoryEntry} remove={deleteMemoryEntry} />
              <LearningMemoryPagination />
            </div>
          </div>
        )}

        {section === 'skills' && <SkillMigrationDiagnostics />}
        {section === 'skills' && (
          <SkillLibrary
            catalog={skillCatalog}
            diagnostics={skillDiagnostics}
            projectRoot={projectRoot || undefined}
            saveSkill={saveSkill}
            pinSkill={pinSkill}
            unpinSkill={unpinSkill}
            restoreSkill={restoreSkill}
            removeSkill={removeSkill}
            reload={loadSkillCatalog}
            exportSkills={() => void exportLearning('skill')}
            exportStatus={exportStatus}
          />
        )}

        {section === 'drafts' && (
          <div className="space-y-3">
            <p className="text-sm text-on-surface-variant">
              Goal-based 成功後，學習迴圈會自動產生技能草稿（Hermes 風格）。請人工核准後才進入技能庫。
            </p>
            {pendingDrafts.length === 0 ? (
              <div className="app-panel p-8 text-center text-outline text-sm">
                尚無草稿。完成一次目標導向執行後再回來。
              </div>
            ) : (
              pendingDrafts.map((d) => (
                <div key={d.name} className="app-panel p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-primary">{d.name}</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void approveDraft(d.name)}
                        className="px-3 py-1.5 rounded bg-primary-container text-on-primary-container text-xs font-semibold"
                      >
                        核准
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectDraft(d.name)}
                        className="px-3 py-1.5 rounded border border-error/30 text-error text-xs font-semibold"
                      >
                        拒絕
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-on-surface-variant">{d.description}</p>
                  <pre className="bg-surface border border-white/10 rounded p-2 text-[11px] font-[family-name:var(--font-mono)] max-h-40 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                    {d.body}
                  </pre>
                </div>
              ))
            )}
            <div className="app-panel p-4">
              <h3 className="text-sm font-semibold mb-2">學習事件</h3>
              <ul className="text-xs space-y-1 max-h-48 overflow-y-auto custom-scrollbar text-on-surface-variant">
                {events.length === 0 && <li className="text-outline">尚無事件</li>}
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="text-outline font-[family-name:var(--font-mono)]">
                      {e.at.slice(11, 19)}
                    </span>{' '}
                    <span className="text-secondary">[{e.type}]</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {section === 'search' && (
          <div className="app-panel p-5 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Icon name="manage_search" size={18} className="text-primary" />
              跨會話搜尋（封存 · 記憶 · 技能）
            </h2>
            <div className="flex gap-2">
              <input
                className={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="關鍵字…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') search(query, archive)
                }}
              />
              <button
                type="button"
                onClick={() => search(query, archive)}
                className="px-4 py-2 rounded-lg bg-primary/20 text-primary text-xs font-semibold shrink-0"
              >
                搜尋
              </button>
            </div>
            {searchSummary && (
              <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-3 text-sm text-on-surface-variant">
                <div className="text-xs font-semibold text-secondary mb-1">LLM 關聯摘要</div>
                {searchSummary}
              </div>
            )}
            <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
              {searchHits.length === 0 ? (
                <p className="text-sm text-outline">輸入關鍵字搜尋歷史與記憶。</p>
              ) : (
                searchHits.map((h) => (
                  <div
                    key={`${h.source}-${h.id}`}
                    className="border border-white/10 rounded-lg p-3 bg-surface/40"
                  >
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-secondary font-semibold">
                        {h.source === 'archive'
                          ? '封存'
                          : h.source === 'memory'
                            ? '記憶'
                            : '技能'}
                      </span>
                      <span className="text-on-surface font-medium truncate">{h.title}</span>
                      <span className="text-outline ml-auto">score {h.score}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">{h.snippet}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {section === 'plugins' && <PluginMarketplace />}

      </div>
    </ThemePage>
  )
}

const input =
  'w-full bg-surface border border-white/10 focus:border-secondary rounded-lg px-3 py-2 text-sm outline-none'
const ta =
  'w-full bg-surface border border-white/10 focus:border-secondary rounded-lg p-3 text-sm outline-none font-[family-name:var(--font-mono)] text-on-surface-variant resize-y'


/**
 * What the one-way skill migration did, shown where skills live (issue 16).
 *
 * Deliberately not a modal or a toast: a migration result is a diagnostic the
 * user reads when they come looking, the way a doctor report is. It renders
 * nothing while everything is fine, and a skill that failed stays listed with
 * the reason — a failed skill disappearing is what made this invisible before.
 */
function SkillMigrationDiagnostics() {
  const report = useSkillMigrationStore((state) => state.report)
  const dismiss = useSkillMigrationStore((state) => state.clear)
  if (!report || report.complete) return null
  const failures = failedSkillMigrations(report)
  if (!failures.length && !report.unreachable) return null
  return (
    <div className="app-panel mb-4 border border-amber-500/40">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="warning" className="text-amber-400" />
          技能遷移未完成
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pushSkillsToHost()}
            className="px-2 py-1 rounded border border-amber-500/40 text-[10px] font-semibold text-amber-300"
          >
            立即同步
          </button>
          <button
            type="button"
            onClick={() => dismiss()}
            className="px-2 py-1 rounded border border-white/15 text-[10px] text-outline"
          >
            知道了
          </button>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2">
        {report.unreachable ? (
          <p className="text-xs text-outline">
            無法連上 Pi Host，技能尚未遷移。按「立即同步」可立刻重試，重新啟動應用程式也會再試一次；技能仍保留在本機，不會遺失。
          </p>
        ) : (
          <>
            <p className="text-xs text-outline">
              下列技能沒有寫入 Host 技能目錄{report.skillsDir ? `（${report.skillsDir}）` : ''}。
              修正後按「立即同步」可立刻重試（重新啟動應用程式也會）；在此之前它們不會出現在模型可用的技能清單中。
            </p>
            <ul className="space-y-1">
              {failures.map((failure) => (
                <li key={failure.name} className="text-xs">
                  <span className="font-semibold">{failure.name}</span>
                  <span className="text-outline"> — {failure.error}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
