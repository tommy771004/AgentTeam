import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ThemePage } from '../components/SectionNav'
import {
  SettingsHeader,
  settingsBtnCls,
} from '../components/settings/SettingsChrome'
import { useAgentStore } from '../store/agentStore'
import { useProjectStore } from '../store/projectStore'
import type { EntityKind, KnowledgeEntity } from '../agent/types'
import {
  fetchCodegraphStatus,
  runCodegraphCallers,
  runCodegraphExplore,
  runCodegraphImpact,
  type CodegraphUiStatus,
} from '../agent/codegraphClient'

const kindColor: Record<EntityKind, string> = {
  ORG: 'bg-secondary/20 text-secondary',
  METRIC: 'bg-tertiary-container/20 text-tertiary-container',
  PROJECT: 'bg-primary/20 text-primary',
  PERSON: 'bg-error/20 text-error',
  CONCEPT: 'bg-outline/20 text-on-surface-variant',
  TOOL: 'bg-primary-container/20 text-primary-container',
  SYMBOL: 'bg-emerald-500/15 text-emerald-300',
  FILE: 'bg-sky-500/15 text-sky-300',
}

const kindIcon: Record<EntityKind, string> = {
  ORG: 'apartment',
  METRIC: 'show_chart',
  PROJECT: 'rocket_launch',
  PERSON: 'person',
  CONCEPT: 'hub',
  TOOL: 'build',
  SYMBOL: 'data_object',
  FILE: 'description',
}

