import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import {
  SettingsHeader,
  settingsInputCls,
} from '../components/settings/SettingsChrome'
import { useScheduleStore } from '../store/scheduleStore'
import { useAgentStore } from '../store/agentStore'
import { useLearningStore } from '../store/learningStore'
import { useGatewayStore } from '../store/gatewayStore'
import { useProjectStore } from '../store/projectStore'
import { useAutomationSuggestionStore } from '../store/automationSuggestionStore'
import type { ScheduleKind, ScheduledJob } from '../agent/types'
import { JOB_STATUS_ZH, SCHEDULE_KIND_ZH } from '../i18n/zh'
import { RunQueueStrip } from '../components/RunQueueStrip'
import {
  isRunQueueDraining,
  queueLength,
  subscribeRunQueue,
} from '../agent/runQueue'

const SECTIONS = [
  { id: 'scheduler', label: '定時任務', icon: 'schedule' },
  { id: 'events', label: '主動事件', icon: 'bolt' },
]

export function AutomationPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'events' ? 'events' : 'scheduler'
  const setTab = (id: string) => {
    setParams(id === 'scheduler' ? {} : { tab: id })
  }

  return (
    <ThemePage title="自動化" sections={SECTIONS} activeId={tab} onChange={setTab}>
      {tab === 'scheduler' ? (
        <>
          <SettingsHeader
            title="定時任務"
            subtitle="模式 3 · Time-based。到期任務會自動執行。"
          />
          <SchedulerSection />
        </>
      ) : (
        <>
          <SettingsHeader
            title="主動事件"
            subtitle="模式 4 · Proactive。嚴格布林條件匹配後觸發。"
          />
          <EventsSection />
        </>
      )}
    </ThemePage>
  )
}

