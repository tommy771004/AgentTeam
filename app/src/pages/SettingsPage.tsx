import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { APPROVAL_MODE_DEFS } from '../agent/approvalModes'
import { ThemePage } from '../components/SectionNav'
import {
  PillSelect,
  SettingsGroup,
  SettingsHeader,
  SettingsRow,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
  settingsBtnPrimaryCls,
  settingsInputCls,
} from '../components/settings/SettingsChrome'
import { useSettingsStore } from '../store/settingsStore'
import { useLearningStore } from '../store/learningStore'
import { modelsGroupedByCliProvider } from '../agent/cliProviders'
import type {
  McpServerConfig,
  PersonalityPreset,
  ThemePreference,
  ReducedMotionPreference,
  EnterBehavior,
  FollowUpMode,
} from '../agent/types'
import {
  listAllMcpTools,
  mcpEnsureSession,
  mcpListSessions,
  mcpStopSession,
} from '../agent/hermes/mcp'
import { useGatewayStore } from '../store/gatewayStore'
import { useOpenCodeConfigStore } from '../store/opencodeConfigStore'
import { useProjectStore } from '../store/projectStore'
import { getLiveSlashCommands } from '../commands/registry'
import {
  eventToChord,
  formatChord,
  useShortcutStore,
} from '../store/shortcutStore'
import { BUILTIN_CAPABILITIES } from '../agent/capabilities'
import { skillsStore } from '../agent/hermes/skills'
import { recommendToolTuning } from '../agent/modelTuning'
import {
  OAUTH_REDIRECT_URI,
  PLUGIN_OAUTH_PROVIDERS,
} from '../agent/hermes/pluginOAuth'
import { listPluginSecrets, secretNeedsRefresh } from '../agent/hermes/pluginSecrets'
import { customToolsForSettings } from '../agent/tools/customTools'
import { pluginRegistry } from '../agent/hermes/plugins'

const SECTION_GROUPS = [
  { id: 'personal', label: '個人' },
  { id: 'agent', label: '代理' },
  { id: 'integrate', label: '整合' },
  { id: 'system', label: '系統' },
]

const SECTIONS = [
  { id: 'general', label: '一般', icon: 'tune', group: 'personal' },
  { id: 'appearance', label: '外觀', icon: 'palette', group: 'personal' },
  { id: 'personalization', label: '個人化', icon: 'person', group: 'personal' },
  { id: 'memory', label: '記憶', icon: 'psychology', group: 'personal' },
  { id: 'data', label: '資料控制', icon: 'database', group: 'personal' },
  { id: 'shortcuts', label: '鍵盤快捷鍵', icon: 'keyboard', group: 'personal' },
  { id: 'safety', label: '組態', icon: 'shield', group: 'agent' },
  { id: 'roles', label: '角色模型', icon: 'groups', group: 'agent' },
  { id: 'llm', label: '語言模型', icon: 'smart_toy', group: 'agent' },
  { id: 'cli', label: 'CLI 授權', icon: 'terminal', group: 'agent' },
  { id: 'opencode', label: 'OpenCode', icon: 'auto_awesome', group: 'agent' },
  { id: 'git', label: 'Git', icon: 'commit', group: 'integrate' },
  { id: 'webhook', label: 'Webhook', icon: 'webhook', group: 'integrate' },
  { id: 'gateway', label: '訊息閘道', icon: 'forum', group: 'integrate' },
  { id: 'mcp', label: 'MCP 伺服器', icon: 'extension', group: 'integrate' },
  { id: 'oauth', label: '外掛 OAuth', icon: 'key', group: 'integrate' },
  { id: 'bundle', label: '匯出匯入', icon: 'import_export', group: 'system' },
]

const SECTION_META: Record<string, { title: string; subtitle: string }> = {
  general: {
    title: '一般',
    subtitle: '送出快捷鍵、執行中追問行為、通知與建議提示。',
  },
  appearance: {
    title: '外觀',
    subtitle: '主題、字級、動畫與側欄材質。',
  },
  personalization: {
    title: '個人化',
    subtitle: '人格與自訂指令會注入系統提示，套用到所有對話。',
  },
  memory: {
    title: '記憶',
    subtitle: '跨對話保存偏好與教訓；可關閉讀寫或管理單條記憶。',
  },
  data: {
    title: '資料控制',
    subtitle: '臨時對話、封存與本機對話清除（不含雲端帳戶選項）。',
  },
  shortcuts: {
    title: '鍵盤快捷鍵',
    subtitle: '點擊快捷鍵按鈕後按下新組合即可自訂；立即生效。',
  },
  safety: {
    title: '組態',
    subtitle: '設定核准政策、工具與安全循環門檻。',
  },
  roles: {
    title: '角色模型',
    subtitle: '依 CLI 類別自動帶出已授權模型；留空＝全域預設。',
  },
  llm: {
    title: '語言模型',
    subtitle: 'OpenAI 相容 API 端點與預設模型。',
  },
  cli: {
    title: 'CLI 授權',
    subtitle: '各家 CLI／API 與模型目錄，供對話右下角選單使用。',
  },
  opencode: {
    title: 'OpenCode',
    subtitle: '合併 opencode.json 與 agents／commands。',
  },
  git: {
    title: 'Git',
    subtitle: '分支前綴、Commit／PR 指引會注入代理提示。',
  },
  webhook: {
    title: 'Webhook',
    subtitle: '本機主動觸發接收伺服器。',
  },
  gateway: {
    title: '訊息閘道',
    subtitle: 'Telegram 等外部訊息通道。',
  },
  mcp: {
    title: 'MCP 伺服器',
    subtitle: '外部工具協定（HTTP / stdio 長連線）。',
  },
  oauth: {
    title: '外掛 OAuth',
    subtitle: 'Connector Client ID / Secret；裝置碼與本機回呼共用。Redirect：127.0.0.1:19789。',
  },
  bundle: {
    title: '匯出匯入',
    subtitle: '設定、排程與事件規則備份（含 API 金鑰，請妥善保管）。',
  },
}