export function KnowledgePage() {
  const navigate = useNavigate()
  const { agent, isRunning, activeRunIds, stopExecution } = useAgentStore()
  const runId = activeRunIds[0] || null
  const projectRoot = useProjectStore((s) => s.root)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [cgStatus, setCgStatus] = useState<CodegraphUiStatus | null>(null)
  const [cgBusy, setCgBusy] = useState(false)
  const [cgQuery, setCgQuery] = useState('project structure entry points')
  const [cgSymbol, setCgSymbol] = useState('')
  const [cgMsg, setCgMsg] = useState('')
  const [lastOutput, setLastOutput] = useState('')
  const [mode, setMode] = useState<'explore' | 'impact' | 'callers'>('explore')

  const graph = agent.knowledge
  const entities = graph.entities
  const selected = entities.find((e) => e.id === selectedId) || entities[0]

  const refreshCg = useCallback(async () => {
    const st = await fetchCodegraphStatus(projectRoot || undefined)
    setCgStatus(st)
  }, [projectRoot])

  useEffect(() => {
    void refreshCg()
  }, [refreshCg])

  const positions = useMemo(() => layoutRadial(entities), [entities])

  const heatmap = useMemo(() => {
    const cells = 48
    return Array.from({ length: cells }, (_, i) => {
      const e = entities[i % Math.max(1, entities.length)]
      const conf = e?.confidence ?? 0.5
      return conf
    })
  }, [entities])

  const exportGraph = () => {
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agent.id || 'knowledge'}_graph.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onInitIndex = async () => {
    if (!projectRoot || !window.subagents?.codegraph?.init) {
      setCgMsg('請先選擇專案，並使用 Electron。')
      return
    }
    setCgBusy(true)
    setCgMsg('正在 codegraph init（首次可能較久）…')
    try {
      const r = await window.subagents.codegraph.init(projectRoot)
      setCgMsg(r.ok ? '索引完成' : r.error || 'init 失敗')
      await refreshCg()
    } finally {
      setCgBusy(false)
    }
  }

  const onSyncIndex = async () => {
    if (!projectRoot || !window.subagents?.codegraph?.sync) return
    setCgBusy(true)
    try {
      const r = await window.subagents.codegraph.sync(projectRoot)
      setCgMsg(r.ok ? 'sync 完成' : r.error || 'sync 失敗')
      await refreshCg()
    } finally {
      setCgBusy(false)
    }
  }

  const onExplore = async () => {
    if (!projectRoot) {
      setCgMsg('請先選擇專案目錄')
      return
    }
    setCgBusy(true)
    setCgMsg(
      mode === 'impact'
        ? 'CodeGraph impact…'
        : mode === 'callers'
          ? 'CodeGraph callers…'
          : 'CodeGraph explore…',
    )
    try {
      if (mode === 'impact') {
        const sym = cgSymbol.trim() || cgQuery.trim()
        if (!sym) {
          setCgMsg('impact 需要 symbol')
          return
        }
        const r = await runCodegraphImpact(projectRoot, sym, 2)
        setLastOutput(r.output || '')
        if (!r.ok) {
          setCgMsg(r.error || 'impact 失敗')
          return
        }
        setCgMsg(`impact · ${r.graph.entities.length} 節點已合併`)
        return
      }
      if (mode === 'callers') {
        const sym = cgSymbol.trim() || cgQuery.trim()
        if (!sym) {
          setCgMsg('callers 需要 symbol')
          return
        }
        const r = await runCodegraphCallers(projectRoot, sym)
        setLastOutput(r.output || '')
        if (!r.ok) {
          setCgMsg(r.error || 'callers 失敗')
          return
        }
        setCgMsg(`callers · ${r.graph.entities.length} 節點已合併`)
        return
      }
      const r = await runCodegraphExplore(
        projectRoot,
        cgQuery.trim() || 'main architecture',
      )
      setLastOutput(r.output || '')
      if (!r.ok) {
        setCgMsg(r.error || 'explore 失敗')
        return
      }
      setCgMsg(`explore · 已合併 ${r.graph.entities.length} 個 code 節點`)
    } finally {
      setCgBusy(false)
    }
  }

  const [section, setSection] = useState('graph')

  return (
    <ThemePage
      title="知識圖譜"
      sections={[
        { id: 'graph', label: '任務圖譜', icon: 'hub' },
        { id: 'codegraph', label: 'CodeGraph', icon: 'account_tree' },
      ]}
      activeId={section}
      onChange={setSection}
      narrow={false}
    >
      <SettingsHeader
        title={section === 'codegraph' ? 'CodeGraph' : '任務圖譜'}
        subtitle={
          section === 'codegraph'
            ? '本機程式碼索引 · 符號／呼叫路徑。'
            : `階段：${graph.phase || '閒置'}${graph.source ? ` · ${graph.source}` : ''}`
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-outline">
          實體 {entities.length}
        </span>
        <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-outline">
          信心 {Math.round((agent.confidence || 0) * 100)}%
        </span>
        <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-outline">
          CodeGraph{' '}
          {!cgStatus
            ? '…'
            : !cgStatus.installed
              ? '未安裝'
              : cgStatus.indexed
                ? '已索引'
                : '未索引'}
        </span>
        {isRunning && (
          <button type="button" onClick={() => runId && stopExecution(runId)} className={settingsBtnCls}>
            暫停循環
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            // Live runs use home + InlineRunPanel (not deprecated /execution)
            navigate('/')
            if (agent.status === 'running' || isRunning) {
              void import('../store/threadStore').then(({ useThreadStore }) => {
                const thr = useThreadStore.getState()
                if (thr.runningThreadIds[0]) thr.selectThread(thr.runningThreadIds[0])
                thr.setShowRunPanel(true)
              })
            }
          }}
          className="min-h-8 rounded-control bg-transparent px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        >
          返回
        </button>
      </div>

      <div className="flex flex-col gap-4 min-h-0 flex-1">
        {/* CodeGraph control strip */}
        <div className="app-panel p-3 shrink-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="text-[11px] text-on-surface-variant">
              專案：
              <span className="font-mono text-white/70 ml-1">
                {projectRoot || '（尚未選擇）'}
              </span>
              {cgStatus?.version && (
                <span className="ml-2 text-outline">CLI {cgStatus.version}</span>
              )}
              {cgStatus?.version && /^0\./.test(cgStatus.version.trim()) && (
                <span className="ml-2 text-outline/80" title="npm i -g @colbymchenry/codegraph@latest">
                  · 舊版 CLI：explore 自動降級 query
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={cgBusy || !projectRoot}
                onClick={() => void onInitIndex()}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                建立索引 init
              </button>
              <button
                type="button"
                disabled={cgBusy || !projectRoot || !cgStatus?.indexed}
                onClick={() => void onSyncIndex()}
                className="min-h-8 rounded-lg bg-transparent px-2.5 py-1 text-[11px] text-on-surface-variant transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-40"
              >
                sync
              </button>
              <button
                type="button"
                disabled={cgBusy}
                onClick={() => void refreshCg()}
                className="min-h-8 rounded-lg bg-transparent px-2.5 py-1 text-[11px] text-on-surface-variant transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-40"
              >
                重新整理狀態
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['explore', 'explore'],
                ['impact', 'impact'],
                ['callers', 'callers'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className={`min-h-8 rounded-lg bg-transparent px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${
                  mode === id
                    ? 'bg-primary/15 text-primary'
                    : 'text-on-surface-variant hover:bg-hover-2 hover:text-on-surface'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {mode === 'explore' ? (
              <input
                value={cgQuery}
                onChange={(e) => setCgQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onExplore()
                }}
                placeholder="explore：how does X work / ClassName / path"
                className="flex-1 bg-white/5 border border-white/12 rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-primary/40 font-mono"
              />
            ) : (
              <input
                value={cgSymbol}
                onChange={(e) => setCgSymbol(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onExplore()
                }}
                placeholder={`${mode}：符號名，例如 AgentLoopEngine / startExecution`}
                className="flex-1 bg-white/5 border border-white/12 rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-primary/40 font-mono"
              />
            )}
            <button
              type="button"
              disabled={cgBusy || !projectRoot}
              onClick={() => void onExplore()}
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-primary/90 text-white hover:bg-primary disabled:opacity-40"
            >
              {cgBusy ? '查詢中…' : `執行 ${mode}`}
            </button>
          </div>
          {lastOutput && (
            <details className="text-[10px] text-white/50">
              <summary className="cursor-pointer text-outline hover:text-on-surface">
                原始 CodeGraph 輸出
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto custom-scrollbar p-2 rounded-lg bg-black/30 font-mono whitespace-pre-wrap">
                {lastOutput.slice(0, 6000)}
              </pre>
            </details>
          )}
          {(cgMsg || cgStatus?.error) && (
            <p className="text-[11px] text-amber-200/90 leading-snug">
              {cgMsg || cgStatus?.error}
            </p>
          )}
          {!cgStatus?.installed && (
            <CodegraphInstallAction onInstalled={refreshCg} />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
          {/* Entities list */}
          <div className="lg:col-span-4 app-panel flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Icon name="list" size={18} className="text-primary" />
                已擷取實體
              </h2>
              <Icon name="filter_list" size={18} className="text-outline" />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {entities.length === 0 && (
                <p className="p-6 text-sm text-outline text-center leading-relaxed">
                  執行代理任務會從輸出抽實體；或上方用 CodeGraph explore 從本機程式碼索引載入符號。
                </p>
              )}
              {entities.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelectedId(e.id)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/[0.03] transition-colors ${
                    selected?.id === e.id ? 'bg-white/[0.04]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm text-on-surface">{e.name}</div>
                      <div className="text-xs text-outline mt-0.5">提及：{e.mentions}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${kindColor[e.kind]}`}
                      >
                        {e.kind}
                      </span>
                      <span className="text-[11px] font-[family-name:var(--font-mono)] text-primary flex items-center gap-0.5">
                        <Icon name="target" size={12} />
                        {e.confidence.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-white/10 shrink-0">
              <button
                type="button"
                onClick={exportGraph}
                disabled={entities.length === 0}
                className="w-full py-2 rounded-lg border border-white/15 text-xs font-semibold tracking-wider uppercase text-on-surface-variant hover:text-primary hover:border-primary/30 disabled:opacity-40 flex items-center justify-center gap-1"
              >
                <Icon name="download" size={14} />
                匯出圖譜資料
              </button>
            </div>
          </div>

          {/* Graph + heatmap */}
          <div className="lg:col-span-8 flex flex-col gap-4 min-h-0">
            <div className="app-panel flex-1 min-h-[280px] flex flex-col overflow-hidden relative">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <Icon name="hub" size={18} className="text-primary" />
                  關係圖譜
                </h2>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label="放大關係圖譜"
                    onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
                    className="flex size-8 items-center justify-center rounded-lg bg-transparent text-outline transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    <Icon name="zoom_in" size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="縮小關係圖譜"
                    onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
                    className="flex size-8 items-center justify-center rounded-lg bg-transparent text-outline transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    <Icon name="zoom_out" size={18} />
                  </button>
                </div>
              </div>
              <div
                className="flex-1 relative overflow-hidden"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, rgba(133,147,151,0.15) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              >
                <svg className="absolute inset-0 w-full h-full" style={{ transform: `scale(${zoom})` }}>
                  {graph.edges.map((edge, i) => {
                    const a = positions[edge.from]
                    const b = positions[edge.to]
                    if (!a || !b) return null
                    return (
                      <line
                        key={i}
                        x1={`${a.x}%`}
                        y1={`${a.y}%`}
                        x2={`${b.x}%`}
                        y2={`${b.y}%`}
                        stroke="rgba(138,235,255,0.25)"
                        strokeWidth="1.5"
                      />
                    )
                  })}
                </svg>
                {entities.map((e) => {
                  const p = positions[e.id]
                  if (!p) return null
                  const active = selected?.id === e.id
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 group"
                      style={{ left: `${p.x}%`, top: `${p.y}%`, transform: `translate(-50%, -50%) scale(${zoom})` }}
                    >
                      <div
                        className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center bg-surface-container transition-all ${
                          active
                            ? 'border-primary'
                            : 'border-outline-variant/50 group-hover:border-primary/50'
                        }`}
                      >
                        <Icon
                          name={kindIcon[e.kind]}
                          size={22}
                          className={active ? 'text-primary' : 'text-on-surface-variant'}
                        />
                      </div>
                      <span className="text-[11px] text-on-surface-variant max-w-[90px] truncate">
                        {e.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="app-panel p-4 shrink-0">
              <h2 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <Icon name="grid_on" size={18} className="text-secondary" />
                Data 信心度 Heatmap
              </h2>
              <div className="grid grid-cols-12 gap-1.5">
                {heatmap.map((c, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-sm"
                    style={{
                      background:
                        c > 0.9
                          ? 'var(--color-primary)'
                          : c > 0.8
                            ? 'var(--color-primary-fixed-dim)'
                            : c > 0.7
                              ? 'var(--color-secondary)'
                              : c > 0.55
                                ? 'var(--color-secondary-container)'
                                : 'var(--color-surface-container-highest)',
                      opacity: 0.5 + c * 0.5,
                    }}
                    title={`cell ${i}: ${(c * 100).toFixed(0)}%`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ThemePage>
  )
}

function CodegraphInstallAction({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState('')

  const install = async () => {
    if (!window.subagents?.codegraph?.install) {
      setMessage('自動安裝需要 Electron。')
      return
    }
    setInstalling(true)
    setMessage('正在透過 npm 安裝 CodeGraph CLI…')
    try {
      const result = await window.subagents.codegraph.install()
      setMessage(result.ok ? `安裝完成${result.version ? ` · ${result.version}` : ''}` : result.error || '安裝失敗')
      if (result.ok) await onInstalled()
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] text-outline leading-relaxed">
      <span>未偵測到 CodeGraph CLI。</span>
      <button
        type="button"
        disabled={installing}
        onClick={() => void install()}
        className="px-2.5 py-1 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-40"
      >
        {installing ? '安裝中…' : '安裝 CodeGraph CLI'}
      </button>
      {message && <span className="text-amber-200/90">{message}</span>}
    </div>
  )
}

function layoutRadial(entities: KnowledgeEntity[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  if (entities.length === 0) return pos
  // first entity center
  pos[entities[0].id] = { x: 50, y: 48 }
  const rest = entities.slice(1)
  rest.forEach((e, i) => {
    const angle = (i / Math.max(1, rest.length)) * Math.PI * 2 - Math.PI / 2
    const r = 28 + (i % 3) * 4
    pos[e.id] = {
      x: 50 + Math.cos(angle) * r,
      y: 48 + Math.sin(angle) * r * 0.85,
    }
  })
  return pos
}
