import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import { SettingsHeader } from '../components/settings/SettingsChrome'
import { useLearningStore } from '../store/learningStore'
import { useAgentStore } from '../store/agentStore'
import { PluginMarketplace } from '../components/PluginMarketplace'
import { useProjectStore } from '../store/projectStore'
import { buildLearningExportPlan } from '../agent/hermes/learningExport'
import { failedSkillMigrations, useSkillMigrationStore } from '../store/skillMigrationStore'
import { pushSkillsToHost } from '../agent/hermes/skillHostSync'

const SECTIONS = [
  { id: 'memory', label: '持久記憶', icon: 'psychology' },
  { id: 'skills', label: '技能庫', icon: 'auto_awesome' },
  { id: 'drafts', label: '學習草稿', icon: 'rate_review' },
  { id: 'search', label: '跨會話搜尋', icon: 'manage_search' },
  { id: 'prompt', label: '人格與上下文', icon: 'badge' },
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

const SECTION_IDS = new Set(SECTIONS.map((s) => s.id))

const META: Record<string, { title: string; subtitle: string }> = {
  memory: { title: '持久記憶', subtitle: 'USER / MEMORY · 跨 session 保留。' },
  skills: { title: '技能庫', subtitle: 'SKILL.md 流程技能。' },
  drafts: { title: '學習草稿', subtitle: '成功執行後自動產生的技能草稿。' },
  search: { title: '跨會話搜尋', subtitle: '在記憶、技能與封存中檢索。' },
  prompt: { title: '人格與上下文', subtitle: 'SOUL / AGENTS 穩定提示層。' },
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
    skills,
    events,
    pendingDrafts,
    soul,
    agents,
    searchHits,
    searchSummary,
    setUserProfile,
    setMemoryDoc,
    appendMemory,
    setSoul,
    setAgents,
    approveDraft,
    rejectDraft,
    search,
    saveSkill,
    pinSkill,
    unpinSkill,
    restoreSkill,
    removeSkill,
    refresh,
  } = useLearningStore()
  const archive = useAgentStore((s) => s.archive)
  const loadArchive = useAgentStore((s) => s.loadArchive)
  const knowledge = useAgentStore((s) => s.agent.knowledge)
  const projectRoot = useProjectStore((s) => s.root)

  const [userEdit, setUserEdit] = useState('')
  const [memEdit, setMemEdit] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [soulEdit, setSoulEdit] = useState('')
  const [agentsEdit, setAgentsEdit] = useState('')
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDesc, setNewSkillDesc] = useState('')
  const [newSkillBody, setNewSkillBody] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState('')

  useEffect(() => {
    void load()
    void loadArchive()
  }, [load, loadArchive])

  useEffect(() => {
    setUserEdit(memory.userProfile)
    setMemEdit(memory.memory)
  }, [memory.userProfile, memory.memory])

  useEffect(() => {
    setSoulEdit(soul)
    setAgentsEdit(agents)
  }, [soul, agents])

  const selected = skills.find((s) => s.meta.name === selectedSkill) || skills[0]

  const meta = META[section] || META.memory

  const exportLearning = async (kind: 'skill' | 'memory' | 'knowledge') => {
    const files = buildLearningExportPlan({ skills, memory, knowledge }).filter((file) => file.kind === kind)
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
      narrow={section !== 'plugins'}
      immersive={section === 'plugins'}
    >
      {section !== 'plugins' && <SettingsHeader title={meta.title} subtitle={meta.subtitle} />}
      {section !== 'plugins' && (
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
                onClick={() => void setUserProfile(userEdit)}
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
                onClick={() => void setMemoryDoc(memEdit)}
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
                  onClick={() => {
                    if (!note.trim()) return
                    void appendMemory(note.trim())
                    setNote('')
                  }}
                  className="px-3 py-2 rounded-lg bg-primary/20 text-primary text-xs font-semibold shrink-0"
                >
                  追加
                </button>
              </div>
              <ul className="text-sm text-on-surface-variant space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {memory.entries.slice(0, 12).map((e) => (
                  <li key={e.id} className="border-b border-white/5 py-1">
                    <span className="text-[10px] text-outline font-[family-name:var(--font-mono)]">
                      {e.createdAt.slice(0, 16)}
                    </span>{' '}
                    {e.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {section === 'skills' && <SkillMigrationDiagnostics />}
        {section === 'skills' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="app-panel overflow-hidden md:col-span-1">
              <div className="px-3 py-2 border-b border-white/10 text-sm font-semibold">
                技能（{skills.length}）
              </div>
              <div className="max-h-80 overflow-y-auto custom-scrollbar">
                {skills.map((s) => (
                  <button
                    key={s.meta.name}
                    type="button"
                    onClick={() => setSelectedSkill(s.meta.name)}
                    className={`w-full text-left px-3 py-2 border-b border-white/5 text-sm hover:bg-white/5 ${
                      selected?.meta.name === s.meta.name ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    <div className="font-medium">{s.meta.name}</div>
                    <div className="text-[11px] text-outline truncate">{s.meta.description}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="app-panel p-4 md:col-span-2 space-y-2">
              {selected ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{selected.meta.name}</h3>
                    {selected.meta.status === 'archived' ? (
                      <button
                        type="button"
                        onClick={() => void restoreSkill(selected.meta.name)}
                        className="text-xs text-primary"
                      >
                        復原技能
                      </button>
                    ) : (
                      <div className="flex items-center gap-3">
                        <SkillPinButton
                          name={selected.meta.name}
                          pinned={selected.meta.status === 'pinned'}
                          pin={pinSkill}
                          unpin={unpinSkill}
                        />
                        <button
                          type="button"
                          onClick={() => void removeSkill(selected.meta.name)}
                          className="text-xs text-error"
                        >
                          刪除
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-outline">
                    {selected.meta.createdBy === 'agent' ? '代理建立' : '使用者'} · v
                    {selected.meta.version || '—'} · {selected.meta.status || 'active'}
                  </p>
                  <pre className="bg-surface border border-white/10 rounded-lg p-3 text-[12px] font-[family-name:var(--font-mono)] text-on-surface-variant max-h-96 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                    {selected.raw}
                  </pre>
                </>
              ) : (
                <p className="text-sm text-outline">選擇左側技能</p>
              )}
              <div className="border-t border-white/10 pt-3 space-y-2">
                <h4 className="text-sm font-semibold">新增技能</h4>
                <input
                  className={input}
                  placeholder="名稱"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                />
                <input
                  className={input}
                  placeholder="描述（≤60 字）"
                  value={newSkillDesc}
                  onChange={(e) => setNewSkillDesc(e.target.value)}
                />
                <textarea
                  className={ta}
                  rows={5}
                  placeholder="Markdown 正文…"
                  value={newSkillBody}
                  onChange={(e) => setNewSkillBody(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newSkillName.trim() || !newSkillBody.trim()) return
                    void saveSkill(
                      newSkillName.trim(),
                      newSkillDesc.trim() || newSkillName.trim(),
                      newSkillBody,
                    )
                    setNewSkillName('')
                    setNewSkillDesc('')
                    setNewSkillBody('')
                    refresh()
                  }}
                  className="px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold"
                >
                  儲存技能
                </button>
              </div>
            </div>
          </div>
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

        {section === 'prompt' && (
          <div className="space-y-4">
            <div className="app-panel p-5 space-y-2">
              <h2 className="font-semibold">SOUL.md — 人格（stable）</h2>
              <textarea
                className={ta}
                rows={8}
                value={soulEdit}
                onChange={(e) => setSoulEdit(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void setSoul(soulEdit)}
                className="px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold"
              >
                儲存人格
              </button>
            </div>
            <div className="app-panel p-5 space-y-2">
              <h2 className="font-semibold">AGENTS.md — 專案上下文（context）</h2>
              <textarea
                className={ta}
                rows={10}
                value={agentsEdit}
                onChange={(e) => setAgentsEdit(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void setAgents(agentsEdit)}
                className="px-3 py-2 rounded-lg border border-primary/40 text-primary text-xs font-semibold"
              >
                儲存上下文
              </button>
            </div>
            <p className="text-xs text-outline">
              Hermes 原則：stable 層在對話中保持穩定；memory 屬 volatile 層可每輪更新。
            </p>
          </div>
        )}
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