export function SettingsPage() {
  const { settings, load, update, testConnection, exportBundle, importBundle } = useSettingsStore()
  const [section, setSection] = useState('general')
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [bundleMsg, setBundleMsg] = useState<string | null>(null)
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null)
  const [mcpProbe, setMcpProbe] = useState<string | null>(null)
  const [mcpSessions, setMcpSessions] = useState<string | null>(null)
  const [gatewayMsg, setGatewayMsg] = useState<string | null>(null)
  const [cliMsg, setCliMsg] = useState<string | null>(null)
  const [dataMsg, setDataMsg] = useState<string | null>(null)
  const gatewayInbound = useGatewayStore((s) => s.inbound)
  const bgJobs = useGatewayStore((s) => s.jobs)
  const projectRoot = useProjectStore((s) => s.root)
  const oc = useOpenCodeConfigStore()
  const memory = useLearningStore((s) => s.memory)
  const loadLearning = useLearningStore((s) => s.load)
  const deleteMemoryEntry = useLearningStore((s) => s.deleteMemoryEntry)
  const clearMemories = useLearningStore((s) => s.clearMemories)
  const appendMemory = useLearningStore((s) => s.appendMemory)
  const setUserProfile = useLearningStore((s) => s.setUserProfile)
  const [newMemory, setNewMemory] = useState('')
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const setShortcutChord = useShortcutStore((s) => s.setChord)
  const resetShortcuts = useShortcutStore((s) => s.resetAll)
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [customToolsDraft, setCustomToolsDraft] = useState('')
  const [customToolsError, setCustomToolsError] = useState<string | null>(null)
  const [oauthRefreshMsg, setOauthRefreshMsg] = useState<string | null>(null)
  const refreshPluginTokens = useLearningStore((s) => s.refreshPluginTokens)
  // Recompute secret key list when plugins change
  const pluginsTick = useLearningStore((s) => s.plugins)

  /** Instant apply — no save button */
  const set = (patch: Partial<typeof settings>) => {
    void update(patch)
  }

  // Capture new shortcut chord
  useEffect(() => {
    if (!capturingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        return
      }
      const chord = eventToChord(e)
      if (!chord) return
      setShortcutChord(
        capturingId as 'slashMenu' | 'focusComposer' | 'toggleConsole' | 'newThread',
        chord,
      )
      setCapturingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturingId, setShortcutChord])

  useEffect(() => {
    void load()
    void loadLearning()
  }, [load, loadLearning])

  useEffect(() => {
    if (section === 'opencode') void oc.hydrate(projectRoot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, projectRoot])

  // Auto-apply webhook when related settings change
  useEffect(() => {
    if (!window.subagents?.webhook) return
    let cancelled = false
    void (async () => {
      try {
        if (settings.webhookEnabled) {
          const st = await window.subagents!.webhook!.start({
            port: settings.webhookPort || 8787,
            token: settings.webhookToken || '',
          })
          if (!cancelled) {
            setWebhookStatus(
              st.running
                ? `Webhook 聆聽中：${st.url}`
                : `Webhook 失敗：${st.lastError || '未知'}`,
            )
          }
        } else {
          await window.subagents!.webhook!.stop()
          if (!cancelled) setWebhookStatus(null)
        }
      } catch (e) {
        if (!cancelled) setWebhookStatus(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [settings.webhookEnabled, settings.webhookPort, settings.webhookToken])

  // Auto-refresh gateway status when telegram settings change (start/stop is in App.tsx)
  useEffect(() => {
    if (!window.subagents?.gateway?.status) return
    let cancelled = false
    void (async () => {
      // brief delay so App bootstrap can start/stop first
      await new Promise((r) => setTimeout(r, 200))
      if (cancelled) return
      try {
        const st = await window.subagents!.gateway!.status()
        if (!cancelled) {
          setGatewayMsg(
            settings.telegramEnabled
              ? `${st.telegram.running ? '運行中' : '已停止'}${
                  st.telegram.botUsername ? ` @${st.telegram.botUsername}` : ''
                }${st.telegram.lastError ? ` · ${st.telegram.lastError}` : ''}`
              : '已關閉',
          )
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    settings.telegramEnabled,
    settings.telegramBotToken,
    settings.telegramAllowedChatIds,
  ])

  const onTest = async () => {
    setTesting(true)
    setTestMsg(null)
    const r = await testConnection()
    setTestMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`)
    setTesting(false)
  }

  const setRoleModel = (role: keyof NonNullable<typeof settings.roleModels>, value: string) => {
    set({
      roleModels: {
        orchestrator: settings.roleModels?.orchestrator || '',
        analyst: settings.roleModels?.analyst || '',
        synthesizer: settings.roleModels?.synthesizer || '',
        executor: settings.roleModels?.executor || '',
        [role]: value,
      },
    })
  }

  /** Role model dropdown options: grouped by enabled+authorized CLI providers */
  const roleModelGroups = useMemo(
    () => modelsGroupedByCliProvider(settings.cliProviders),
    [settings.cliProviders],
  )
  const allRoleModelIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of roleModelGroups) {
      for (const m of g.models) ids.add(m.id)
    }
    if (settings.model?.trim()) ids.add(settings.model.trim())
    for (const id of settings.discoveredModels || []) ids.add(id)
    return ids
  }, [roleModelGroups, settings.model, settings.discoveredModels])
  const suggestedRoleModels = useMemo(() => {
    const available = roleModelGroups.flatMap((group) => group.models)
    const rank = (model: (typeof available)[number], preferred: 'strong' | 'fast') => {
      const depths = model.depths || []
      const score = preferred === 'strong'
        ? (depths.includes('ultra') ? 5 : depths.includes('max') ? 4 : depths.includes('deep') ? 3 : depths.includes('standard') ? 2 : 1)
        : (depths.includes('fast') ? 5 : depths.includes('standard') ? 3 : 1)
      return score
    }
    const strongest = [...available].sort((a, b) => rank(b, 'strong') - rank(a, 'strong'))[0]?.id || settings.model || settings.discoveredModels?.[0] || ''
    const fastest = [...available].sort((a, b) => rank(b, 'fast') - rank(a, 'fast'))[0]?.id || strongest
    return { orchestrator: strongest, synthesizer: strongest, analyst: fastest, executor: fastest }
  }, [roleModelGroups, settings.model, settings.discoveredModels])
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
    for (const { id } of listPluginSecrets()) found.add(id)
    return [...found].sort()
  }, [settings.customTools, settings.customToolSecrets, pluginsTick])
  const toolTuning = useMemo(
    () => recommendToolTuning(settings.model || settings.roleModels?.orchestrator || ''),
    [settings.model, settings.roleModels?.orchestrator],
  )

  const meta = SECTION_META[section] || { title: '設定', subtitle: '' }

  return (
    <ThemePage
      title="設定"
      sections={SECTIONS}
      groups={SECTION_GROUPS}
      activeId={section}
      onChange={setSection}
      hideNavTitle
    >
      <div className="flex flex-col max-w-[820px] pb-10">
        <SettingsHeader title={meta.title} subtitle={meta.subtitle} />

        {section === 'general' && (
          <>
            <SettingsGroup title="輸入與行為">
              <SettingsRow
                title="送出快捷鍵"
                description="選擇 Enter 或 ⌘/Ctrl+Enter 送出訊息"
                control={
                  <PillSelect
                    value={settings.enterBehavior || 'enter'}
                    onChange={(v) =>
                      set({ enterBehavior: v as EnterBehavior })
                    }
                  >
                    <option value="enter">Enter 送出</option>
                    <option value="cmdEnter">⌘/Ctrl+Enter 送出</option>
                  </PillSelect>
                }
              />
              <SettingsRow
                title="執行中追問行為"
                description="代理忙碌時，新訊息要轉向目前執行或排隊"
                control={
                  <PillSelect
                    value={settings.followUpMode || 'steer'}
                    onChange={(v) =>
                      set({ followUpMode: v as FollowUpMode })
                    }
                  >
                    <option value="steer">轉向（Steer）</option>
                    <option value="queue">排隊（Queue）</option>
                  </PillSelect>
                }
              />
            </SettingsGroup>
            <SettingsGroup title="通知">
              <SettingsRow
                title="任務完成通知"
                description="執行結束時顯示桌面通知"
                control={
                  <SettingsToggle
                    checked={settings.notifyOnComplete !== false}
                    onChange={(v) => set({ notifyOnComplete: v })}
                  />
                }
              />
              <SettingsRow
                title="完成提示音"
                description="任務結束時播放輕提示音"
                control={
                  <SettingsToggle
                    checked={settings.soundOnComplete === true}
                    onChange={(v) => set({ soundOnComplete: v })}
                  />
                }
              />
              <SettingsRow
                title="執行中防止睡眠"
                description="長任務時盡量保持系統喚醒（需 Electron）"
                control={
                  <SettingsToggle
                    checked={settings.preventSleepWhileRunning === true}
                    onChange={(v) => set({ preventSleepWhileRunning: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="建議">
              <SettingsRow
                title="建議提示"
                description="空對話時顯示 Suggested prompts"
                control={
                  <SettingsToggle
                    checked={settings.ambientSuggestions !== false}
                    onChange={(v) => set({ ambientSuggestions: v })}
                  />
                }
              />
            </SettingsGroup>
          </>
        )}

        {section === 'appearance' && (
          <>
            <SettingsGroup title="主題">
              <SettingsRow
                title="外觀主題"
                description="深色、淺色或跟隨系統"
                control={
                  <PillSelect
                    value={settings.theme || 'dark'}
                    onChange={(v) => set({ theme: v as ThemePreference })}
                  >
                    <option value="dark">深色</option>
                    <option value="light">淺色</option>
                    <option value="system">系統</option>
                  </PillSelect>
                }
              />
              <SettingsRow
                title="減少動畫"
                description="降低動效或跟隨系統偏好"
                control={
                  <PillSelect
                    value={settings.reducedMotion || 'system'}
                    onChange={(v) =>
                      set({ reducedMotion: v as ReducedMotionPreference,
                      })
                    }
                  >
                    <option value="system">系統</option>
                    <option value="on">開啟</option>
                    <option value="off">關閉</option>
                  </PillSelect>
                }
              />
              <SettingsRow
                title="側欄半透明"
                description="Liquid Glass 材質側欄"
                control={
                  <SettingsToggle
                    checked={settings.translucentSidebar !== false}
                    onChange={(v) => set({ translucentSidebar: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="字級">
              <SettingsRow
                title="介面字級"
                description={`${settings.uiFontSize ?? 14}px`}
                control={
                  <input
                    type="range"
                    min={12}
                    max={18}
                    value={settings.uiFontSize ?? 14}
                    onChange={(e) =>
                      set({ uiFontSize: Number(e.target.value) })
                    }
                    className="w-36 accent-primary"
                  />
                }
              />
              <SettingsRow
                title="程式碼字級"
                description={`${settings.codeFontSize ?? 13}px`}
                control={
                  <input
                    type="range"
                    min={11}
                    max={16}
                    value={settings.codeFontSize ?? 13}
                    onChange={(e) =>
                      set({ codeFontSize: Number(e.target.value) })
                    }
                    className="w-36 accent-primary"
                  />
                }
              />
            </SettingsGroup>
          </>
        )}

        {section === 'personalization' && (
          <>
            <SettingsGroup title="人格">
              <SettingsRow
                title="預設人格"
                description="改變語氣，不改變模型能力"
                control={
                  <PillSelect
                    value={settings.personality || 'default'}
                    onChange={(v) =>
                      set({ personality: v as PersonalityPreset })
                    }
                  >
                    <option value="default">預設</option>
                    <option value="none">無（中性）</option>
                    <option value="friendly">友善</option>
                    <option value="efficient">務實精簡</option>
                    <option value="professional">專業</option>
                    <option value="candid">直率</option>
                    <option value="quirky">俏皮</option>
                  </PillSelect>
                }
              />
            </SettingsGroup>
            <SettingsGroup title="自訂指令">
              <SettingsStack
                title="關於你"
                description="職業、專案、偏好語言、常用工具…"
              >
                <textarea
                  className={settingsInputCls + ' min-h-[96px] resize-y'}
                  value={settings.customAboutUser || ''}
                  onChange={(e) => set({ customAboutUser: e.target.value })}
                  placeholder="寫下希望代理知道的背景…"
                />
              </SettingsStack>
              <SettingsStack
                title="希望如何回覆"
                description="結構、語言、emoji、程式碼風格…"
              >
                <textarea
                  className={settingsInputCls + ' min-h-[96px] resize-y'}
                  value={settings.customResponseStyle || ''}
                  onChange={(e) =>
                    set({ customResponseStyle: e.target.value })
                  }
                  placeholder="例如：先結論再步驟、繁中、少 emoji…"
                />
              </SettingsStack>
            </SettingsGroup>
          </>
        )}

        {section === 'memory' && (
          <>
            <SettingsGroup title="記憶控制">
              <SettingsRow
                title="啟用記憶"
                description="讀取並注入跨對話記憶"
                control={
                  <SettingsToggle
                    checked={settings.memoryEnabled !== false}
                    onChange={(v) => set({ memoryEnabled: v })}
                  />
                }
              />
              <SettingsRow
                title="自動寫入"
                description="成功任務摘要與工具可寫入記憶"
                control={
                  <SettingsToggle
                    checked={settings.memoryWriteEnabled !== false}
                    onChange={(v) => set({ memoryWriteEnabled: v })}
                  />
                }
              />
              <SettingsRow
                title="參考對話歷史"
                description="允許引用過去對話脈絡"
                control={
                  <SettingsToggle
                    checked={settings.referenceChatHistory !== false}
                    onChange={(v) => set({ referenceChatHistory: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="使用者檔案">
              <SettingsStack title="USER profile" description="穩定自我介紹／角色">
                <textarea
                  className={settingsInputCls + ' min-h-[80px] resize-y'}
                  value={memory.userProfile || ''}
                  onChange={(e) => void setUserProfile(e.target.value)}
                  placeholder="會優先進入提示…"
                />
              </SettingsStack>
            </SettingsGroup>
            <SettingsGroup
              title="已存記憶"
              action={
                <button
                  type="button"
                  className={settingsBtnCls + ' text-error border-error/30'}
                  onClick={() => {
                    if (confirm('確定清除所有記憶與使用者檔案？')) void clearMemories()
                  }}
                >
                  清除全部
                </button>
              }
            >
              <SettingsStack title="新增" description="手動寫入一條記憶">
                <div className="flex gap-2">
                  <input
                    className={settingsInputCls + ' flex-1'}
                    value={newMemory}
                    onChange={(e) => setNewMemory(e.target.value)}
                    placeholder="輸入後 Enter 或按新增…"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newMemory.trim()) {
                        void appendMemory(newMemory.trim()).then(() => setNewMemory(''))
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={settingsBtnPrimaryCls + ' shrink-0'}
                    onClick={() => {
                      if (!newMemory.trim()) return
                      void appendMemory(newMemory.trim()).then(() => setNewMemory(''))
                    }}
                  >
                    新增
                  </button>
                </div>
              </SettingsStack>
              {(memory.entries || []).length === 0 ? (
                <div className="px-4 py-4 text-[12px] text-outline">尚無記憶條目</div>
              ) : (
                (memory.entries || []).slice(0, 40).map((e) => (
                  <SettingsRow
                    key={e.id}
                    title={e.text}
                    description={e.createdAt?.slice(0, 19).replace('T', ' ')}
                    align="start"
                    control={
                      <button
                        type="button"
                        className="text-[12px] text-error font-medium px-2"
                        onClick={() => void deleteMemoryEntry(e.id)}
                      >
                        刪除
                      </button>
                    }
                  />
                ))
              )}
            </SettingsGroup>
          </>
        )}

        {section === 'data' && (
          <>
            <SettingsGroup title="對話">
              <SettingsRow
                title="預設臨時對話"
                description="不讀寫跨對話記憶"
                control={
                  <SettingsToggle
                    checked={settings.temporaryChatDefault === true}
                    onChange={(v) => set({ temporaryChatDefault: v })}
                  />
                }
              />
              <SettingsRow
                title="自動封存"
                description={
                  (settings.autoArchiveDays ?? 0) === 0
                    ? '關閉'
                    : `${settings.autoArchiveDays} 天後封存`
                }
                control={
                  <input
                    type="range"
                    min={0}
                    max={90}
                    value={settings.autoArchiveDays ?? 0}
                    onChange={(e) =>
                      set({ autoArchiveDays: Number(e.target.value) })
                    }
                    className="w-36 accent-primary"
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="管理">
              <SettingsRow
                title="封存與日誌"
                description="開啟紀錄頁"
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => {
                      window.location.hash = '#/records'
                    }}
                  >
                    開啟
                  </button>
                }
              />
              <SettingsRow
                title="刪除全部對話"
                description="不可復原"
                control={
                  <button
                    type="button"
                    className={settingsBtnCls + ' text-error border-error/30'}
                    onClick={async () => {
                      if (!confirm('清除所有對話執行緒？（不可復原）')) return
                      try {
                        const { useThreadStore } = await import('../store/threadStore')
                        const st = useThreadStore.getState()
                        const ids = [...st.threads.map((t) => t.id)]
                        for (const id of ids) st.deleteThread(id)
                        const active = st.activeId
                        if (active) st.clearBubbles?.(active)
                        setDataMsg('已清除對話執行緒')
                      } catch (e) {
                        setDataMsg(e instanceof Error ? e.message : String(e))
                      }
                    }}
                  >
                    刪除
                  </button>
                }
              />
            </SettingsGroup>
            {dataMsg && (
              <p className="text-[12px] font-[family-name:var(--font-mono)] text-primary px-1">
                {dataMsg}
              </p>
            )}
          </>
        )}

        {section === 'shortcuts' && (
          <>
            <SettingsGroup
              title="可自訂快捷鍵"
              action={
                <button
                  type="button"
                  className={settingsBtnCls}
                  onClick={() => resetShortcuts()}
                >
                  重設全部
                </button>
              }
            >
              {shortcutBindings.map((b) => {
                const shown = formatChord(b.chord || b.defaultChord)
                const capturing = capturingId === b.id
                return (
                  <SettingsRow
                    key={b.id}
                    title={b.label}
                    description={
                      b.chord
                        ? `${b.description} · 預設 ${formatChord(b.defaultChord)}`
                        : b.description
                    }
                    control={
                      <div className="flex items-center gap-2" data-shortcut-capture>
                        <button
                          type="button"
                          className={`text-[11px] px-2.5 py-1 rounded-full border font-[family-name:var(--font-mono)] ${
                            capturing
                              ? 'border-primary/50 text-primary bg-primary/10 animate-pulse'
                              : 'bg-white/[0.06] border-white/10 text-on-surface-variant hover:border-primary/40'
                          }`}
                          onClick={() => setCapturingId(capturing ? null : b.id)}
                          title="點擊後按下新快捷鍵"
                        >
                          {capturing ? '按下按鍵…' : shown}
                        </button>
                        {b.chord ? (
                          <button
                            type="button"
                            className="text-[11px] text-outline hover:text-error"
                            onClick={() => setShortcutChord(b.id, '')}
                          >
                            還原
                          </button>
                        ) : null}
                      </div>
                    }
                  />
                )
              })}
            </SettingsGroup>
            <SettingsGroup title="固定（隨送出快捷鍵設定）">
              {(
                [
                  [
                    settings.enterBehavior === 'cmdEnter' ? '⌘ / Ctrl + Enter' : 'Enter',
                    '送出訊息',
                  ],
                  [
                    settings.enterBehavior === 'cmdEnter' ? 'Enter' : 'Shift + Enter',
                    '換行',
                  ],
                  ['↑ / ↓', '輸入歷史'],
                  ['Esc', '關閉 slash／浮動視窗'],
                ] as const
              ).map(([k, v]) => (
                <SettingsRow
                  key={k + v}
                  title={v}
                  control={
                    <kbd className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 font-[family-name:var(--font-mono)] text-on-surface-variant">
                      {k}
                    </kbd>
                  }
                />
              ))}
            </SettingsGroup>
          </>
        )}

        {section === 'git' && (
          <>
            <SettingsGroup title="分支與推送">
              <SettingsRow
                title="分支前綴"
                description="代理建立分支時使用"
                control={
                  <input
                    className={settingsInputCls + ' w-40 text-right'}
                    value={settings.gitBranchPrefix || ''}
                    onChange={(e) => set({ gitBranchPrefix: e.target.value })}
                    placeholder="agent/"
                  />
                }
              />
              <SettingsRow
                title="Draft PR"
                description="建立 PR 時預設為 draft"
                control={
                  <SettingsToggle
                    checked={settings.gitCreateDraftPr !== false}
                    onChange={(v) => set({ gitCreateDraftPr: v })}
                  />
                }
              />
              <SettingsRow
                title="Force-with-lease"
                description="允許進階推送（謹慎）"
                control={
                  <SettingsToggle
                    checked={settings.gitForcePush === true}
                    onChange={(v) => set({ gitForcePush: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="指引（注入提示）">
              <SettingsStack title="Commit 指引">
                <textarea
                  className={settingsInputCls + ' min-h-[72px] resize-y'}
                  value={settings.gitCommitInstructions || ''}
                  onChange={(e) =>
                    set({ gitCommitInstructions: e.target.value })
                  }
                  placeholder="例如：conventional commits、中文摘要…"
                />
              </SettingsStack>
              <SettingsStack title="Pull Request 指引">
                <textarea
                  className={settingsInputCls + ' min-h-[72px] resize-y'}
                  value={settings.gitPrInstructions || ''}
                  onChange={(e) => set({ gitPrInstructions: e.target.value })}
                  placeholder="例如：標題簡短、描述含測試計畫…"
                />
              </SettingsStack>
            </SettingsGroup>
          </>
        )}

        {section === 'llm' && (
          <>
            <SettingsGroup title="連線">
              <SettingsRow
                title="啟用 LLM"
                description="使用 OpenAI 相容 API"
                control={
                  <SettingsToggle
                    checked={settings.enabled}
                    onChange={(v) => set({ enabled: v })}
                  />
                }
              />
              <SettingsStack title="Base URL">
                <input
                  value={settings.baseUrl}
                  onChange={(e) => set({ baseUrl: e.target.value })}
                  className={settingsInputCls}
                  placeholder="https://api.openai.com/v1"
                />
              </SettingsStack>
              <SettingsStack title="API 金鑰">
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                  className={settingsInputCls}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </SettingsStack>
              <SettingsStack title="預設模型">
                <input
                  list="discovered-models"
                  value={settings.model}
                  onChange={(e) => set({ model: e.target.value })}
                  className={settingsInputCls}
                  placeholder="model id（由 CLI 偵測或手動填入）"
                />
                <datalist id="discovered-models">
                  {(settings.discoveredModels || []).map((id) => <option key={id} value={id} />)}
                </datalist>
                {(settings.discoveredModels || []).length > 0 && (
                  <p className="mt-1 text-[11px] text-outline">已從 /models 自動帶入 {settings.discoveredModels.length} 個模型。</p>
                )}
              </SettingsStack>
            </SettingsGroup>
            <div className="flex flex-wrap gap-2 items-center px-0.5">
              <button
                type="button"
                onClick={() => void onTest()}
                disabled={testing}
                className={settingsBtnPrimaryCls + ' disabled:opacity-50'}
              >
                {testing ? '測試中…' : '測試連線'}
              </button>
              {testMsg && (
                <span
                  className={`text-[12px] font-[family-name:var(--font-mono)] ${
                    testMsg.startsWith('✓') ? 'text-primary' : 'text-error'
                  }`}
                >
                  {testMsg}
                </span>
              )}
            </div>
          </>
        )}

        {section === 'cli' && (
          <>
            <SettingsGroup title="安全">
              <SettingsRow
                title="bash 一律核准"
                description="指令執行前 HITL 詢問"
                control={
                  <SettingsToggle
                    checked={settings.bashRequireAsk !== false}
                    onChange={(v) => set({ bashRequireAsk: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="廠商">
              {(settings.cliProviders || []).map((p, idx) => (
                <div key={p.id} className="px-4 py-3 space-y-2 border-b border-white/[0.07] last:border-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[13px] font-medium">{p.name}</div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-outline">啟用</span>
                      <SettingsToggle
                        checked={p.enabled}
                        onChange={(v) => {
                          const next = [...(settings.cliProviders || [])]
                          next[idx] = { ...p, enabled: v }
                          set({ cliProviders: next })
                        }}
                      />
                      <span className="text-[11px] text-outline">已授權</span>
                      <SettingsToggle
                        checked={p.authorized}
                        onChange={(v) => {
                          const next = [...(settings.cliProviders || [])]
                          next[idx] = { ...p, authorized: v }
                          set({ cliProviders: next })
                        }}
                      />
                    </div>
                  </div>
                  {(p.kind === 'openai' ||
                    p.kind === 'anthropic' ||
                    p.kind === 'google' ||
                    p.kind === 'custom') && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        className={settingsInputCls}
                        type="password"
                        placeholder="API Key"
                        value={p.apiKey || ''}
                        onChange={(e) => {
                          const next = [...(settings.cliProviders || [])]
                          next[idx] = {
                            ...p,
                            apiKey: e.target.value,
                            authorized: Boolean(e.target.value) || p.authorized,
                          }
                          set({ cliProviders: next })
                        }}
                      />
                      <input
                        className={settingsInputCls}
                        placeholder="Base URL"
                        value={p.baseUrl || ''}
                        onChange={(e) => {
                          const next = [...(settings.cliProviders || [])]
                          next[idx] = { ...p, baseUrl: e.target.value }
                          set({ cliProviders: next })
                        }}
                      />
                    </div>
                  )}
                  {(p.kind === 'opencode' ||
                    p.kind === 'cursor' ||
                    p.kind === 'codex' ||
                    p.kind === 'anthropic') && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        className={settingsInputCls + ' flex-1 min-w-[140px]'}
                        placeholder={`CLI 指令名，如 ${p.cliBinary || p.kind}`}
                        value={p.cliBinary || ''}
                        onChange={(e) => {
                          const next = [...(settings.cliProviders || [])]
                          next[idx] = { ...p, cliBinary: e.target.value }
                          set({ cliProviders: next })
                        }}
                      />
                      <button
                        type="button"
                        className="px-3 py-2 rounded border border-primary/40 text-primary text-xs font-semibold shrink-0"
                        onClick={async () => {
                          const bin = p.cliBinary || p.kind
                          if (!window.subagents?.cli?.which) {
                            setCliMsg('需 Electron 偵測 CLI')
                            return
                          }
                          const r = await window.subagents.cli.which(bin)
                          const next = [...(settings.cliProviders || [])]
                          next[idx] = {
                            ...p,
                            authorized: r.found,
                            enabled: r.found ? true : p.enabled,
                          }
                          set({ cliProviders: next })
                          setCliMsg(
                            r.found
                              ? `✓ ${p.name}: ${r.path}`
                              : `✗ 找不到 ${bin}（請安裝並加入 PATH）`,
                          )
                        }}
                      >
                        偵測 CLI
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-outline font-[family-name:var(--font-mono)]">
                    模型：{(p.models || []).map((m) => m.id).join(', ') || '—'}
                  </p>
                </div>
              ))}
            </SettingsGroup>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                className={settingsBtnPrimaryCls}
                onClick={async () => {
                  if (!window.subagents?.cli?.applyDiscovery) {
                    setCliMsg('一鍵偵測需 Electron（會讀本機 ~/.codex、~/.claude、~/.grok、opencode.jsonc）')
                    return
                  }
                  setCliMsg('掃描本機 CLI 與設定中…')
                  try {
                    const r = await window.subagents.cli.applyDiscovery(
                      (settings.cliProviders || []) as unknown[],
                    )
                    const providers = r.providers as typeof settings.cliProviders
                    const models = providers.flatMap((provider) => provider.models || [])
                    const strongest = r.suggestedModel || models[0]?.id || ''
                    const fastest = models.find((model) => model.depths?.includes('fast'))?.id || strongest
                    set({ cliProviders: r.providers as typeof settings.cliProviders,
                      ...(r.suggestedModel ? { model: r.suggestedModel } : {}),
                      ...(strongest
                        ? { roleModels: { orchestrator: strongest, synthesizer: strongest, analyst: fastest, executor: fastest } }
                        : {}),
                    })
                    setCliMsg(
                      [
                        '✓ 已匯入本機偵測結果（不會複製 OAuth/API secret）',
                        r.summary,
                        r.suggestedModel ? `建議模型：${r.suggestedModel}` : '',
                        strongest ? '已套用角色模型建議（協調/合成＝較強；分析/執行＝較快）。' : '',
                        r.suggestedDepth ? `建議推理：${r.suggestedDepth}` : '',
                        '',
                        '說明：Codex/Claude/Grok 若用訂閱登入，執行仍走各自 CLI；',
                        '本 App 內建 LLM 請求需另外設定 OpenAI 相容 API（或用 bash 呼叫 CLI）。',
                      ]
                        .filter(Boolean)
                        .join('\n'),
                    )
                  } catch (e) {
                    setCliMsg(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                一鍵偵測本機 CLI 並匯入模型
              </button>
              <button
                type="button"
                className={settingsBtnCls}
                onClick={async () => {
                  if (!window.subagents?.opencode) {
                    setCliMsg('opencode 掃描需 Electron')
                    return
                  }
                  const d = await window.subagents.opencode.detect()
                  const { useOpenCodeConfigStore } = await import('../store/opencodeConfigStore')
                  const { useProjectStore } = await import('../store/projectStore')
                  await useOpenCodeConfigStore
                    .getState()
                    .hydrate(useProjectStore.getState().root)
                  const oc = useOpenCodeConfigStore.getState()
                  const primaries = oc.agents.filter((a) => a.kind === 'primary')
                  const subs = oc.agents.filter((a) => a.kind === 'subagent')
                  setCliMsg(
                    [
                      d.found ? `CLI ${d.path} (${d.version || '?'})` : 'opencode CLI 未找到',
                      `config sources: ${oc.sources.length}`,
                      ...oc.sources.map((s) => `  · ${s}`),
                      `agents: primary=${primaries.length} subagent=${subs.length}`,
                      ...oc.agents
                        .filter((a) => a.source !== 'builtin')
                        .slice(0, 12)
                        .map(
                          (a) =>
                            `  · ${a.id} [${a.kind}/${a.source}] ${a.model || 'model=default'}`,
                        ),
                      oc.commands.length ? `commands: ${oc.commands.length}` : '',
                      oc.model ? `default model: ${oc.model}` : '',
                      oc.small_model ? `small_model: ${oc.small_model}` : '',
                      oc.error || '',
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  )
                  if (d.found || oc.sources.length) {
                    const next = [...(settings.cliProviders || [])]
                    const i = next.findIndex((x) => x.id === 'opencode')
                    if (i >= 0) {
                      next[i] = { ...next[i], enabled: true, authorized: true }
                      set({ cliProviders: next })
                    }
                  }
                }}
              >
                掃描 OpenCode agents
              </button>
            </div>
            {cliMsg && (
              <pre className="text-[11px] font-[family-name:var(--font-mono)] text-primary whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[0.03] p-3 max-h-40 overflow-y-auto custom-scrollbar">
                {cliMsg}
              </pre>
            )}
          </>
        )}

        {section === 'opencode' && (
          <div className="space-y-1 animate-macos-enter">
            <SettingsGroup
              title="狀態"
              action={
                <button
                  type="button"
                  disabled={oc.loading}
                  onClick={() => void oc.hydrate(projectRoot)}
                  className={settingsBtnCls + ' disabled:opacity-40'}
                >
                  {oc.loading ? '載入中…' : '重新整理'}
                </button>
              }
            >
              <div className="px-4 py-3 text-[11px] text-outline leading-relaxed">
                合併{' '}
                <code className="text-primary/80 font-mono">~/.config/opencode/opencode.json</code>
                、專案 <code className="text-primary/80 font-mono">opencode.json</code> 與{' '}
                <code className="text-primary/80 font-mono">.opencode/agents|commands</code>
                。Commands 會自動匯入為 slash（/cmd）。
              </div>
              <div className="grid grid-cols-2 gap-2 px-4 pb-3">
                <StatChip label="Config 來源" value={String(oc.sources.length)} />
                <StatChip label="Agents" value={String(oc.agents.length)} />
                <StatChip label="Commands" value={String(oc.commands.length)} />
                <StatChip
                  label="Slash 總數"
                  value={String(getLiveSlashCommands().length)}
                />
              </div>
              {oc.model && <Row k="default model" v={oc.model} mono />}
              {oc.small_model && <Row k="small_model" v={oc.small_model} mono />}
              {oc.default_agent && <Row k="default_agent" v={oc.default_agent} mono />}
              {oc.error && (
                <p className="text-[11px] text-amber-200/90 px-4 pb-3">{oc.error}</p>
              )}
            </SettingsGroup>

            <SettingsGroup title="Config 路徑">
              {oc.sources.length === 0 ? (
                <div className="px-4 py-3 text-[12px] text-outline">
                  尚未找到 opencode.json（可選建立）
                </div>
              ) : (
                oc.sources.map((s) => (
                  <div
                    key={s}
                    className="px-4 py-2.5 text-[11px] font-mono text-white/60 break-all"
                  >
                    {s}
                  </div>
                ))
              )}
            </SettingsGroup>

            <SettingsGroup title="Agents 註冊表">
              <div className="max-h-56 overflow-y-auto custom-scrollbar">
                {oc.agents.map((a) => (
                  <SettingsRow
                    key={`${a.source}-${a.id}`}
                    title={`${a.label} (${a.id})`}
                    description={`${a.kind} · ${a.source}${a.model ? ` · ${a.model}` : ''}`}
                    control={
                      a.hidden ? (
                        <span className="text-[10px] text-outline">hidden</span>
                      ) : (
                        <span />
                      )
                    }
                  />
                ))}
              </div>
            </SettingsGroup>

            <SettingsGroup title="Commands → Slash">
              {oc.commands.length === 0 ? (
                <div className="px-4 py-3 text-[12px] text-outline">
                  無自訂 command。可在{' '}
                  <code className="font-mono text-primary/70">.opencode/commands/*.md</code>{' '}
                  新增。
                </div>
              ) : (
                oc.commands.map((c) => (
                  <SettingsRow
                    key={c.path || c.id}
                    title={`/${c.id}`}
                    description={c.description || c.template.slice(0, 100)}
                    control={
                      c.agent ? (
                        <span className="text-[11px] text-outline font-mono">
                          agent={c.agent}
                        </span>
                      ) : (
                        <span />
                      )
                    }
                  />
                ))
              )}
            </SettingsGroup>
          </div>
        )}

        {section === 'roles' && (
          <>
            <SettingsGroup
              title="各角色模型"
              action={
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-outline">{roleModelGroups.length ? `${roleModelGroups.length} 個 CLI · ${allRoleModelIds.size} 模型` : '尚無已授權 CLI 模型'}</span>
                  <button type="button" className={settingsBtnCls} onClick={() => set({ roleModels: suggestedRoleModels })} disabled={!suggestedRoleModels.orchestrator}>套用建議</button>
                </div>
              }
            >
              {(
                [
                  ['orchestrator', 'Manager／協調者'],
                  ['analyst', 'Analyzer-1／分析'],
                  ['synthesizer', 'Writer／合成'],
                  ['executor', 'Core／執行'],
                ] as const
              ).map(([key, label]) => {
                const current = settings.roleModels?.[key] || ''
                const orphan =
                  current && !allRoleModelIds.has(current) ? current : null
                return (
                  <SettingsRow
                    key={key}
                    title={label}
                    description="依 CLI 類別選擇；留空＝全域預設"
                    control={
                      <PillSelect
                        value={current}
                        onChange={(v) => setRoleModel(key, v)}
                        className="min-w-[11rem]"
                      >
                        <option value="">
                          全域預設
                          {settings.model ? `（${settings.model}）` : ''}
                        </option>
                        {settings.model?.trim() ? (
                          <optgroup label="語言模型設定">
                            <option value={settings.model.trim()}>
                              {settings.model.trim()}
                            </option>
                          </optgroup>
                        ) : null}
                        {(settings.discoveredModels || []).length ? (
                          <optgroup label="已測試 API／models">
                            {settings.discoveredModels.map((id) => <option key={`api-${id}`} value={id}>{id}</option>)}
                          </optgroup>
                        ) : null}
                        {roleModelGroups.map((g) => (
                          <optgroup
                            key={g.providerId}
                            label={`${g.providerName}（${g.kind}）`}
                          >
                            {g.models.map((m) => (
                              <option key={`${g.providerId}-${m.id}`} value={m.id}>
                                {m.label || m.id}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        {orphan ? (
                          <optgroup label="目前值（不在清單）">
                            <option value={orphan}>{orphan}</option>
                          </optgroup>
                        ) : null}
                      </PillSelect>
                    }
                  />
                )
              })}
            </SettingsGroup>
            {!roleModelGroups.length && (
              <p className="text-[12px] text-outline px-1 leading-relaxed">
                尚無可選模型。請先到{' '}
                <button
                  type="button"
                  className="text-primary font-semibold hover:underline"
                  onClick={() => setSection('cli')}
                >
                  CLI 授權
                </button>{' '}
                啟用並「一鍵偵測本機 CLI 並匯入模型」，或到語言模型填寫預設 model。
              </p>
            )}
          </>
        )}

        {section === 'safety' && (
          <>
            <SettingsGroup title="核准與沙盒">
              <SettingsStack title="動作應如何核准？">
                <div className="space-y-1.5">
                  {APPROVAL_MODE_DEFS.map((d) => {
                    const selected = (settings.approvalMode || 'auto') === d.id
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => set({ approvalMode: d.id })}
                        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                          selected
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-white/10 hover:border-white/25'
                        }`}
                      >
                        <Icon
                          name={d.icon}
                          size={18}
                          className={`shrink-0 mt-0.5 ${
                            d.id === 'full' ? 'text-amber-300/90' : 'text-on-surface-variant'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-on-surface">
                            {d.title}
                          </span>
                          <span className="block text-[11px] text-on-surface-variant leading-snug mt-0.5">
                            {d.desc}
                          </span>
                        </span>
                        {selected && (
                          <Icon name="check" size={16} className="shrink-0 mt-1 text-primary" />
                        )}
                      </button>
                    )
                  })}
                </div>
                {(settings.approvalMode || 'auto') === 'full' && (
                  <p className="text-[11px] text-amber-300/80 mt-2 leading-relaxed">
                    完整存取權：跳過工具 HITL ask 與 safety intervention；deny 規則
                    （隔離封鎖、權限 deny、bash deny pattern）與 supervisor 限制仍生效。
                  </p>
                )}
              </SettingsStack>
              <SettingsRow
                title="安全閘道"
                description="敏感 Payload 需人工介入"
                control={
                  <SettingsToggle
                    checked={settings.safetyEnabled}
                    onChange={(v) => set({ safetyEnabled: v })}
                  />
                }
              />
              <SettingsRow
                title="代理工具"
                description="允許執行工具迴圈"
                control={
                  <SettingsToggle
                    checked={settings.toolsEnabled !== false}
                    onChange={(v) => set({ toolsEnabled: v })}
                  />
                }
              />
              <SettingsRow
                title="web_search"
                description="允許網路搜尋工具"
                control={
                  <SettingsToggle
                    checked={settings.webSearchEnabled !== false}
                    onChange={(v) => set({ webSearchEnabled: v })}
                  />
                }
              />
              <SettingsRow
                title="Function Calling"
                description="LLM 多輪工具迴圈"
                control={
                  <SettingsToggle
                    checked={settings.functionCalling !== false}
                    onChange={(v) => set({ functionCalling: v })}
                  />
                }
              />
              <SettingsRow
                title="Capability 漸進披露"
                description="Pydantic AI 2.0 風格：工具+runbook 打包為 capability，先列目錄，模型 load_capability 後才展開（省 token、較可控）"
                control={
                  <SettingsToggle
                    checked={settings.capabilitiesEnabled !== false}
                    onChange={(v) => set({ capabilitiesEnabled: v })}
                  />
                }
              />
              {settings.capabilitiesEnabled !== false && (
                <>
                  <SettingsRow
                    title="Tool Search"
                    description={`工具太多先藏起來：可見 schema 超過 ${settings.toolSearchThreshold ?? 24} 個時，模型用 tool_search 關鍵字檢索解鎖（省 context）`}
                    control={
                      <SettingsToggle
                        checked={settings.toolSearchEnabled !== false}
                        onChange={(v) => set({ toolSearchEnabled: v })}
                      />
                    }
                  />
                  {settings.toolSearchEnabled !== false && (
                    <SettingsRow
                      title="Tool Search 門檻"
                      description="可見工具 schema 超過此數才啟動隱藏（最小 4）"
                      control={
                        <input
                          type="number"
                          min={4}
                          max={200}
                          value={settings.toolSearchThreshold ?? 24}
                          onChange={(e) =>
                            set({
                              toolSearchThreshold: Math.max(
                                4,
                                Number(e.target.value) || 24,
                              ),
                            })
                          }
                          className="w-20 bg-surface-container border border-white/10 rounded-lg px-2 py-1 text-[13px] text-right"
                        />
                      }
                    />
                  )}
                  <SettingsRow
                    title="模型感知工具預算"
                    description={toolTuning.label}
                    control={
                      <button
                        type="button"
                        className={settingsBtnCls}
                        onClick={() =>
                          set({
                            toolSearchThreshold: toolTuning.toolSearchThreshold,
                            maxToolPayloadKb: toolTuning.maxToolPayloadKb,
                            maxToolRounds: toolTuning.maxToolRounds,
                          })
                        }
                      >
                        套用建議
                      </button>
                    }
                  />
                  <SettingsRow
                    title="CodeMode（run_code）"
                    description="模型寫一段 JS 一次批量呼叫多個工具（迴圈/過濾），N 輪壓成 1 輪；每次執行都需人工核准"
                    control={
                      <SettingsToggle
                        checked={settings.codeModeEnabled !== false}
                        onChange={(v) => set({ codeModeEnabled: v })}
                      />
                    }
                  />
                </>
              )}
              {settings.capabilitiesEnabled !== false && (
                <SettingsStack title="Always-on 能力包">
                  <p className="text-[12px] text-on-surface-variant mb-2 leading-relaxed">
                    點選可將 deferred 包改為第一輪就可用（不必 load_capability）。依類型分組：內建 / MCP / 外掛 / 技能。
                  </p>
                  {(() => {
                    type CapChip = { id: string; description: string; isFixed: boolean }
                    const groups: Array<{ label: string; items: CapChip[] }> = [
                      {
                        label: '內建',
                        items: BUILTIN_CAPABILITIES.map((c) => ({
                          id: c.id,
                          description: c.description,
                          isFixed: c.deferLoading === false,
                        })),
                      },
                      {
                        label: 'MCP',
                        items: settings.mcpEnabled
                          ? (settings.mcpServers || [])
                              .filter((s) => s.enabled)
                              .map((s) => ({
                                id: `mcp:${s.id}`,
                                description: `MCP「${s.name}」${s.secretPluginId ? ` · secret=${s.secretPluginId}` : ''}`,
                                isFixed: false,
                              }))
                          : [],
                      },
                      {
                        label: '外掛 / Connector',
                        items: (() => {
                          const owners = new Map<string, string[]>()
                          for (const tool of customToolsForSettings(settings)) {
                            const o = tool.ownerId || 'settings'
                            owners.set(o, [...(owners.get(o) || []), tool.name])
                          }
                          return [...owners].map(([owner, names]) => ({
                            id: `user:${owner}`,
                            description: `${owner}（${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}）`,
                            isFixed: false,
                          }))
                        })(),
                      },
                      {
                        label: '技能',
                        items: skillsStore.list().map((s) => ({
                          id: `skill:${s.meta.name}`,
                          description: s.meta.description || s.meta.name,
                          isFixed: false,
                        })),
                      },
                    ]
                    const toggle = (id: string, isFixed: boolean) => {
                      if (isFixed) return
                      const cur = new Set(settings.alwaysOnCapabilities || [])
                      if (cur.has(id)) cur.delete(id)
                      else cur.add(id)
                      set({ alwaysOnCapabilities: [...cur] })
                    }
                    return (
                      <div className="space-y-3">
                        {groups
                          .filter((g) => g.items.length > 0)
                          .map((g) => (
                            <div key={g.label}>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-outline mb-1.5">
                                {g.label}
                                <span className="ml-1.5 normal-case font-normal opacity-70">
                                  {g.items.filter(
                                    (c) =>
                                      c.isFixed ||
                                      (settings.alwaysOnCapabilities || []).includes(c.id),
                                  ).length}
                                  /{g.items.length} on
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {g.items.map((c) => {
                                  const active =
                                    c.isFixed ||
                                    (settings.alwaysOnCapabilities || []).includes(c.id)
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      disabled={c.isFixed}
                                      title={c.description}
                                      onClick={() => toggle(c.id, c.isFixed)}
                                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                        active
                                          ? 'border-primary/40 bg-primary/15 text-primary'
                                          : 'border-white/10 text-on-surface-variant hover:border-white/25'
                                      } ${c.isFixed ? 'opacity-80 cursor-default' : ''}`}
                                    >
                                      {c.id.replace(/^(user|mcp|skill):/, '')}
                                      {c.isFixed ? ' · 固定' : active ? ' · on' : ''}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        {(settings.alwaysOnCapabilities || []).length > 0 && (
                          <button
                            type="button"
                            className={settingsBtnCls}
                            onClick={() => set({ alwaysOnCapabilities: [] })}
                          >
                            清除 always-on 覆寫
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </SettingsStack>
              )}
              <SettingsRow
                title="輸出超限中止"
                description="工具輸出超過上限時中止（否則截斷）"
                control={
                  <SettingsToggle
                    checked={settings.haltOnPayloadOverflow === true}
                    onChange={(v) => set({ haltOnPayloadOverflow: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="門檻">
              <SettingsRow
                title="授權等級"
                description={`目前 ${settings.authLevel}（敏感表需 ≥ 4）`}
                control={
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={settings.authLevel}
                    onChange={(e) =>
                      set({ authLevel: Number(e.target.value) })
                    }
                    className="w-36 accent-primary"
                  />
                }
              />
              <SettingsRow
                title="最低信心度"
                description={settings.minConfidence.toFixed(2)}
                control={
                  <input
                    type="range"
                    min={0.5}
                    max={0.99}
                    step={0.01}
                    value={settings.minConfidence}
                    onChange={(e) =>
                      set({ minConfidence: Number(e.target.value) })
                    }
                    className="w-36 accent-primary"
                  />
                }
              />
              <SettingsRow
                title="預設最大迭代"
                description="目標導向 loop"
                control={
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.maxIterationsDefault}
                    onChange={(e) =>
                      set({ maxIterationsDefault: Number(e.target.value) || 5,
                      })
                    }
                    className={settingsInputCls + ' w-20 text-right'}
                  />
                }
              />
              <SettingsRow
                title="工具輸出上限"
                description={`${settings.maxToolPayloadKb ?? 50} KB`}
                control={
                  <input
                    type="range"
                    min={8}
                    max={512}
                    value={settings.maxToolPayloadKb ?? 50}
                    onChange={(e) =>
                      set({ maxToolPayloadKb: Number(e.target.value) })
                    }
                    className="w-36 accent-primary"
                  />
                }
              />
              <SettingsRow
                title="FC 最大輪數"
                description="每步 function-call"
                control={
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={settings.maxToolRounds ?? 4}
                    onChange={(e) =>
                      set({ maxToolRounds: Number(e.target.value) || 4 })
                    }
                    className={settingsInputCls + ' w-20 text-right'}
                  />
                }
              />
            </SettingsGroup>
            <p className="text-[11px] text-outline px-1">
              人工介入示範：目標含敏感匯出且授權等級 &lt; 4 時會暫停等待核准。
            </p>
          </>
        )}

        {section === 'webhook' && (
          <>
            <SettingsGroup title="本機 Webhook">
              <SettingsRow
                title="啟用"
                description="聆聽 127.0.0.1"
                control={
                  <SettingsToggle
                    checked={settings.webhookEnabled === true}
                    onChange={(v) => set({
                      webhookEnabled: v,
                      ...(v && !settings.webhookToken
                        ? { webhookToken: crypto.randomUUID().replace(/-/g, '') }
                        : {}),
                    })}
                  />
                }
              />
              <SettingsRow
                title="連接埠"
                control={
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    className={settingsInputCls + ' w-28 text-right'}
                    value={settings.webhookPort || 8787}
                    onChange={(e) =>
                      set({ webhookPort: Number(e.target.value) || 8787 })
                    }
                  />
                }
              />
              <SettingsStack title="驗證 Token（留空＝不驗證，不建議）">
                <input
                  type="password"
                  className={settingsInputCls}
                  value={settings.webhookToken || ''}
                  onChange={(e) => set({ webhookToken: e.target.value })}
                  autoComplete="off"
                />
              </SettingsStack>
            </SettingsGroup>
            <pre className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant overflow-x-auto whitespace-pre-wrap mb-4">
              {`curl -X POST http://127.0.0.1:${settings.webhookPort || 8787}/webhook \\
  -H "Content-Type: application/json" \\
  -d '{"source":"email.received","subject":"Invoice 42","hasAttachment":true}'`}
            </pre>
            {webhookStatus && (
              <p className="text-[12px] font-[family-name:var(--font-mono)] text-primary px-1">
                {webhookStatus}
              </p>
            )}
          </>
        )}

        {section === 'gateway' && (
          <>
            <SettingsGroup title="Telegram">
              <SettingsRow
                title="啟用 Telegram"
                description="Bot 長輪詢入站訊息"
                control={
                  <SettingsToggle
                    checked={settings.telegramEnabled === true}
                    onChange={(v) => set({ telegramEnabled: v })}
                  />
                }
              />
              <SettingsStack title="Bot Token（@BotFather）">
                <input
                  className={settingsInputCls}
                  type="password"
                  value={settings.telegramBotToken || ''}
                  onChange={(e) => set({ telegramBotToken: e.target.value })}
                  placeholder="123456:ABC-DEF..."
                />
              </SettingsStack>
              <SettingsStack title="允許的 Chat ID" description="逗號分隔，空白＝全部">
                <input
                  className={settingsInputCls}
                  value={settings.telegramAllowedChatIds || ''}
                  onChange={(e) =>
                    set({ telegramAllowedChatIds: e.target.value })
                  }
                  placeholder="例如 123456789"
                />
              </SettingsStack>
              <SettingsRow
                title="自動執行"
                description="收到訊息自動執行代理"
                control={
                  <SettingsToggle
                    checked={settings.telegramAutoRun !== false}
                    onChange={(v) => set({ telegramAutoRun: v })}
                  />
                }
              />
              <SettingsRow
                title="回覆結果"
                description="執行完成後回覆聊天室"
                control={
                  <SettingsToggle
                    checked={settings.telegramReplyWithResult !== false}
                    onChange={(v) => set({ telegramReplyWithResult: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="連線狀態">
              <SettingsRow
                title="Telegram 輪詢"
                description="開關與 Token 變更後會自動啟動／停止"
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={async () => {
                      const st = await window.subagents?.gateway?.status()
                      setGatewayMsg(
                        st
                          ? `${st.telegram.running ? '運行中' : '已停止'}${
                              st.telegram.botUsername ? ` @${st.telegram.botUsername}` : ''
                            } · msgs=${st.telegram.messageCount}${
                              st.telegram.lastError ? ` · ${st.telegram.lastError}` : ''
                            }`
                          : '需 Electron 環境',
                      )
                    }}
                  >
                    重新整理
                  </button>
                }
              />
            </SettingsGroup>
            {gatewayMsg && (
              <p className="text-[12px] font-[family-name:var(--font-mono)] text-primary mb-3 px-1">
                {gatewayMsg}
              </p>
            )}
            <SettingsGroup title="最近入站訊息">
              <div className="px-4 py-3">
                {gatewayInbound.length === 0 ? (
                  <p className="text-[12px] text-outline">尚無訊息</p>
                ) : (
                  <ul className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar text-[11px] font-[family-name:var(--font-mono)]">
                    {gatewayInbound.slice(0, 12).map((m, i) => (
                      <li key={`${m.receivedAt}-${i}`} className="text-on-surface-variant">
                        [{m.channel}] {m.from || m.chatId}: {m.text.slice(0, 100)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SettingsGroup>
            <SettingsGroup title="背景委派任務">
              <div className="px-4 py-3">
                {bgJobs.length === 0 ? (
                  <p className="text-[12px] text-outline">
                    尚無背景任務 — 使用 delegate_task(background=true)
                  </p>
                ) : (
                  <ul className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar text-[11px] font-[family-name:var(--font-mono)]">
                    {bgJobs.slice(0, 12).map((j) => (
                      <li key={j.id} className="text-on-surface-variant">
                        {j.id} [{j.status}] {j.goal.slice(0, 60)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SettingsGroup>
          </>
        )}

        {section === 'mcp' && (
          <>
            <SettingsGroup title="MCP">
              <SettingsRow
                title="啟用 MCP"
                description="代理可用 mcp_list_tools / mcp_call"
                control={
                  <SettingsToggle
                    checked={settings.mcpEnabled === true}
                    onChange={(v) => set({ mcpEnabled: v })}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup title="宣告式自訂工具">
              <SettingsStack title="Custom tools JSON">
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
              </SettingsStack>
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
                        set({ mcpServers: (settings.mcpServers || []).filter((_, i) => i !== idx),
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
                    const tools = await listAllMcpTools(
                      (settings.mcpServers || []).filter((s) => s.enabled),
                      settings,
                    )
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
          </>
        )}

        {section === 'oauth' && (
          <>
            <SettingsGroup title="本機 OAuth 回呼">
              <SettingsStack title="Redirect URI（code flow 必須完全一致）">
                <code className="block text-[12px] font-[family-name:var(--font-mono)] text-on-surface break-all">
                  {OAUTH_REDIRECT_URI}
                </code>
                <p className="mt-2 text-[11px] text-outline leading-relaxed">
                  GitHub 使用<strong>裝置碼</strong>（通常只需 Client ID）。Notion / Google / Dropbox 等需在開發者後台登錄此 Redirect URI。
                  Access token 存在本機 secret store；有 refresh_token 時會每分鐘檢查並自動 refresh。
                </p>
              </SettingsStack>
              <SettingsRow
                title="立即刷新到期 token"
                description="對所有含 refresh_token 且即將過期的 connector 執行一次 refresh"
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    onClick={() => {
                      void refreshPluginTokens().then((n) => {
                        setOauthRefreshMsg(n > 0 ? `已刷新 ${n} 個 token` : '目前沒有需要刷新的 token')
                      })
                    }}
                  >
                    立即 refresh
                  </button>
                }
              />
              {oauthRefreshMsg && (
                <p className="px-4 pb-3 text-[11px] text-on-surface-variant">{oauthRefreshMsg}</p>
              )}
            </SettingsGroup>

            <SettingsGroup title="OAuth Client 憑證">
              {Array.from(
                new Map(
                  Object.values(PLUGIN_OAUTH_PROVIDERS).map((p) => [
                    p.clientKey,
                    {
                      key: p.clientKey,
                      flow: p.flow,
                      docsUrl: p.docsUrl,
                      needsSecret: p.tokenAuth === 'basic' || p.flow === 'code',
                    },
                  ]),
                ).values(),
              ).map((row) => {
                const live = settings.pluginOAuthClients?.[row.key] || { clientId: '', clientSecret: '' }
                return (
                  <div key={row.key} className="border-b border-white/[0.06] last:border-0 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[13px] font-semibold text-on-surface capitalize">{row.key}</div>
                        <div className="text-[11px] text-outline">
                          {row.flow === 'device' ? '裝置碼流程' : 'Code + 本機回呼'}
                          {row.needsSecret ? ' · 建議填 Client Secret' : ''}
                        </div>
                      </div>
                      {row.docsUrl && (
                        <a
                          href={row.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          開發者後台
                        </a>
                      )}
                    </div>
                    <input
                      type="text"
                      className={settingsInputCls + ' font-[family-name:var(--font-mono)] text-[12px]'}
                      placeholder="Client ID"
                      value={live.clientId || ''}
                      autoComplete="off"
                      onChange={(e) =>
                        set({
                          pluginOAuthClients: {
                            ...(settings.pluginOAuthClients || {}),
                            [row.key]: { ...live, clientId: e.target.value },
                          },
                        })
                      }
                    />
                    <input
                      type="password"
                      className={settingsInputCls + ' font-[family-name:var(--font-mono)] text-[12px]'}
                      placeholder="Client Secret（選填／部分供應商必要）"
                      value={live.clientSecret || ''}
                      autoComplete="off"
                      onChange={(e) =>
                        set({
                          pluginOAuthClients: {
                            ...(settings.pluginOAuthClients || {}),
                            [row.key]: { ...live, clientSecret: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                )
              })}
            </SettingsGroup>

            <SettingsGroup title="本機 token 狀態">
              <div className="px-4 py-3 space-y-1.5 text-[12px]">
                {listPluginSecrets().length === 0 ? (
                  <p className="text-outline">尚無 connector 密鑰 — 在學習中心 → 外掛完成授權後會顯示於此。</p>
                ) : (
                  listPluginSecrets().map(({ id, record }) => (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 last:border-0"
                    >
                      <span className="font-[family-name:var(--font-mono)] text-on-surface-variant truncate">
                        {id}
                      </span>
                      <span className="shrink-0 text-[11px] text-outline">
                        {record.refreshToken
                          ? secretNeedsRefresh(record)
                            ? 'refresh 待執行'
                            : record.expiresAt
                              ? `到期 ${new Date(record.expiresAt).toLocaleString()}`
                              : '有 refresh_token'
                          : '無 refresh（PAT / 裝置碼）'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </SettingsGroup>
          </>
        )}

        {section === 'bundle' && (
          <SettingsGroup title="備份">
            <SettingsRow
              title="匯出設定包"
              description="含設定、排程與事件（含 API 金鑰）"
              control={
                <button
                  type="button"
                  className={settingsBtnPrimaryCls}
                  onClick={async () => {
                    const json = await exportBundle()
                    const blob = new Blob([json], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `subagents-bundle-${Date.now()}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    setBundleMsg('已下載匯出檔。')
                  }}
                >
                  匯出 JSON
                </button>
              }
            />
            <SettingsRow
              title="匯入設定包"
              description="覆寫本機設定"
              control={
                <label className={settingsBtnCls + ' cursor-pointer'}>
                  匯入 JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const text = await file.text()
                      const r = await importBundle(text)
                      setBundleMsg(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`)
                      e.target.value = ''
                    }}
                  />
                </label>
              }
            />
          </SettingsGroup>
        )}
        {bundleMsg && (
          <p className="text-[12px] font-[family-name:var(--font-mono)] text-on-surface-variant px-1 mb-4">
            {bundleMsg}
          </p>
        )}
        <p className="text-[11px] text-outline px-1 mt-2">變更會立即套用，無需儲存。</p>
      </div>
    </ThemePage>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-outline font-semibold">
        {label}
      </div>
      <div className="text-lg font-semibold text-primary font-[family-name:var(--font-sora)] tabular-nums">
        {value}
      </div>
    </div>
  )
}

function Row({
  k,
  v,
  mono,
}: {
  k: string
  v: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-outline shrink-0">{k}</span>
      <span
        className={`text-on-surface truncate text-right ${mono ? 'font-mono text-[11px]' : ''}`}
        title={v}
      >
        {v}
      </span>
    </div>
  )
}
