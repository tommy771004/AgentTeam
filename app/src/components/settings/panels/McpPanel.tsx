import { useMemo, useState } from 'react'
import { pluginRegistry } from '../../../agent/hermes/plugins'
import { listPluginSecretMeta } from '../../../agent/hermes/pluginSecrets'
import {
  listAllMcpTools,
  mcpEnsureSession,
  mcpListSessions,
  mcpStopSession,
} from '../../../agent/hermes/mcp'
import { customToolsForSettings, listPendingToolPackages } from '../../../agent/tools/customTools'
import type { LlmSettings, McpServerConfig } from '../../../agent/types'
import { useLearningStore } from '../../../store/learningStore'
import { useOpenCodeConfigStore } from '../../../store/opencodeConfigStore'
import { useProjectStore } from '../../../store/projectStore'
import {
  SettingsGroup,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
  settingsInputCls,
} from '../SettingsChrome'
import { SettingsAnchor, SettingsField, type SettingsFieldContext } from '../SettingsField'

/**
 * Settings registry restructure（spec 3/6）— MCP 伺服器節（伺服器清單、探測、工具封裝審核、憑證）。
 *
 * 純搬移：欄位、順序、控件與寫入路徑與搬移前逐項相同；
 * 可見性一律交給 registry 的 tier 決定。
 */