function SchedulerSection() {
  const { jobs, load, addJob, toggleJob, removeJob } = useScheduleStore()
  const archive = useAgentStore((s) => s.archive)
  const loadArchive = useAgentStore((s) => s.loadArchive)
  const skills = useLearningStore((s) => s.skills)
  const loadLearning = useLearningStore((s) => s.load)
  const projectRoot = useProjectStore((s) => s.root)
  const [name, setName] = useState('每日指標摘要')
  const [objective, setObjective] = useState(
    '每天 08:00 抓取銷售指標並將摘要報告寫入工作區。',
  )
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [dailyAt, setDailyAt] = useState('08:00')
  const [intervalMinutes, setIntervalMinutes] = useState(30)
  const [runAt, setRunAt] = useState('')
  const [skillNames, setSkillNames] = useState<string[]>([])
  const [runner, setRunner] = useState<ScheduledJob['runner']>('builtin')
  const [pinProject, setPinProject] = useState(true)
  const [projectRootInput, setProjectRootInput] = useState('')

  useEffect(() => {
    void load()
    void loadLearning()
    void loadArchive()
  }, [load, loadLearning, loadArchive])

  const hydrateSuggestions = useAutomationSuggestionStore((s) => s.hydrate)
  const refreshSuggestions = useAutomationSuggestionStore((s) => s.refreshFromArchive)
  useEffect(() => {
    hydrateSuggestions()
  }, [hydrateSuggestions])
  useEffect(() => {
    refreshSuggestions(archive)
  }, [archive, refreshSuggestions])

  useEffect(() => {
    if (projectRoot && !projectRootInput) setProjectRootInput(projectRoot)
  }, [projectRoot, projectRootInput])

  const toggleSkill = (n: string) => {
    setSkillNames((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    )
  }

  const onCreate = async () => {
    if (!objective.trim()) return
    const root = pinProject ? (projectRootInput.trim() || projectRoot || '') : ''
    await addJob({
      name: name.trim() || objective.slice(0, 40),
      objective: objective.trim(),
      kind,
      dailyAt: kind === 'daily' ? dailyAt : undefined,
      intervalMinutes: kind === 'interval' ? intervalMinutes : undefined,
      runAt: kind === 'once' ? runAt || new Date(Date.now() + 60_000).toISOString() : undefined,
      skillNames,
      runner: runner || 'builtin',
      projectRoot: root || undefined,
    })
    setSkillNames([])
  }

  return (
    <div className="flex flex-col gap-5">
      <AutomationSuggestionsPanel />
      <AutomationRuntimePanel />
      <div className="app-panel p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <p className="lg:col-span-2 text-sm text-on-surface-variant">
          模式 3（定時觸發）工作。應用程式開啟或系統匣背景時，到期任務會自動執行。規格建議避免低於
          10 分鐘的高頻觸發。忙碌時會進入待跑佇列（FIFO），完成後自動補跑。
        </p>
        <Field label="任務名稱">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="排程類型">
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as ScheduleKind)}
          >
            <option value="daily">每日（HH:mm）</option>
            <option value="interval">間隔（分鐘）</option>
            <option value="once">單次（指定時間）</option>
          </select>
        </Field>
        {kind === 'daily' && (
          <Field label="每日時間">
            <input
              type="time"
              className={inputCls}
              value={dailyAt}
              onChange={(e) => setDailyAt(e.target.value)}
            />
          </Field>
        )}
        {kind === 'interval' && (
          <Field label="每隔 N 分鐘">
            <input
              type="number"
              min={1}
              className={inputCls}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value) || 30)}
            />
            {intervalMinutes < 10 && (
              <p className="text-xs text-error mt-1">警告：低於 10 分鐘的間隔不符合建議規則。</p>
            )}
          </Field>
        )}
        {kind === 'once' && (
          <Field label="執行時間">
            <input
              type="datetime-local"
              className={inputCls}
              onChange={(e) =>
                setRunAt(e.target.value ? new Date(e.target.value).toISOString() : '')
              }
            />
          </Field>
        )}
        <div className="lg:col-span-2">
          <Field label="目標（定時循環輸入）">
            <textarea
              className={inputCls}
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </Field>
        </div>
        <div className="lg:col-span-2">
          <Field label="掛載 Skills（Hermes Cron 風格，執行時注入流程）">
            <div className="flex flex-wrap gap-2 mt-1">
              {skills.length === 0 && (
                <span className="text-xs text-outline">尚無技能 — 請至「學習中心」新增</span>
              )}
              {skills.map((s) => {
                const on = skillNames.includes(s.meta.name)
                return (
                  <button
                    key={s.meta.name}
                    type="button"
                    onClick={() => toggleSkill(s.meta.name)}
                    className={`text-xs px-2 py-1 rounded border ${
                      on
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-white/10 text-on-surface-variant hover:border-primary/30'
                    }`}
                  >
                    {s.meta.name}
                  </button>
                )
              })}
            </div>
          </Field>
        </div>
        <Field label="執行引擎">
          <select
            className={inputCls}
            value={runner || 'builtin'}
            onChange={(e) => setRunner(e.target.value as ScheduledJob['runner'])}
          >
            <option value="builtin">內建（完整工具 · 能力包）</option>
            <option value="codex">Codex CLI</option>
            <option value="claude">Claude CLI</option>
            <option value="grok">Grok CLI</option>
            <option value="opencode">OpenCode CLI</option>
            <option value="gemini">Gemini CLI</option>
            <option value="cursor">Cursor CLI</option>
          </select>
          <p className="text-[11px] text-outline mt-1">
            CLI 需在設定中授權；完整 GitHub/Notion 工具請用內建。
          </p>
        </Field>
        <Field label="專案綁定">
          <label className="flex items-center gap-2 text-xs text-on-surface-variant mb-2">
            <input
              type="checkbox"
              checked={pinProject}
              onChange={(e) => setPinProject(e.target.checked)}
            />
            綁定專案路徑（避免排程時跑到錯誤工作區）
          </label>
          {pinProject && (
            <input
              className={inputCls}
              value={projectRootInput}
              onChange={(e) => setProjectRootInput(e.target.value)}
              placeholder={projectRoot || '絕對路徑，例如 D:\\Project\\foo'}
            />
          )}
        </Field>
        <div className="lg:col-span-2 flex justify-end">
          <button
            type="button"
            onClick={() => void onCreate()}
            className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold tracking-wider flex items-center gap-1"
          >
            <Icon name="add_alarm" size={16} />
            建立任務
          </button>
        </div>
      </div>

      <div className="app-panel overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Icon name="schedule" size={18} className="text-primary" />
          <h2 className="font-semibold text-sm">任務列表（{jobs.length}）</h2>
        </div>
        {jobs.length === 0 ? (
          <p className="p-8 text-center text-on-surface-variant text-sm">尚無排程任務。</p>
        ) : (
          <div className="divide-y divide-white/5">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-on-surface">{job.name}</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        job.enabled ? 'bg-primary/15 text-primary' : 'bg-outline/20 text-outline'
                      }`}
                    >
                      {job.enabled ? '已啟用' : '已暫停'}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-secondary/15 text-secondary">
                      {SCHEDULE_KIND_ZH[job.kind] || job.kind}
                    </span>
                    <span className="text-[10px] text-outline">
                      {JOB_STATUS_ZH[job.lastStatus] || job.lastStatus}
                    </span>
                  </div>
                  <p className="text-sm text-on-surface-variant truncate mt-0.5">{job.objective}</p>
                  <p className="text-[11px] text-outline mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>引擎：{job.runner || 'builtin'}</span>
                    {job.projectRoot && (
                      <span className="font-[family-name:var(--font-mono)] truncate max-w-[240px]" title={job.projectRoot}>
                        專案：{job.projectRoot}
                      </span>
                    )}
                  </p>
                  {!!job.skillNames?.length && (
                    <p className="text-[11px] text-secondary mt-1">
                      Skills：{job.skillNames.join(', ')}
                    </p>
                  )}
                  <p className="text-[11px] text-outline font-[family-name:var(--font-mono)] mt-1">
                    下次：
                    {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : '—'} · 上次：
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : '尚未執行'}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleJob(job.id)}
                    className="px-3 py-1.5 rounded border border-white/10 text-xs font-semibold hover:border-primary/40 hover:text-primary"
                  >
                    {job.enabled ? '暫停' : '啟用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeJob(job.id)}
                    className="px-3 py-1.5 rounded border border-error/30 text-error text-xs font-semibold hover:bg-error/10"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Usage suggestions are proposals only; accepting creates a normal schedule. */
function AutomationSuggestionsPanel() {
  const suggestions = useAutomationSuggestionStore((s) => s.suggestions)
  const decide = useAutomationSuggestionStore((s) => s.decide)
  const addJob = useScheduleStore((s) => s.addJob)

  if (!suggestions.length) return null

  const accept = async (suggestion: (typeof suggestions)[number]) => {
    await addJob({
      name: suggestion.title.replace(/^建議自動化：/, '').slice(0, 40) || '使用習慣自動化',
      objective: suggestion.objective,
      kind: suggestion.recommended.kind,
      dailyAt: suggestion.recommended.dailyAt,
    })
    decide(suggestion.dedupKey, 'accepted')
  }

  return (
    <div className="app-panel border border-secondary/30 bg-secondary/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Icon name="lightbulb" size={20} className="text-secondary mt-0.5" />
        <div>
          <h2 className="font-semibold text-sm">建議的自動化</h2>
          <p className="text-xs text-on-surface-variant mt-1">
            根據近期成功執行的重複工作提出建議；不會自動建立排程，請由你同意。
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.dedupKey}
            className="rounded-lg border border-white/10 bg-surface/50 p-3 flex flex-col md:flex-row md:items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{suggestion.title}</span>
                <span className="text-[10px] rounded bg-secondary/15 text-secondary px-1.5 py-0.5">
                  usage · {suggestion.occurrenceCount} 次
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1 truncate">{suggestion.objective}</p>
              <p className="text-[11px] text-outline mt-1">{suggestion.reason} 建議每日 08:00。</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void accept(suggestion)}
                className="px-3 py-1.5 rounded bg-secondary-container text-on-secondary-container text-xs font-semibold"
              >
                接受並建立排程
              </button>
              <button
                type="button"
                onClick={() => decide(suggestion.dedupKey, 'dismissed')}
                className="px-3 py-1.5 rounded border border-white/10 text-xs text-on-surface-variant"
              >
                暫不需要
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Live automation queue + background delegates */
function AutomationRuntimePanel() {
  const isRunning = useAgentStore((s) => s.isRunning)
  const bgJobs = useGatewayStore((s) => s.jobs)
  const refreshJobs = useGatewayStore((s) => s.refreshJobs)
  const [draining, setDraining] = useState(() => isRunQueueDraining())
  const [qn, setQn] = useState(() => queueLength())

  useEffect(() => {
    refreshJobs()
    return subscribeRunQueue(() => {
      setDraining(isRunQueueDraining())
      setQn(queueLength())
    })
  }, [refreshJobs])

  const recentBg = bgJobs.slice(0, 6)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-0.5 text-[11px] text-outline">
        <span className="font-[family-name:var(--font-mono)]">
          待跑 {qn}/24
          {draining ? ' · 消化中' : ''}
          {isRunning ? ' · 代理忙碌' : ' · 空閒'}
        </span>
        <span className="opacity-50">·</span>
        <span>可調整優先序／置頂／取消；與新任務對話追問共用</span>
      </div>
      <RunQueueStrip />

      <div className="pt-1 border-t border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <Icon name="work" size={16} className="text-secondary" />
          <span className="text-xs font-semibold">背景委派</span>
          <span className="text-[10px] text-outline">{bgJobs.length} 筆</span>
        </div>
        {recentBg.length === 0 ? (
          <p className="text-xs text-outline">尚無背景 job（delegate_task background）。</p>
        ) : (
          <div className="space-y-1">
            {recentBg.map((j) => (
              <div
                key={j.id}
                className="text-[11px] font-[family-name:var(--font-mono)] flex gap-2"
              >
                <span
                  className={
                    j.status === 'success'
                      ? 'text-primary'
                      : j.status === 'failed'
                        ? 'text-error'
                        : 'text-secondary'
                  }
                >
                  {j.status}
                </span>
                <span className="text-outline truncate">
                  {j.id} · {j.goal.slice(0, 56)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EventsSection() {
  const navigate = useNavigate()
  const {
    events,
    load,
    addEvent,
    removeEvent,
    toggleEvent,
    matchEvent,
    recordEventTrigger,
  } = useScheduleStore()
  const isRunning = useAgentStore((s) => s.isRunning)

  const [name, setName] = useState('發票郵件處理')
  const [source, setSource] = useState('email.received')
  const [subjectContains, setSubjectContains] = useState('Invoice')
  const [hasAttachment, setHasAttachment] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [objective, setObjective] = useState(
    '當收到含附件且主旨包含 Invoice 的郵件時，擷取並歸檔文件。',
  )

  const [simSource, setSimSource] = useState('email.received')
  const [simSubject, setSimSubject] = useState('Q3 Invoice #4821')
  const [simAttach, setSimAttach] = useState(true)
  const [simBody, setSimBody] = useState('請處理附件中的發票。')
  const [simResult, setSimResult] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    await addEvent({
      name,
      source,
      subjectContains: subjectContains || undefined,
      hasAttachment,
      keyword: keyword || undefined,
      objective,
      enabled: true,
    })
  }

  const onSimulate = async () => {
    const matched = matchEvent({
      source: simSource,
      subject: simSubject,
      hasAttachment: simAttach,
      body: simBody,
    })
    if (!matched) {
      setSimResult('未匹配 — 布林條件為假，不執行任何動作。')
      return
    }
    setSimResult(`匹配 → ${matched.name}。正在觸發主動循環（新任務 + Run 面板）…`)
    await recordEventTrigger(matched.id)
    if (isRunning) {
      setSimResult(`匹配 → ${matched.name}，但代理正在執行中。`)
      return
    }
    navigate('/')
    const { runExternalObjective } = await import('../agent/runExternal')
    const r = await runExternalObjective({
      sourceKind: 'event',
      objective: matched.objective,
      title: matched.name,
      loopType: 'Proactive',
      eventPreMatched: true,
      sourceLabel: `事件模擬：${matched.name}`,
    })
    setSimResult(
      r.skipped
        ? `匹配 → ${matched.name}，忙碌略過`
        : `匹配 → ${matched.name} · 狀態 ${r.status}`,
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-on-surface-variant">
        模式 4 事件匯流排 — 僅嚴格布林比對。可在「設定」啟用本機 Webhook：
        <code className="text-primary font-[family-name:var(--font-mono)] text-xs"> POST /webhook</code>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="app-panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Icon name="bolt" className="text-primary" size={20} />
            註冊條件
          </h2>
          <Field label="名稱">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="來源（完全相符）">
            <input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <Field label="主旨包含（選填）">
            <input
              className={inputCls}
              value={subjectContains}
              onChange={(e) => setSubjectContains(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasAttachment}
              onChange={(e) => setHasAttachment(e.target.checked)}
              className="accent-primary-container"
            />
            要求 hasAttachment = true
          </label>
          <Field label="主旨/內文關鍵字（選填）">
            <input className={inputCls} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </Field>
          <Field label="匹配後的目標">
            <textarea
              className={inputCls}
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={() => void onCreate()}
            className="self-end px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold"
          >
            新增事件規則
          </button>
        </div>

        <div className="app-panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Icon name="science" className="text-secondary" size={20} />
            事件模擬器
          </h2>
          <Field label="進來的來源">
            <input
              className={inputCls}
              value={simSource}
              onChange={(e) => setSimSource(e.target.value)}
            />
          </Field>
          <Field label="主旨">
            <input
              className={inputCls}
              value={simSubject}
              onChange={(e) => setSimSubject(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={simAttach}
              onChange={(e) => setSimAttach(e.target.checked)}
              className="accent-primary-container"
            />
            含附件
          </label>
          <Field label="內文">
            <textarea
              className={inputCls}
              rows={3}
              value={simBody}
              onChange={(e) => setSimBody(e.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={() => void onSimulate()}
            className="self-end px-4 py-2 rounded-lg border border-primary text-primary text-xs font-semibold hover:bg-primary/10"
          >
            觸發事件
          </button>
          {simResult && (
            <pre className="bg-surface border border-white/10 rounded-lg p-3 text-xs font-[family-name:var(--font-mono)] text-on-surface-variant whitespace-pre-wrap">
              {simResult}
            </pre>
          )}
        </div>
      </div>

      <div className="app-panel overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 font-semibold text-sm">
          規則（{events.length}）
        </div>
        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-on-surface-variant">尚無主動規則。</p>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((e) => (
              <div
                key={e.id}
                className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{e.name}</span>
                    <code className="text-[11px] text-secondary font-[family-name:var(--font-mono)]">
                      {e.source}
                    </code>
                    {e.hasAttachment && (
                      <span className="text-[10px] text-primary">需附件</span>
                    )}
                  </div>
                  <p className="text-sm text-on-surface-variant truncate">{e.objective}</p>
                  <p className="text-[11px] text-outline mt-1">
                    觸發次數：{e.triggerCount} · 上次：
                    {e.lastTriggeredAt ? new Date(e.lastTriggeredAt).toLocaleString() : '尚未'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleEvent(e.id)}
                    className="px-3 py-1.5 rounded border border-white/10 text-xs font-semibold"
                  >
                    {e.enabled ? '停用' : '啟用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeEvent(e.id)}
                    className="px-3 py-1.5 rounded border border-error/30 text-error text-xs font-semibold"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const inputCls = settingsInputCls

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">
        {label}
      </span>
      {children}
    </label>
  )
}
