import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import { SettingsHeader } from '../components/settings/SettingsChrome'
import { useLearningStore } from '../store/learningStore'
import { useAgentStore } from '../store/agentStore'

const SECTIONS = [
  { id: 'memory', label: '持久記憶', icon: 'psychology' },
  { id: 'skills', label: '技能庫', icon: 'auto_awesome' },
  { id: 'drafts', label: '學習草稿', icon: 'rate_review' },
  { id: 'search', label: '跨會話搜尋', icon: 'manage_search' },
  { id: 'prompt', label: '人格與上下文', icon: 'badge' },
  { id: 'plugins', label: '外掛', icon: 'extension' },
]

const META: Record<string, { title: string; subtitle: string }> = {
  memory: { title: '持久記憶', subtitle: 'USER / MEMORY · 跨 session 保留。' },
  skills: { title: '技能庫', subtitle: 'SKILL.md 流程技能。' },
  drafts: { title: '學習草稿', subtitle: '成功執行後自動產生的技能草稿。' },
  search: { title: '跨會話搜尋', subtitle: '在記憶、技能與封存中檢索。' },
  prompt: { title: '人格與上下文', subtitle: 'SOUL / AGENTS 穩定提示層。' },
  plugins: { title: '外掛', subtitle: 'Edge 能力擴充。' },
}

export function LearningPage() {
  const [section, setSection] = useState('memory')
  const {
    load,
    memory,
    skills,
    events,
    pendingDrafts,
    soul,
    agents,
    searchHits,
    setUserProfile,
    setMemoryDoc,
    appendMemory,
    setSoul,
    setAgents,
    approveDraft,
    rejectDraft,
    search,
    saveSkill,
    removeSkill,
    refresh,
    plugins,
    setPluginEnabled,
    importPlugin,
    removePlugin,
  } = useLearningStore()
  const [pluginJson, setPluginJson] = useState('')
  const [pluginDir, setPluginDir] = useState('')
  const archive = useAgentStore((s) => s.archive)
  const loadArchive = useAgentStore((s) => s.loadArchive)

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

  useEffect(() => {
    void load()
    void loadArchive()
    void window.subagents?.plugins?.dir?.().then(setPluginDir)
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

  return (
    <ThemePage
      title="學習中心"
      sections={SECTIONS}
      activeId={section}
      onChange={setSection}
    >
      <SettingsHeader title={meta.title} subtitle={meta.subtitle} />
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
                    <button
                      type="button"
                      onClick={() => void removeSkill(selected.meta.name)}
                      className="text-xs text-error"
                    >
                      刪除
                    </button>
                  </div>
                  <p className="text-xs text-outline">
                    {selected.meta.createdBy === 'agent' ? '代理建立' : '使用者'} · v
                    {selected.meta.version || '—'}
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

        {section === 'plugins' && (
          <div className="space-y-4">
            <div className="app-panel p-5 space-y-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Icon name="extension" size={18} className="text-primary" />
                外掛（Hermes Edge 哲學）
              </h2>
              <p className="text-sm text-on-surface-variant">
                能力放在邊緣，不膨脹核心 tool schema。JSON 外掛可注入 Skills 與 prompt 片段。
              </p>
              {pluginDir && (
                <p className="text-[11px] font-[family-name:var(--font-mono)] text-outline">
                  目錄：{pluginDir}
                </p>
              )}
              <div className="space-y-2">
                {plugins.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 border border-white/10 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{p.name}</div>
                      <div className="text-[11px] text-outline truncate">
                        {p.id} · v{p.version || '—'} · {p.description || ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) => void setPluginEnabled(p.id, e.target.checked)}
                          className="accent-primary-container"
                        />
                        啟用
                      </label>
                      {p.id !== 'example-edge' && (
                        <button
                          type="button"
                          className="text-xs text-error"
                          onClick={() => void removePlugin(p.id)}
                        >
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="app-panel p-5 space-y-2">
              <h3 className="text-sm font-semibold">匯入外掛 JSON</h3>
              <textarea
                className={ta}
                rows={8}
                value={pluginJson}
                onChange={(e) => setPluginJson(e.target.value)}
                placeholder='{"id":"my","name":"My","enabled":true,"skills":[],"promptAppend":"..."}'
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    const m = JSON.parse(pluginJson)
                    if (!m.id || !m.name) throw new Error('需要 id 與 name')
                    void importPlugin(m)
                    setPluginJson('')
                    if (window.subagents?.plugins?.save) {
                      void window.subagents.plugins.save(m)
                    }
                  } catch (e) {
                    alert(e instanceof Error ? e.message : String(e))
                  }
                }}
                className="px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold"
              >
                匯入並啟用
              </button>
            </div>
            <p className="text-xs text-outline">
              委派隔離：Manager 可呼叫 <code className="text-primary">delegate_task</code>
              產生 leaf 子代理（獨立上下文、禁止再委派／skill_save）。支援{' '}
              <code className="text-primary">background + notify_on_complete</code>
              。MCP 長連線 stdio；訊息閘道見設定 → Telegram。
            </p>
          </div>
        )}

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