export function McpPanel({
  settings,
  set,
  fieldCtx,
}: {
  settings: LlmSettings
  set: (patch: Partial<LlmSettings>) => void
  fieldCtx: SettingsFieldContext
}) {
  const projectRoot = useProjectStore((s) => s.root)
  const [mcpProbe, setMcpProbe] = useState<string | null>(null)
  const [mcpSessions, setMcpSessions] = useState<string | null>(null)
  const [mcpHealthById, setMcpHealthById] = useState<Record<string, string>>({})
  const [customToolsDraft, setCustomToolsDraft] = useState('')
  const [customToolsError, setCustomToolsError] = useState<string | null>(null)
  const ocCandidates = useOpenCodeConfigStore((s) => s.candidates)
  const ocSources = useOpenCodeConfigStore((s) => s.sources)
  const adoptOcCandidate = useOpenCodeConfigStore((s) => s.adoptCandidate)
  const oc = useOpenCodeConfigStore()
  const approveToolPackage = useLearningStore((s) => s.approveToolPackage)
  const pluginsTick = useLearningStore((s) => s.plugins)

  const customToolSecretKeys = useMemo(() => {
    const found = new Set<string>()
    const re = /{{\s*secret:([A-Za-z0-9_.-]+)\s*}}/g
    // Settings custom tools + enabled plugin/connector templates
    for (const tool of customToolsForSettings(settings)) {
      const text = JSON.stringify(tool.template || {})
      for (const match of text.matchAll(re)) found.add(match[1])
    }
    // Known secret owners from installed packages / MCP secretPluginId
    for (const plugin of pluginRegistry.list()) {
      if (plugin.connectorAuth?.hasCredential || plugin.enabled) {
        // connector ids often double as secret keys
        if (plugin.id.endsWith('-connector') || plugin.id === 'brave-search' || plugin.id === 'postgres-dsn') {
          found.add(plugin.id)
        }
      }
      for (const server of plugin.mcpServers || []) {
        if (server.secretPluginId) found.add(server.secretPluginId)
      }
    }
    // Already stored secrets
    for (const key of Object.keys(settings.customToolSecrets || {})) found.add(key)
    for (const { id } of listPluginSecretMeta()) found.add(id)
    return [...found].sort()
  }, [settings.customTools, settings.customToolSecrets, pluginsTick])

  return (
    <>
          <SettingsGroup title="MCP">
            <SettingsField
              id="mcp.mcpEnabled"
              ctx={fieldCtx}
              control={
                <SettingsToggle
                  checked={settings.mcpEnabled === true}
                  onChange={(v) => set({ mcpEnabled: v })}
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Plugin permission summary">
            {oc.plugins.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-outline">目前 config 沒有 npm plugin reference；`.opencode/plugins` 本地檔案仍維持 OpenCode 自己的載入範圍。</p>
            ) : (
              <div className="divide-y divide-white/10">
                {oc.plugins.map((plugin) => (
                  <div key={plugin} className="px-4 py-2.5">
                    <div className="text-[12px] font-mono text-on-surface">{plugin}</div>
                    <div className="text-[10px] text-amber-300/90 mt-0.5">permission：未知（manifest reference only） · 不自動安裝／不執行 plugin code</div>
                  </div>
                ))}
              </div>
            )}
          </SettingsGroup>

          <SettingsGroup title="Per-agent MCP 存取">
            <div className="px-4 py-2 text-[11px] text-outline leading-relaxed">
              未設定 agent 會沿用全域 MCP；一旦切換成自訂清單，空清單代表該 agent 完全不能使用 MCP。這是 allowlist，不會放寬 OpenCode permission deny。
            </div>
            {(() => {
              const servers = (settings.mcpServers || []).filter((server) => server.enabled)
              const configured = settings.mcpAgentServers || {}
              const agentRows = [
                { id: 'build', label: 'Build（內建）' },
                { id: 'plan', label: 'Plan（內建）' },
                ...oc.agents
                  .filter((agent) => !agent.hidden && agent.id !== 'build' && agent.id !== 'plan')
                  .map((agent) => ({ id: agent.id, label: `${agent.label}（${agent.id}）` })),
              ].filter((agent, index, rows) => rows.findIndex((x) => x.id === agent.id) === index)
              if (!agentRows.length) {
                return <p className="px-4 py-3 text-[12px] text-outline">尚未載入 OpenCode agent；先到 OpenCode 分頁重新整理。</p>
              }
              return (
                <div className="divide-y divide-white/10">
                  {agentRows.map((agent) => {
                    const custom = Object.prototype.hasOwnProperty.call(configured, agent.id)
                    const selected = new Set(custom ? configured[agent.id] || [] : servers.map((server) => server.id))
                    return (
                      <div key={agent.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-on-surface">{agent.label}</span>
                          <label className="flex items-center gap-1 text-[10px] text-outline">
                            <input
                              type="checkbox"
                              checked={!custom}
                              onChange={(event) => {
                                const next = { ...configured }
                                if (event.target.checked) delete next[agent.id]
                                else next[agent.id] = servers.map((server) => server.id)
                                set({ mcpAgentServers: next })
                              }}
                              className="accent-primary-container"
                            />
                            沿用全域
                          </label>
                        </div>
                        {custom && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {servers.length === 0 ? (
                              <span className="text-[11px] text-outline">尚無啟用中的 MCP server</span>
                            ) : servers.map((server) => (
                              <label key={server.id} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-[11px]">
                                <input
                                  type="checkbox"
                                  checked={selected.has(server.id)}
                                  onChange={(event) => {
                                    const ids = new Set(configured[agent.id] || [])
                                    if (event.target.checked) ids.add(server.id)
                                    else ids.delete(server.id)
                                    set({ mcpAgentServers: { ...configured, [agent.id]: [...ids] } })
                                  }}
                                  className="accent-primary-container"
                                />
                                <span className="truncate">{server.name}</span>
                                <span className="ml-auto text-[9px] text-outline">{mcpHealthById[server.id] || '未探測'}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </SettingsGroup>

          <SettingsGroup title="宣告式自訂工具">
            {/* P1-C: tool packages awaiting privilege review */}
            {(() => {
              const pending = listPendingToolPackages()
              if (!pending.length) return null
              return (
                <SettingsStack title="Tool package 權限審核（待核准）">
                  <div className="space-y-1.5">
                    {pending.map((p) => (
                      <div
                        key={p.pluginId}
                        className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/25 bg-amber-500/5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-on-surface font-[family-name:var(--font-mono)]">
                            {p.packageId}@{p.version}
                            <span className="ml-2 text-[10px] text-outline">#{p.fingerprint}</span>
                          </span>
                          <span className="block text-[11px] text-amber-300/90">
                            暫扣工具（write/destructive/bash）：{p.withheld.join(', ')}
                          </span>
                          <span className="block text-[10px] text-outline mt-0.5">
                            核准後解鎖 schema；執行時仍逐次 HITL 審批
                          </span>
                        </span>
                        <button
                          type="button"
                          className={`${settingsBtnCls} shrink-0`}
                          onClick={async () => {
                            const r = await approveToolPackage(p.pluginId)
                            setCustomToolsError(r.ok ? null : r.message)
                          }}
                        >
                          核准權限面
                        </button>
                      </div>
                    ))}
                  </div>
                </SettingsStack>
              )
            })()}
            <SettingsField id="safety.customTools" ctx={fieldCtx}>
              <textarea
                className={settingsInputCls + ' min-h-[180px] resize-y font-[family-name:var(--font-mono)] text-[11px]'}
                value={customToolsDraft || JSON.stringify(settings.customTools || [], null, 2)}
                onChange={(event) => { setCustomToolsDraft(event.target.value); setCustomToolsError(null) }}
                onBlur={() => {
                  try {
                    const parsed = customToolsDraft.trim() ? JSON.parse(customToolsDraft) : []
                    if (!Array.isArray(parsed)) throw new Error('必須是 JSON array')
                    set({ customTools: parsed })
                    setCustomToolsDraft('')
                  } catch (error) {
                    setCustomToolsError(error instanceof Error ? error.message : String(error))
                  }
                }}
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-outline">
                支援 http_template 與 bash_template；bash 永遠需核准。外掛 manifest 的 customTools 也會自動載入。
                下方 secret 鍵會掃描設定 JSON + 已安裝 plugin 模板 + 市集授權 id。
              </p>
              {customToolsError && <p className="mt-1 text-[11px] text-error">JSON 無法儲存：{customToolsError}</p>}
            </SettingsField>
            {customToolSecretKeys.map((key) => (
              <SettingsStack key={key} title={`Secret · ${key}`}>
                <input
                  type="password"
                  className={settingsInputCls}
                  value={settings.customToolSecrets?.[key] || ''}
                  onChange={(event) => set({ customToolSecrets: { ...(settings.customToolSecrets || {}), [key]: event.target.value } })}
                  autoComplete="off"
                  placeholder={`{{secret:${key}}} / 市集授權會自動寫入；也可在此覆寫`}
                />
              </SettingsStack>
            ))}
          </SettingsGroup>

          <SettingsAnchor id="mcp.mcpServers" ctx={fieldCtx}>
          <div className="space-y-3">
            {(settings.mcpServers || []).map((s, idx) => (
              <div
                key={s.id}
                className="border border-white/10 rounded-lg p-3 space-y-2 bg-surface/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    className={settingsInputCls}
                    value={s.name}
                    onChange={(e) => {
                      const next = [...(settings.mcpServers || [])]
                      next[idx] = { ...s, name: e.target.value }
                      set({ mcpServers: next })
                    }}
                    placeholder="顯示名稱"
                  />
                  <label className="flex items-center gap-1 text-xs shrink-0">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => {
                        const next = [...(settings.mcpServers || [])]
                        next[idx] = { ...s, enabled: e.target.checked }
                        set({ mcpServers: next })
                      }}
                      className="accent-primary-container"
                    />
                    啟用
                  </label>
                  <button
                    type="button"
                    className="text-xs text-error shrink-0"
                    onClick={() => {
                      const removedId = s.id
                      const nextAccess = Object.fromEntries(
                        Object.entries(settings.mcpAgentServers || {}).map(([agent, ids]) => [
                          agent,
                          ids.filter((id) => id !== removedId),
                        ]),
                      )
                      set({
                        mcpServers: (settings.mcpServers || []).filter((_, i) => i !== idx),
                        mcpAgentServers: nextAccess,
                      })
                    }}
                  >
                    刪除
                  </button>
                </div>
                <select
                  className={settingsInputCls}
                  value={s.transport}
                  onChange={(e) => {
                    const next = [...(settings.mcpServers || [])]
                    next[idx] = {
                      ...s,
                      transport: e.target.value as McpServerConfig['transport'],
                    }
                    set({ mcpServers: next })
                  }}
                >
                  <option value="http">HTTP JSON-RPC</option>
                  <option value="stdio">stdio（僅 Electron）</option>
                </select>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-outline font-[family-name:var(--font-mono)]">
                  <span>health: {mcpHealthById[s.id] || '未探測'}</span>
                  <span>secret owner: {s.secretPluginId || s.pluginId || 'manual'}</span>
                </div>
                {s.transport === 'http' ? (
                  <>
                    <input
                      className={settingsInputCls}
                      value={s.url || ''}
                      onChange={(e) => {
                        const next = [...(settings.mcpServers || [])]
                        next[idx] = { ...s, url: e.target.value }
                        set({ mcpServers: next })
                      }}
                      placeholder="http://127.0.0.1:3100/mcp"
                    />
                    <input
                      className={settingsInputCls}
                      type="password"
                      value={s.authToken || ''}
                      onChange={(e) => {
                        const next = [...(settings.mcpServers || [])]
                        next[idx] = { ...s, authToken: e.target.value }
                        set({ mcpServers: next })
                      }}
                      placeholder="Bearer Token（選填）"
                    />
                  </>
                ) : (
                  <>
                    <input
                      className={settingsInputCls}
                      value={s.command || ''}
                      onChange={(e) => {
                        const next = [...(settings.mcpServers || [])]
                        next[idx] = { ...s, command: e.target.value }
                        set({ mcpServers: next })
                      }}
                      placeholder="指令，例如 npx"
                    />
                    <input
                      className={settingsInputCls}
                      value={(s.args || []).join(' ')}
                      onChange={(e) => {
                        const next = [...(settings.mcpServers || [])]
                        next[idx] = {
                          ...s,
                          args: e.target.value.split(/\s+/).filter(Boolean),
                        }
                        set({ mcpServers: next })
                      }}
                      placeholder="參數，空白分隔"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          </SettingsAnchor>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const id = `mcp_${Math.random().toString(36).slice(2, 8)}`
                const row: McpServerConfig = {
                  id,
                  name: '新 MCP 伺服器',
                  enabled: true,
                  transport: 'http',
                  url: 'http://127.0.0.1:3100/mcp',
                }
                set({ mcpServers: [...(settings.mcpServers || []), row],
                })
              }}
              className="px-3 py-2 rounded border border-white/15 text-xs font-semibold hover:border-primary/40 hover:text-primary"
            >
              新增伺服器
            </button>
            <button
              type="button"
              className={settingsBtnCls}
              onClick={async () => {
                if (!window.subagents?.mcp?.discover) { setMcpProbe('匯入 MCP 需 Electron'); return }
                const found = await window.subagents.mcp.discover(projectRoot || undefined)
                const current = settings.mcpServers || []
                const exists = new Set(current.map((s) => `${s.transport}:${s.url || s.command || ''}:${(s.args || []).join('\u0000')}`))
                const additions = found.servers.filter((s) => !exists.has(`${s.transport}:${s.url || s.command || ''}:${(s.args || []).join('\u0000')}`))
                if (additions.length) set({ mcpServers: [...current, ...additions], mcpEnabled: true })
                setMcpProbe(additions.length ? `已匯入 ${additions.length} 個 MCP（未複製 token／env secret）\n${found.sources.join('\n')}` : '未發現新 MCP 設定（或皆已存在）')
              }}
            >
              一鍵匯入 MCP
            </button>
            <button
              type="button"
              onClick={async () => {
                /* already live */ await Promise.resolve()
                setMcpProbe('探測中…')
                try {
                  const nextHealth: Record<string, string> = {}
                  const tools = [] as Awaited<ReturnType<typeof listAllMcpTools>>
                  for (const server of (settings.mcpServers || []).filter((s) => s.enabled)) {
                    try {
                      const serverTools = await listAllMcpTools([server], settings)
                      const error = serverTools.find((tool) => tool.name === '__error__')
                      nextHealth[server.id] = error ? `error` : `${serverTools.length} tools`
                      tools.push(...serverTools)
                    } catch {
                      nextHealth[server.id] = 'error'
                    }
                  }
                  setMcpHealthById(nextHealth)
                  setMcpProbe(
                    tools.length
                      ? tools
                          .map((t) => `${t.serverName}/${t.name}`)
                          .join('\n')
                      : '無工具或連線失敗',
                  )
                } catch (e) {
                  setMcpProbe(e instanceof Error ? e.message : String(e))
                }
              }}
              className="px-3 py-2 rounded border border-primary/40 text-primary text-xs font-semibold"
            >
              探測工具列表
            </button>
            <button
              type="button"
              onClick={async () => {
                /* already live */ await Promise.resolve()
                const lines: string[] = []
                for (const s of (settings.mcpServers || []).filter(
                  (x) => x.enabled && x.transport === 'stdio',
                )) {
                  const r = await mcpEnsureSession(s, settings)
                  setMcpHealthById((prev) => ({
                    ...prev,
                    [s.id]: r.ok ? `stdio alive=${r.status?.alive ? 'yes' : 'no'}` : 'error',
                  }))
                  lines.push(
                    r.ok
                      ? `✓ ${s.name} pid=${r.status?.pid} alive=${r.status?.alive}`
                      : `✗ ${s.name}: ${r.error}`,
                  )
                }
                setMcpSessions(lines.join('\n') || '無啟用的 stdio 伺服器')
                const all = await mcpListSessions()
                if (all.length) {
                  setMcpSessions(
                    (prev) =>
                      `${prev || ''}\n── sessions ──\n${all
                        .map((x) => `${x.id} pid=${x.pid} reqs=${x.requestCount}`)
                        .join('\n')}`,
                  )
                }
              }}
              className="px-3 py-2 rounded border border-white/15 text-xs font-semibold hover:border-primary/40 hover:text-primary"
            >
              啟動長連線
            </button>
            <button
              type="button"
              onClick={async () => {
                for (const s of settings.mcpServers || []) {
                  await mcpStopSession(s.id)
                }
                await window.subagents?.mcp?.stdioStopAll?.()
                setMcpSessions('已停止所有 stdio session')
              }}
              className="px-3 py-2 rounded border border-white/15 text-xs font-semibold"
            >
              停止全部 session
            </button>
          </div>
          {mcpProbe && (
            <pre className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
              {mcpProbe}
            </pre>
          )}
          {mcpSessions && (
            <pre className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar mt-2">
              {mcpSessions}
            </pre>
          )}

          {/* W3: OpenCode 匯入報告 — 每個欄位三擇一：暫時套用 / 待採用 / 不支援 */}
          <SettingsGroup title="OpenCode 匯入報告">
            <p className="text-[12px] text-on-surface-variant mb-2 leading-relaxed px-1">
              偵測到的設定不會靜默覆蓋全域：暫時套用僅影響本 run；待採用需按「採用」；
              不支援欄位顯式列出。來源：{ocSources.join('、') || '（尚未偵測到 opencode 設定）'}
            </p>
            {ocCandidates.length === 0 ? (
              <p className="text-[12px] text-outline px-1">無設定候選。</p>
            ) : (
              <div className="space-y-1.5">
                {ocCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-2 px-3 py-2 rounded-xl border border-white/10"
                  >
                    <span
                      className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        c.applyMode === 'temporary'
                          ? 'bg-primary/15 text-primary'
                          : c.applyMode === 'review'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-white/10 text-outline'
                      }`}
                    >
                      {c.applyMode === 'temporary'
                        ? '暫時套用'
                        : c.applyMode === 'review'
                          ? c.adopted
                            ? '已採用'
                            : '待採用'
                          : '不支援'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-on-surface font-[family-name:var(--font-mono)]">
                        {c.field}
                      </span>
                      <span className="block text-[11px] text-on-surface-variant truncate">
                        {c.value}
                      </span>
                      {c.note && (
                        <span className="block text-[10px] text-outline mt-0.5">{c.note}</span>
                      )}
                    </span>
                    {c.applyMode === 'review' && !c.adopted && (
                      <button
                        type="button"
                        className={`${settingsBtnCls} shrink-0`}
                        onClick={async () => {
                          const r = await adoptOcCandidate(c.id)
                          setMcpProbe(r.message)
                        }}
                      >
                        採用
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SettingsGroup>
    </>
  )
}
