import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { APPROVAL_MODE_DEFS } from '../agent/approvalModes'
import { exportRunMetricsJsonl, metricsSummary, resetRunMetrics } from '../agent/metrics'
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
import { PolicyAdminSection } from '../components/settings/PolicyAdminSection'
import { PiCoreSettingsSection } from '../components/settings/PiCoreSettingsSection'
import { useSettingsStore } from '../store/settingsStore'
import { useLearningStore } from '../store/learningStore'
import { modelsGroupedByCliProvider } from '../agent/cliProviders'
import { CLI_ADAPTERS, DISCOVERY_ONLY_AGENT_ADAPTERS } from '../agent/cliAdapters'
import type {
  McpServerConfig,
  PersonalityPreset,
  ThemePreference,
  ReducedMotionPreference,
  EnterBehavior,
  FollowUpMode,
  ApiProviderPreset,
} from '../agent/types'
import {
  listAllMcpTools,
  mcpEnsureSession,
  mcpListSessions,
  mcpStopSession,
} from '../agent/hermes/mcp'
import { useGatewayStore } from '../store/gatewayStore'
import { useEntitlementStore } from '../store/entitlementStore'
import { useSubscriptionStore } from '../store/subscriptionStore'
import { SUBSCRIPTION_PRICING } from '../agent/subscription'
import { useFeaturePackStore } from '../store/featurePackStore'
import {
  parseDeployOutboundGuard,
  type OutboundGuardMode,
} from '../agent/outbound/outboundGate'
import { connectionIdForBuiltinLlm } from '../agent/outbound/providerConnectionId'
import { parsePolicySourceMode } from '../agent/outbound/policySourceMode'
import { useOpenCodeConfigStore } from '../store/opencodeConfigStore'
import { useProjectStore } from '../store/projectStore'
import { getLiveSlashCommands } from '../commands/registry'
import { applyRendererStorageSnapshot } from '../agent/updateMigration'
import { bundleSensitivityNotice } from '../agent/settingsExport'
import {
  eventToChord,
  formatChord,
  useShortcutStore,
} from '../store/shortcutStore'
import { BUILTIN_CAPABILITIES } from '../agent/capabilities'
import { skillsStore } from '../agent/hermes/skills'
import { recommendToolTuning } from '../agent/modelTuning'
import { API_PROVIDER_PRESETS, apiProviderPreset } from '../agent/apiProviders'
import {
  OAUTH_REDIRECT_URI,
  PLUGIN_OAUTH_PROVIDERS,
} from '../agent/hermes/pluginOAuth'
import { listPluginSecretMeta, secretNeedsRefresh } from '../agent/hermes/pluginSecrets'
import { customToolsForSettings, listPendingToolPackages } from '../agent/tools/customTools'
import { pluginRegistry } from '../agent/hermes/plugins'
import { mapOpenCodeProviderCatalog } from '../agent/opencode/providerAdapter'
import {
  getOpenCodeProviderCatalog,
  inspectOpenCodeServer,
  unwrapOpenCodeServerValue,
} from '../agent/opencode/serverClient'

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
  { id: 'piCore', label: 'Pi Core', icon: 'hub', group: 'agent' },
  { id: 'policyAdmin', label: 'Policy Admin', icon: 'policy', group: 'agent' },
  { id: 'roles', label: '角色模型', icon: 'groups', group: 'agent' },
  { id: 'llm', label: '語言模型', icon: 'smart_toy', group: 'agent' },
  { id: 'cli', label: 'CLI 授權', icon: 'terminal', group: 'agent' },
  { id: 'opencode', label: 'OpenCode', icon: 'auto_awesome', group: 'agent' },
  { id: 'git', label: 'Git', icon: 'commit', group: 'integrate' },
  { id: 'webhook', label: 'Webhook', icon: 'webhook', group: 'integrate' },
  { id: 'gateway', label: '訊息閘道', icon: 'forum', group: 'integrate' },
  { id: 'mcp', label: 'MCP 伺服器', icon: 'extension', group: 'integrate' },
  { id: 'oauth', label: '外掛 OAuth', icon: 'key', group: 'integrate' },
  { id: 'updates', label: '安全更新', icon: 'system_update', group: 'system' },
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
  piCore: {
    title: 'Pi Core',
    subtitle: 'Pi Agent 的模型、思考層級與工具權限；設定在下一輪代理執行時生效。',
  },
  policyAdmin: {
    title: 'Policy Admin',
    subtitle: '公司政策草稿、啟用與 rollback（僅 policy-admin build；不繞過出站閘門）。',
  },
  roles: {
    title: '角色模型',
    subtitle: '依 CLI 類別自動帶出已授權模型；留空＝全域預設。',
  },
  llm: {
    title: '語言模型',
    subtitle: 'AIHubMix、OpenAI、OpenRouter 與其他 OpenAI 相容 API。',
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
  updates: {
    title: '安全更新',
    subtitle: '只接受簽章 Beta manifest；下載後會先驗證雜湊與簽章，再建立可回復的資料 migration snapshot。',
  },
}

async function openExternalLink(url: string) {
  if (window.subagents?.shell?.openExternal) {
    await window.subagents.shell.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function SettingsPage() {
  const { settings, update, testConnection, exportBundle, importBundle } = useSettingsStore()
  const [section, setSection] = useState('general')
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [bundleMsg, setBundleMsg] = useState<string | null>(null)
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null)
  const [mcpProbe, setMcpProbe] = useState<string | null>(null)
  const [mcpSessions, setMcpSessions] = useState<string | null>(null)
  const [mcpHealthById, setMcpHealthById] = useState<Record<string, string>>({})
  const [ocProviderMsg, setOcProviderMsg] = useState<string | null>(null)
  const [gatewayMsg, setGatewayMsg] = useState<string | null>(null)
  const [cliMsg, setCliMsg] = useState<string | null>(null)
  const [dataMsg, setDataMsg] = useState<string | null>(null)
  // G9 persona 疊層新增表單
  const [personaDraft, setPersonaDraft] = useState({ name: '', instructions: '', model: '' })
  const entitlementSnapshot = useEntitlementStore((s) => s.snapshot)
  const subscription = useSubscriptionStore((s) => s.state)
  const subscriptionEntitlement = useSubscriptionStore((s) => s.entitlement)
  const subscriptionError = useSubscriptionStore((s) => s.lastError)
  const removeSubscriptionDevice = useSubscriptionStore((s) => s.removeDevice)
  const featurePacks = useFeaturePackStore((s) => s.packs)
  const disableFeaturePackAction = useFeaturePackStore((s) => s.disable)
  const enableFeaturePackAction = useFeaturePackStore((s) => s.enable)
  const uninstallFeaturePackAction = useFeaturePackStore((s) => s.uninstall)
  const rollbackFeaturePackAction = useFeaturePackStore((s) => s.rollback)
  const gatewayInbound = useGatewayStore((s) => s.inbound)
  const bgJobs = useGatewayStore((s) => s.jobs)
  const projectRoot = useProjectStore((s) => s.root)
  const oc = useOpenCodeConfigStore()
  const ocCandidates = useOpenCodeConfigStore((s) => s.candidates)
  const ocSources = useOpenCodeConfigStore((s) => s.sources)
  const adoptOcCandidate = useOpenCodeConfigStore((s) => s.adoptCandidate)
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
  const [hookRulesDraft, setHookRulesDraft] = useState('')
  const [hookRulesError, setHookRulesError] = useState<string | null>(null)
  const [verifyingModel, setVerifyingModel] = useState(false)
  const [modelVerifyMsg, setModelVerifyMsg] = useState('')
  const [customToolsDraft, setCustomToolsDraft] = useState('')
  const [customToolsError, setCustomToolsError] = useState<string | null>(null)
  const [oauthRefreshMsg, setOauthRefreshMsg] = useState<string | null>(null)
  const [outboundStatus, setOutboundStatus] = useState<{
    deployGuard: string
    policySource: string
    buildFlavor: string
    policyDir?: string
    ledgerDir?: string
    encryptionAvailable?: boolean
    connectionId?: string
    activeViews?: number
    deployGuardError?: string
    policySourceError?: string
  } | null>(null)
  const [classifierTestMsg, setClassifierTestMsg] = useState<string | null>(null)
  const [classifierTesting, setClassifierTesting] = useState(false)
  const [updateState, setUpdateState] = useState<{
    status: string
    currentVersion: string
    manifest?: { version: string; mandatory: boolean; releaseNotes: string }
    progress: number
    deferredUntil?: string
    lastError?: string
  } | null>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  const refreshPluginTokens = useLearningStore((s) => s.refreshPluginTokens)
  // Recompute secret key list when plugins change
  const pluginsTick = useLearningStore((s) => s.plugins)
  const approveToolPackage = useLearningStore((s) => s.approveToolPackage)

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
    void loadLearning()
  }, [loadLearning])

  // Outbound Data Gate status (Electron main); browser shows null.
  // Ticket 16: keep settings.outboundGuardDeploy in sync with main so runtime
  // effective mode matches「公司強制」UI (renderer env is usually empty).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const st = await window.subagents?.outbound?.status?.({
          apiProvider: settings.apiProvider,
          baseUrl: settings.baseUrl,
        })
        if (cancelled || !st) {
          if (!cancelled) setOutboundStatus(null)
          return
        }
        setOutboundStatus(st)
        try {
          const { applyMainOutboundStatusToSettings } = await import(
            '../agent/outbound/outboundGate.ts'
          )
          const applied = applyMainOutboundStatusToSettings(
            { outboundProtectionEnabled: settings.outboundProtectionEnabled },
            {
              deployGuard: st.deployGuard as
                | 'off'
                | 'demo'
                | 'optional'
                | 'required'
                | 'invalid',
            },
          )
          if (
            applied.ok &&
            applied.patch.outboundGuardDeploy !== settings.outboundGuardDeploy
          ) {
            await update(applied.patch)
          }
        } catch {
          /* ignore hydrate failures */
        }
      } catch {
        if (!cancelled) setOutboundStatus(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    settings.apiProvider,
    settings.baseUrl,
    settings.outboundProtectionEnabled,
    settings.outboundGuardDeploy,
    section,
    update,
  ])

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
    for (const { id } of listPluginSecretMeta()) found.add(id)
    return [...found].sort()
  }, [settings.customTools, settings.customToolSecrets, pluginsTick])
  const toolTuning = useMemo(
    () => recommendToolTuning(settings.model || settings.roleModels?.orchestrator || ''),
    [settings.model, settings.roleModels?.orchestrator],
  )

  useEffect(() => {
    const api = window.subagents?.updates
    if (!api) return
    let disposed = false
    void api.state().then((state) => {
      if (!disposed) setUpdateState(state)
    })
    const unsubscribe = api.onProgress?.(({ progress }) => {
      if (!disposed) setUpdateProgress(progress)
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [section])

  const checkForUpdate = async () => {
    if (!window.subagents?.updates) {
      setUpdateMsg('瀏覽器預覽沒有安全更新通道。')
      return
    }
    setUpdateMsg('正在讀取簽章 Beta manifest…')
    const result = await window.subagents.updates.check()
    setUpdateState(result.state as typeof updateState)
    setUpdateMsg(result.ok ? '已驗證更新 manifest。' : `更新檢查失敗：${result.error || '未知錯誤'}`)
  }

  const deferCurrentUpdate = async () => {
    const version = updateState?.manifest?.version
    if (!version || !window.subagents?.updates) return
    const result = await window.subagents.updates.defer(version)
    setUpdateState(result.state as typeof updateState)
    setUpdateMsg(result.ok ? '已延後 7 天。' : `延後失敗：${result.error || '未知錯誤'}`)
  }

  const downloadCurrentUpdate = async () => {
    if (!window.subagents?.updates) return
    setUpdateProgress(0)
    setUpdateMsg('下載中，完成後會驗證檔案簽章…')
    const result = await window.subagents.updates.download()
    setUpdateState(result.state as typeof updateState)
    setUpdateMsg(result.ok ? '下載完成，檔案已通過雜湊與簽章驗證。' : `下載失敗：${result.error || '未知錯誤'}`)
  }

  const installCurrentUpdate = async () => {
    const api = window.subagents?.updates
    if (!api) return
    const rendererStorage: Record<string, string> = {}
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key?.startsWith('subagents.')) {
          const value = localStorage.getItem(key)
          if (value != null) rendererStorage[key] = value
        }
      }
    } catch {
      /* localStorage is optional in browser preview */
    }
    const parseStorage = (key: string): unknown => {
      try {
        const value = JSON.parse(rendererStorage[key] || '[]')
        return value
      } catch {
        return []
      }
    }
    const snapshot = await api.captureMigration({
      appVersion: updateState?.currentVersion,
      rendererStorage,
      projects: projectRoot ? [{ root: projectRoot }] : [],
      queue: parseStorage('subagents.runQueue.v1'),
      // Electron's main process replaces this with authoritative config/jobs.json.
      schedules: [],
      artifactIndex: (() => {
        try { return JSON.parse(rendererStorage['subagents.artifactIndex.v1'] || 'null') } catch { return null }
      })(),
    })
    const result = await api.install(snapshot)
    setUpdateState(result.state as typeof updateState)
    setUpdateMsg(result.ok ? '已建立 migration backup，請依安裝程式完成重啟。' : `安裝啟動失敗：${result.error || '未知錯誤'}`)
  }

  const rollbackCurrentUpdate = async () => {
    const api = window.subagents?.updates
    if (!api) return
    let result: Awaited<ReturnType<typeof api.rollback>>
    try {
      result = await api.rollback()
    } catch (error) {
      setUpdateMsg(`回復失敗：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const storage = result.snapshot?.rendererStorage
    if (result.ok && storage) {
      try {
        const current: Record<string, string> = {}
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i)
          if (key) {
            const value = localStorage.getItem(key)
            if (value != null) current[key] = value
          }
        }
        for (const key of Object.keys(current)) localStorage.removeItem(key)
        for (const [key, value] of Object.entries(applyRendererStorageSnapshot(current, storage))) localStorage.setItem(key, value)
      } catch {
        /* browser preview may not expose localStorage */
      }
    }
    setUpdateState(result.state as typeof updateState)
    setUpdateMsg(result.ok ? '已回復 migration snapshot；目前版本仍可啟動。' : '找不到可回復的 migration backup。')
    if (result.ok) window.setTimeout(() => window.location.reload(), 250)
  }

  const meta = SECTION_META[section] || { title: '設定', subtitle: '' }
  const isPolicyAdminBuild =
    outboundStatus?.buildFlavor === 'policy-admin' ||
    (typeof process !== 'undefined' &&
      (process as { env?: Record<string, string | undefined> }).env?.SUBAGENTS_BUILD_FLAVOR ===
        'policy-admin')
  const navSections = useMemo(
    () => (isPolicyAdminBuild ? SECTIONS : SECTIONS.filter((s) => s.id !== 'policyAdmin')),
    [isPolicyAdminBuild],
  )

  return (
    <ThemePage
      title="設定"
      sections={navSections}
      groups={SECTION_GROUPS}
      activeId={section}
      onChange={setSection}
      hideNavTitle
    >
      <div className="flex flex-col max-w-[820px] pb-10">
        <SettingsHeader title={meta.title} subtitle={meta.subtitle} />

        {section === 'piCore' && <PiCoreSettingsSection />}

        {section === 'general' && (
          <>
            <SettingsGroup title="方案">
              <SettingsRow
                title={entitlementSnapshot.tier === 'paid' ? '已啟用付費方案' : 'Free Core（本機優先，免登入）'}
                description={
                  entitlementSnapshot.tier === 'paid'
                    ? `已授權功能：${[...entitlementSnapshot.grantedFeatures].join(', ') || '無'}`
                    : 'Local providers/CLI、專案、sessions、多代理、Plan/Goal、權限、skills/MCP、diff/terminal/history、匯出與 Handoff 皆免費、免登入可用。'
                }
                control={
                  <span className="rounded-full border border-outline/30 px-2.5 py-1 text-[11px] font-medium">
                    {entitlementSnapshot.tier === 'paid' ? 'Pro' : 'Free Core'}
                  </span>
                }
              />
              {subscription.status !== 'active' && (
                <SettingsRow
                  title={
                    subscription.status === 'canceled'
                      ? '訂閱已取消'
                      : subscription.status === 'refunded'
                        ? '訂閱已退款'
                        : '尚未訂閱 Pro'
                  }
                  description={
                    subscription.status === 'canceled'
                      ? '目前方案將於到期後轉為 Free Core；到期前仍可使用已授權功能。'
                      : subscription.status === 'refunded'
                        ? '已退款訂閱需重新購買才能再次啟用；本機資料與 Free Core 不受影響。'
                        : `Pro：US$${SUBSCRIPTION_PRICING.monthly.usd}/月 或 US$${SUBSCRIPTION_PRICING.annual.usd}/年（最多 ${subscription.maxDevices} 台裝置）。`
                  }
                  control={
                    <button
                      type="button"
                      className={settingsBtnCls}
                      onClick={() => void openExternalLink('https://subagents.ai/pricing')}
                    >
                      查看方案
                    </button>
                  }
                />
              )}
              {subscription.status === 'active' && subscription.devices.length > 0 && (
                <SettingsStack title={`已啟用裝置（${subscription.devices.length}/${subscription.maxDevices}）`}>
                  {subscription.devices.map((d) => (
                    <SettingsRow
                      key={d.deviceId}
                      title={d.label || d.deviceId}
                      description={`啟用於 ${new Date(d.activatedAt).toLocaleString()}`}
                      control={
                        <button
                          type="button"
                          className={settingsBtnCls}
                          onClick={() => removeSubscriptionDevice(d.deviceId)}
                        >
                          移除裝置
                        </button>
                      }
                    />
                  ))}
                </SettingsStack>
              )}
              {subscriptionError && (
                <div
                  role="status"
                  className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/90"
                >
                  <Icon name="warning" size={15} className="mt-0.5 shrink-0 text-amber-300" />
                  <p>{subscriptionError}</p>
                </div>
              )}
            </SettingsGroup>
            {featurePacks.length > 0 && (
              <SettingsGroup title="功能包">
                {featurePacks.filter((p) => p.status !== 'uninstalled').map((p) => (
                  <SettingsRow
                    key={p.id}
                    title={`${p.manifest.name} v${p.manifest.version}`}
                    description={
                      p.status === 'entitlement-denied'
                        ? '需要更高方案授權才能啟用；Free Core 不受影響。'
                        : p.status === 'incompatible'
                          ? `需要 app 版本 ${p.manifest.minAppVersion}${p.manifest.maxAppVersion ? `–${p.manifest.maxAppVersion}` : '+'}。`
                          : p.status === 'disabled'
                            ? '已停用。'
                            : '已啟用。'
                    }
                    control={
                      <div className="flex items-center gap-2">
                        {p.status === 'active' ? (
                          <button type="button" className={settingsBtnCls} onClick={() => disableFeaturePackAction(p.id)}>停用</button>
                        ) : p.status === 'disabled' ? (
                          <button
                            type="button"
                            className={settingsBtnCls}
                            onClick={() => enableFeaturePackAction(p.id, updateState?.currentVersion || '0.0.0', subscriptionEntitlement)}
                          >
                            啟用
                          </button>
                        ) : null}
                        {p.previousManifest && (
                          <button
                            type="button"
                            className={settingsBtnCls}
                            onClick={() => rollbackFeaturePackAction(p.id, updateState?.currentVersion || '0.0.0', subscriptionEntitlement)}
                          >
                            回復 v{p.previousManifest.version}
                          </button>
                        )}
                        <button type="button" className={settingsBtnCls} onClick={() => uninstallFeaturePackAction(p.id)}>移除</button>
                      </div>
                    }
                  />
                ))}
              </SettingsGroup>
            )}
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
              <SettingsRow
                title="同時任務上限"
                description="不同對話會各自執行；此上限避免同時啟動過多本機或 LLM 工作"
                control={
                  <PillSelect
                    value={String(settings.maxConcurrentRuns || 4)}
                    onChange={(v) => set({ maxConcurrentRuns: Number(v) })}
                  >
                    <option value="2">2 runs</option>
                    <option value="3">3 runs</option>
                    <option value="4">4 runs</option>
                    <option value="6">6 runs</option>
                    <option value="8">8 runs</option>
                  </PillSelect>
                }
              />
              <SettingsRow
                title="單一任務時間上限"
                description="超過這個時間仍沒有進展的任務會安全停車，收尾寫成「已逾時中止」而不是失敗。每次有新進展都會重新計時；「依任務型態」會用內建預設（一般對話 10 分鐘、Goal-based 45 分鐘）。"
                control={
                  <PillSelect
                    value={String(settings.turnTimeoutMs || 0)}
                    onChange={(v) => set({ turnTimeoutMs: Number(v) })}
                  >
                    <option value="0">依任務型態</option>
                    <option value="300000">5 分鐘</option>
                    <option value="900000">15 分鐘</option>
                    <option value="1800000">30 分鐘</option>
                    <option value="3600000">1 小時</option>
                    <option value="10800000">3 小時</option>
                  </PillSelect>
                }
              />
            </SettingsGroup>
            <SettingsGroup title="通知">
              <SettingsRow
                title="任務完成通知"
                description="任一任務結束時發出系統通知。關閉只會停掉系統通知，對話內的訊息與 app 內的完成提示不受影響。"
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

        {section === 'updates' && (
          <>
            <SettingsGroup title="Beta 更新通道">
              <SettingsRow
                title="目前版本"
                description="僅接受符合目前平台與架構、且版本較新的簽章 manifest。"
                control={<span className="text-[12px] font-mono text-on-surface-variant">{updateState?.currentVersion || '讀取中…'}</span>}
              />
              <SettingsRow
                title="檢查更新"
                description="通道與 public key 由安裝環境提供；驗證失敗會 fail closed。"
                control={<button type="button" className={settingsBtnPrimaryCls} onClick={() => void checkForUpdate()}>檢查</button>}
              />
              {updateState?.manifest && (
                <>
                  <SettingsStack title={`Beta ${updateState.manifest.version}`} description={updateState.manifest.mandatory ? '必要更新' : '可延後更新'}>
                    <p className="text-[12px] leading-relaxed text-on-surface-variant whitespace-pre-wrap">{updateState.manifest.releaseNotes}</p>
                  </SettingsStack>
                  <SettingsRow
                    title="下載更新"
                    description={updateState.status === 'downloaded' ? '檔案已驗證，可開始安裝。' : '下載進度只反映已驗證的 HTTPS artifact。'}
                    control={
                      <div className="flex items-center gap-2">
                        {updateState.status !== 'downloaded' && <button type="button" className={settingsBtnPrimaryCls} onClick={() => void downloadCurrentUpdate()}>下載</button>}
                        {!updateState.manifest.mandatory && <button type="button" className={settingsBtnCls} onClick={() => void deferCurrentUpdate()}>延後</button>}
                      </div>
                    }
                  />
                  {updateState.status === 'downloaded' && (
                    <SettingsRow title="開始安裝" description="會先建立 N-1→N migration backup；安裝失敗可回復。" control={<button type="button" className={settingsBtnPrimaryCls} onClick={() => void installCurrentUpdate()}>安裝並重啟</button>} />
                  )}
                  {(updateState.status === 'install-pending' || updateState.status === 'failed') && (
                    <SettingsRow title="回復 migration" description="安裝器失敗或中斷時，保留目前版本並清除暫存更新檔。" control={<button type="button" className={settingsBtnCls} onClick={() => void rollbackCurrentUpdate()}>回復</button>} />
                  )}
                </>
              )}
            </SettingsGroup>
            {(updateMsg || updateState?.lastError) && <p className="px-1 mb-3 text-[12px] text-on-surface-variant">{updateMsg || updateState?.lastError}</p>}
            {(updateProgress > 0 || updateState?.status === 'downloaded') && <div className="mx-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(updateProgress, updateState?.status === 'downloaded' ? 100 : 0)}%` }} /></div>}
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
            <SettingsGroup title="運行指標（G11）">
              <SettingsRow
                title="本地指標"
                description={(() => {
                  const s = metricsSummary()
                  return s.runs
                    ? `${s.runs} runs · ask ${s.toolAsks} / deny ${s.toolDenials}（denial ratio ${(s.denialRatio * 100).toFixed(1)}%）· 壓縮 ${s.compactions} 次 · LLM 重試 ${s.llmRetries} 次`
                    : '尚無紀錄；每個 run 結束時自動記一筆（只記數字，不含 prompt 內容）'
                })()}
                control={
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={settingsBtnCls}
                      onClick={() => {
                        const jsonl = exportRunMetricsJsonl()
                        if (!jsonl) {
                          setDataMsg('沒有可匯出的指標')
                          return
                        }
                        const blob = new Blob([jsonl], { type: 'application/jsonl' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `subagents-metrics-${new Date().toISOString().slice(0, 10)}.jsonl`
                        a.click()
                        URL.revokeObjectURL(url)
                        setDataMsg('指標已匯出（JSONL）')
                      }}
                    >
                      匯出 JSONL
                    </button>
                    <button
                      type="button"
                      className="text-[11px] text-error hover:underline"
                      onClick={() => {
                        resetRunMetrics()
                        setDataMsg('指標已清除')
                      }}
                    >
                      清除
                    </button>
                  </div>
                }
              />
            </SettingsGroup>
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
                              ? 'border-primary/50 text-primary bg-primary/10'
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
              <SettingsStack title="API 供應商">
                <select
                  value={settings.apiProvider || 'custom'}
                  className={settingsInputCls}
                  onChange={(e) => {
                    const provider = apiProviderPreset(e.target.value as ApiProviderPreset)
                    if (provider.id === 'custom') {
                      set({ apiProvider: 'custom' })
                      return
                    }
                    set({
                      apiProvider: provider.id,
                      baseUrl: provider.baseUrl,
                      model: provider.defaultModel,
                      fallbackModels: provider.fallbackModels,
                      discoveredModels: [],
                    })
                  }}
                >
                  {API_PROVIDER_PRESETS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-outline">
                  {apiProviderPreset(settings.apiProvider || 'custom').note}
                </p>
              </SettingsStack>
              <SettingsRow
                title="啟用 LLM"
                description="使用所選供應商的 OpenAI 相容 API"
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
                {/* P1-B: capability profile — 已驗證 / 推測 / 未知 */}
                {(() => {
                  const p = settings.modelProfiles?.[settings.model || '']
                  const badge = p
                    ? p.source === 'verified'
                      ? '已驗證'
                      : '推測'
                    : '未知'
                  const cap = (v: boolean | undefined, name: string) =>
                    `${name} ${v === true ? '✓' : v === false ? '✗' : '?'}`
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className={`px-1.5 py-0.5 rounded font-semibold ${
                          badge === '已驗證'
                            ? 'bg-primary/15 text-primary'
                            : badge === '推測'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-white/10 text-outline'
                        }`}
                      >
                        {badge}
                      </span>
                      {p && (
                        <span className="text-on-surface-variant font-[family-name:var(--font-mono)]">
                          {cap(p.tools, 'tools')} · {cap(p.vision, 'vision')} ·{' '}
                          {cap(p.structuredOutput, 'json')}
                          {p.contextWindow ? ` · ${Math.round(p.contextWindow / 1000)}k ctx` : ''}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={verifyingModel || !settings.model || !settings.apiKey}
                        className={`${settingsBtnCls} disabled:opacity-50`}
                        onClick={async () => {
                          const id = settings.model?.trim()
                          if (!id) return
                          setVerifyingModel(true)
                          try {
                            const { verifyModelCapabilities } = await import(
                              '../agent/modelProfile'
                            )
                            const r = await verifyModelCapabilities(settings, id)
                            await set({
                              modelProfiles: {
                                ...(settings.modelProfiles || {}),
                                [id]: r.profile,
                              },
                            })
                            setModelVerifyMsg(r.logs.join(' · '))
                          } catch (e) {
                            setModelVerifyMsg(e instanceof Error ? e.message : String(e))
                          } finally {
                            setVerifyingModel(false)
                          }
                        }}
                      >
                        {verifyingModel ? '驗證中…' : '驗證模型能力（3 次極小呼叫）'}
                      </button>
                      {modelVerifyMsg && (
                        <span className="text-outline">{modelVerifyMsg}</span>
                      )}
                    </div>
                  )
                })()}
              </SettingsStack>
              <SettingsStack title="通道備援模型">
                <input
                  value={(settings.fallbackModels || []).join(', ')}
                  onChange={(e) =>
                    set({
                      fallbackModels: e.target.value
                        .split(',')
                        .map((id) => id.trim())
                        .filter(Boolean),
                    })
                  }
                  className={settingsInputCls}
                  placeholder="僅在供應商回報無可用通道時依序重試"
                />
                <p className="mt-1 text-[11px] text-outline">
                  僅在 `no_available_channel` 時自動重試；驗證、配額與格式錯誤不會被掩蓋。
                </p>
                {settings.apiProvider === 'aihubmix' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {apiProviderPreset('aihubmix').fallbackModels.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className="rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/15"
                        onClick={() => set({ model })}
                      >
                        改用 {model}
                      </button>
                    ))}
                  </div>
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
            <SettingsGroup title="Adapter capability matrix">
              <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
                {CLI_ADAPTERS.map((adapter) => {
                  const providerId = adapter.id === 'claude' ? 'anthropic' : adapter.id === 'gemini' ? 'google' : adapter.id
                  const provider = (settings.cliProviders || []).find((item) => item.id === providerId || item.id === adapter.id)
                  return (
                    <div key={adapter.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-on-surface">{adapter.displayName}</span>
                        <span className={`text-[10px] ${provider?.enabled && provider.authorized ? 'text-primary' : 'text-outline'}`}>
                          {provider?.enabled && provider.authorized ? '已授權' : '未授權'}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-outline">
                        resume {adapter.supports.resume ? '✓' : '—'} · image {adapter.supports.images ? '✓' : '—'} · MCP {adapter.supports.mcp ? '✓' : '—'} · sandbox {adapter.supports.sandbox}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-outline/70">
                        probe {provider?.lastProbeAt ? new Date(provider.lastProbeAt).toLocaleString() : '尚未掃描'} · {provider?.diagnostic?.binaryPath || adapter.binaryCandidates[0]}
                      </p>
                    </div>
                  )
                })}
              </div>
              <p className="px-4 pb-3 text-[11px] leading-relaxed text-outline">
                未安裝或未授權只會顯示診斷，不會自動安裝 binary 或複製 token。其他 agent 目前維持 discovery-only：{DISCOVERY_ONLY_AGENT_ADAPTERS.slice(0, 6).map((item) => item.displayName).join('、')} 等。
              </p>
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
                    p.kind === 'anthropic' ||
                    p.kind === 'google') && (
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
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={oc.loading}
                    onClick={() => void oc.hydrate(projectRoot)}
                    className={settingsBtnCls + ' disabled:opacity-40'}
                  >
                    {oc.loading ? '載入中…' : '重新整理'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setOcProviderMsg('讀取 OpenCode provider catalog…')
                      const health = await inspectOpenCodeServer()
                      if (!health.ok || !health.baseUrl) {
                        setOcProviderMsg(health.error || '找不到 localhost OpenCode server；先啟動 server。')
                        return
                      }
                      const raw = await getOpenCodeProviderCatalog(health.baseUrl)
                      const mapped = mapOpenCodeProviderCatalog(
                        unwrapOpenCodeServerValue(raw) as Parameters<typeof mapOpenCodeProviderCatalog>[0],
                      )
                      if (!mapped.modelIds.length) {
                        setOcProviderMsg('server 沒有回傳可採用的 model candidate。')
                        return
                      }
                      const existing = settings.modelProfiles || {}
                      const profiles = { ...existing }
                      for (const id of mapped.modelIds) {
                        if (!profiles[id]) profiles[id] = mapped.profiles[id]
                      }
                      set({
                        discoveredModels: [...new Set([...(settings.discoveredModels || []), ...mapped.modelIds])],
                        modelProfiles: profiles,
                      })
                      setOcProviderMsg(`已採用 ${mapped.modelIds.length} 個 server model candidate（不覆蓋既有模型設定）。`)
                    }}
                    className={settingsBtnCls}
                  >
                    採用 Provider candidates
                  </button>
                </div>
              }
            >
              <div className="px-4 py-3 text-[11px] text-outline leading-relaxed">
                合併{' '}
                <code className="text-primary/80 font-mono">使用者資料目錄/opencode/opencode.json</code>
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
              {ocProviderMsg && (
                <p className="text-[11px] text-primary/90 px-4 pb-3">{ocProviderMsg}</p>
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

            <SettingsGroup title="Project permissions">
              {Object.keys(oc.permission).length === 0 ? (
                <div className="px-4 py-3 text-[12px] text-outline">
                  未設定專案／全域 OpenCode permission；使用內建 Build / Plan 預設規則。
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 text-[10px] text-outline">
                    這些規則只會套用到目前載入的專案 run；deny 優先於 ask，bash pattern 依檔案順序由後到前覆蓋。
                  </div>
                  {Object.entries(oc.permission).map(([key, value]) => (
                    <SettingsRow
                      key={key}
                      title={key}
                      description={
                        typeof value === 'string'
                          ? value
                          : `${Object.keys(value || {}).length} pattern 規則`
                      }
                      control={
                        <span
                          className={`text-[10px] font-mono ${
                            value === 'deny'
                              ? 'text-error'
                              : value === 'ask'
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                          }`}
                        >
                          {typeof value === 'string' ? value : 'pattern'}
                        </span>
                      }
                    />
                  ))}
                </>
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
              <SettingsRow
                title="啟用 Sub Agent"
                description="開啟後才會使用 Manager／Analyzer-1／Writer 角色模型與 delegate_task；預設關閉，關閉時所有步驟使用全域模型。"
                control={
                  <SettingsToggle
                    checked={settings.subAgentsEnabled === true}
                    onChange={(v) => set({ subAgentsEnabled: v })}
                  />
                }
              />
              {(() => {
                // Outbound Data Gate (deploy × user). Build flavor is orthogonal.
                let deploy: OutboundGuardMode = settings.outboundGuardDeploy || 'off'
                if (!settings.outboundGuardDeploy) {
                  try {
                    deploy = parseDeployOutboundGuard(
                      typeof process !== 'undefined'
                        ? (process as { env?: Record<string, string | undefined> }).env
                            ?.SUBAGENTS_OUTBOUND_GUARD
                        : undefined,
                    )
                  } catch {
                    deploy = 'off'
                  }
                }
                const connId = connectionIdForBuiltinLlm({
                  apiProvider: settings.apiProvider,
                  baseUrl: settings.baseUrl,
                })
                let policySourceLabel = 'local'
                try {
                  policySourceLabel = parsePolicySourceMode(
                    typeof process !== 'undefined'
                      ? (process as { env?: Record<string, string | undefined> }).env
                          ?.SUBAGENTS_POLICY_SOURCE
                      : undefined,
                  )
                } catch {
                  policySourceLabel = 'invalid'
                }
                const deployLive = (outboundStatus?.deployGuard as OutboundGuardMode) || deploy
                const sourceLive = outboundStatus?.policySource || policySourceLabel
                const flavor = outboundStatus?.buildFlavor || 'standard'
                const policyMeta = `provider ${outboundStatus?.connectionId || connId} · source ${sourceLive} · flavor ${flavor}${outboundStatus?.encryptionAvailable ? ' · sealed-capable' : ''}`
                const extraStatus =
                  outboundStatus?.deployGuardError ||
                  outboundStatus?.policyDir
                    ? ` · dir ${outboundStatus.policyDir || '—'}`
                    : ''
                if (deployLive === 'off') {
                  return (
                    <>
                      <SettingsRow
                        title="出站資料閘門"
                        description={`部署模式 off：LLM／CLI 出站不經淨化（維持既有路徑）。${policyMeta}${extraStatus}`}
                        control={<span className="text-[11px] text-outline">off</span>}
                      />
                      <SettingsRow
                        title="Build flavor"
                        description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                        control={<span className="text-[11px] text-outline">{flavor}</span>}
                      />
                    </>
                  )
                }
                if (deployLive === 'required') {
                  return (
                    <>
                      <SettingsRow
                        title="出站資料閘門（公司強制）"
                        description={`required：公司部署強制保護，使用者無法關閉。所有 builtin LLM 與 external CLI 出站都會經過閘門。${policyMeta}${extraStatus}`}
                        control={
                          <span className="text-[11px] text-outline" title="公司強制 · 不可關閉">
                            公司強制 · 開
                          </span>
                        }
                      />
                      <SettingsRow
                        title="Build flavor"
                        description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                        control={<span className="text-[11px] text-outline">{flavor}</span>}
                      />
                    </>
                  )
                }
                if (deployLive === 'demo') {
                  return (
                    <>
                      <SettingsRow
                        title="出站資料閘門（demo）"
                        description={`⚠ demo 非企業保障：會跑淨化流程與暫時證據，不可當作公司合規驗證。${policyMeta}${extraStatus}`}
                        control={<span className="text-[11px] text-amber-400">demo</span>}
                      />
                      <SettingsRow
                        title="Build flavor"
                        description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                        control={<span className="text-[11px] text-outline">{flavor}</span>}
                      />
                    </>
                  )
                }
                return (
                  <>
                    <SettingsRow
                      title="出站資料閘門"
                      description={`optional：可自行開啟保護。啟用後每次 LLM／CLI 出站都會經過閘門（可即時套用，無需重啟）。${policyMeta}${extraStatus}`}
                      control={
                        <SettingsToggle
                          checked={settings.outboundProtectionEnabled === true}
                          onChange={(v) => set({ outboundProtectionEnabled: v })}
                        />
                      }
                    />
                    <SettingsRow
                      title="Build flavor"
                      description="與 guard mode 正交；policy-admin 僅增加管理面，不形成 bypass。"
                      control={<span className="text-[11px] text-outline">{flavor}</span>}
                    />
                  </>
                )
              })()}
              {(outboundStatus?.buildFlavor === 'policy-admin' ||
                (typeof process !== 'undefined' &&
                  (process as { env?: Record<string, string | undefined> }).env
                    ?.SUBAGENTS_BUILD_FLAVOR === 'policy-admin')) && (
                <SettingsRow
                  title="Policy Admin"
                  description="此 build 含政策草稿／啟用／證據驗證管理面。Possession of this artifact is the management authority — 不會繞過 Outbound Data Gate。"
                  control={<span className="text-[11px] text-primary">enabled</span>}
                />
              )}
              <SettingsRow
                title="Classification endpoint"
                description="完整 URL（通常以 /v1 結尾）。連線測試只送 SYNTHETIC 內容，不讀專案／prompt。"
                control={
                  <input
                    className={settingsInputCls + ' min-w-[14rem]'}
                    value={settings.classificationEndpointUrl || ''}
                    placeholder="https://classify.corp.example/v1"
                    onChange={(e) => set({ classificationEndpointUrl: e.target.value })}
                  />
                }
              />
              <SettingsRow
                title="允許 plaintext HTTP classifier"
                description="僅在公司明確核准時開啟；evidence 會標示未加密。"
                control={
                  <SettingsToggle
                    checked={settings.classificationAllowPlaintextHttp === true}
                    onChange={(v) => set({ classificationAllowPlaintextHttp: v })}
                  />
                }
              />
              <SettingsRow
                title="Classifier 連線測試"
                description={classifierTestMsg || '使用 synthetic payload 探測 endpoint。'}
                control={
                  <button
                    type="button"
                    className={settingsBtnCls}
                    disabled={classifierTesting || !(settings.classificationEndpointUrl || '').trim()}
                    onClick={() => {
                      void (async () => {
                        setClassifierTesting(true)
                        setClassifierTestMsg(null)
                        try {
                          const { callCompanyClassifier, syntheticClassifierTestRequest } =
                            await import('../agent/outbound/companyClassifier')
                          const { connectionIdForBuiltinLlm: connFn } = await import(
                            '../agent/outbound/providerConnectionId'
                          )
                          const cid = connFn({
                            apiProvider: settings.apiProvider,
                            baseUrl: settings.baseUrl,
                          })
                          const url = (settings.classificationEndpointUrl || '').trim()
                          const r = await callCompanyClassifier({
                            endpointUrl: url,
                            request: syntheticClassifierTestRequest(cid),
                            allowPlaintextHttp: settings.classificationAllowPlaintextHttp === true,
                          })
                          if (r.ok) {
                            setClassifierTestMsg(
                              `OK · ${r.transport} · attempts=${r.attempts} · exclusions=${r.exclusions.length}`,
                            )
                          } else {
                            setClassifierTestMsg(`${r.status}: ${r.reason}`)
                          }
                        } catch (e) {
                          setClassifierTestMsg(e instanceof Error ? e.message : String(e))
                        } finally {
                          setClassifierTesting(false)
                        }
                      })()
                    }}
                  >
                    {classifierTesting ? '測試中…' : '測試'}
                  </button>
                }
              />
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
            <SettingsGroup title="Delegate Personas（G9 行為疊層）">
              {Object.entries(settings.delegatePersonas || {}).map(([name, p]) => (
                <SettingsRow
                  key={name}
                  title={name}
                  description={`${p.model ? `model=${p.model} · ` : ''}${(p.description || p.instructions || '').slice(0, 80)}`}
                  control={
                    <button
                      type="button"
                      className="text-[11px] text-error hover:underline"
                      onClick={() => {
                        const next = { ...(settings.delegatePersonas || {}) }
                        delete next[name]
                        set({ delegatePersonas: next })
                      }}
                    >
                      刪除
                    </button>
                  }
                />
              ))}
              <SettingsStack title="新增 persona">
                <div className="space-y-1.5">
                  <input
                    value={personaDraft.name}
                    onChange={(e) => setPersonaDraft({ ...personaDraft, name: e.target.value })}
                    placeholder="名稱（如 researcher / concise）"
                    className={settingsInputCls + ' w-full'}
                  />
                  <textarea
                    value={personaDraft.instructions}
                    onChange={(e) =>
                      setPersonaDraft({ ...personaDraft, instructions: e.target.value })
                    }
                    placeholder="行為指示（注入子代理 prompt；如「務必引用具體檔案路徑」）"
                    rows={3}
                    className={settingsInputCls + ' w-full'}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      value={personaDraft.model}
                      onChange={(e) => setPersonaDraft({ ...personaDraft, model: e.target.value })}
                      placeholder="模型覆寫（選填；role 覆寫優先）"
                      className={settingsInputCls + ' flex-1'}
                    />
                    <button
                      type="button"
                      className={settingsBtnCls}
                      disabled={!personaDraft.name.trim() || !personaDraft.instructions.trim()}
                      onClick={() => {
                        const name = personaDraft.name.trim().slice(0, 40)
                        set({
                          delegatePersonas: {
                            ...(settings.delegatePersonas || {}),
                            [name]: {
                              instructions: personaDraft.instructions.trim().slice(0, 2000),
                              model: personaDraft.model.trim() || undefined,
                            },
                          },
                        })
                        setPersonaDraft({ name: '', instructions: '', model: '' })
                      }}
                    >
                      新增
                    </button>
                  </div>
                  <p className="text-[11px] text-outline">
                    delegate_task 以 persona=&lt;名稱&gt; 套用；只影響指示與模型，不放寬工具權限（capability_mode 另管）。
                  </p>
                </div>
              </SettingsStack>
            </SettingsGroup>
          </>
        )}

        {section === 'policyAdmin' && (
          <PolicyAdminSection isPolicyAdminBuild={isPolicyAdminBuild} />
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
                title="跨 Session 召回"
                description="執行開始時搜尋 Archive／記憶／技能，把同類任務摘要注入 prompt（Hermes 召回）"
                control={
                  <SettingsToggle
                    checked={settings.sessionRecallEnabled !== false}
                    onChange={(v) => set({ sessionRecallEnabled: v })}
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
              {settings.capabilitiesEnabled !== false && <HostToolCatalogSection />}
              {/* P1-D: declarative lifecycle hook rules */}
              <SettingsStack title="Lifecycle hooks（宣告式規則）">
                <p className="text-[11px] text-on-surface-variant mb-1 leading-relaxed">
                  純資料規則，只能限制/觀察：point（beforeRun/beforeTool/afterTool/afterRun）
                  × action（deny / require-approval / append-context / log / notify）。
                  require-approval 連「完整存取權」也會攔。外掛 hooks 由 manifest 提供並經 sanitize。
                </p>
                <textarea
                  className={settingsInputCls + ' min-h-[120px] resize-y font-[family-name:var(--font-mono)] text-[11px]'}
                  value={hookRulesDraft || JSON.stringify(settings.hookRules || [], null, 2)}
                  onChange={(e) => { setHookRulesDraft(e.target.value); setHookRulesError(null) }}
                  onBlur={() => {
                    try {
                      const parsed = hookRulesDraft.trim() ? JSON.parse(hookRulesDraft) : []
                      if (!Array.isArray(parsed)) throw new Error('必須是陣列')
                      void set({ hookRules: parsed })
                      setHookRulesDraft('')
                    } catch (err) {
                      setHookRulesError(err instanceof Error ? err.message : String(err))
                    }
                  }}
                  placeholder='[{"id":"deny-bash-on-schedule","point":"beforeTool","match":{"tool":"bash","sourceKind":["schedule"]},"action":"deny","reason":"排程禁用 bash"}]'
                />
                {hookRulesError && (
                  <p className="text-[11px] text-error mt-1">{hookRulesError}</p>
                )}
              </SettingsStack>
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
            <SettingsGroup title="LLM 韌性">
              <SettingsRow
                title="重試次數"
                description="429/5xx/網路錯誤自動退避重試（含首次呼叫；1 = 不重試）"
                control={
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={settings.llmRetryMaxAttempts ?? 3}
                    onChange={(e) =>
                      set({
                        llmRetryMaxAttempts: Math.min(
                          6,
                          Math.max(1, Number(e.target.value) || 3),
                        ),
                      })
                    }
                    className={settingsInputCls + ' w-20 text-right'}
                  />
                }
              />
              <SettingsRow
                title="Circuit breaker"
                description="provider 錯誤率過高時暫停呼叫並降級（冷卻後自動探測恢復）"
                control={
                  <SettingsToggle
                    checked={settings.llmCircuitBreakerEnabled !== false}
                    onChange={(v) => set({ llmCircuitBreakerEnabled: v })}
                  />
                }
              />
              <SettingsRow
                title="預設 context window"
                description={`模型 profile 未知時的 token 上限（目前 ${settings.defaultContextWindowTokens ?? 64000}）；供壓縮門檻與溢位預檢`}
                control={
                  <input
                    type="number"
                    min={4000}
                    max={2000000}
                    step={1000}
                    value={settings.defaultContextWindowTokens ?? 64000}
                    onChange={(e) =>
                      set({
                        defaultContextWindowTokens: Math.max(
                          4000,
                          Number(e.target.value) || 64000,
                        ),
                      })
                    }
                    className={settingsInputCls + ' w-28 text-right'}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="專案 Hooks 信任">
              <SettingsRow
                title="信任目前專案"
                description={
                  projectRoot
                    ? `允許載入 ${projectRoot} 下的 .subagents/hooks.json（僅能限制/觀察，不能放寬權限）`
                    : '尚未綁定專案；未信任的專案 hooks 一律靜默跳過'
                }
                control={
                  <SettingsToggle
                    checked={Boolean(
                      projectRoot &&
                        (settings.trustedHookProjects || []).includes(projectRoot),
                    )}
                    onChange={(v) => {
                      if (!projectRoot) return
                      const current = settings.trustedHookProjects || []
                      set({
                        trustedHookProjects: v
                          ? [...new Set([...current, projectRoot])]
                          : current.filter((r) => r !== projectRoot),
                      })
                      void import('../agent/projectHooks').then((m) =>
                        m.invalidateProjectHooks(projectRoot),
                      )
                    }}
                  />
                }
              />
              {(settings.trustedHookProjects || []).map((root) => (
                <SettingsRow
                  key={root}
                  title={root.split('/').pop() || root}
                  description={root}
                  control={
                    <button
                      type="button"
                      className="text-[11px] text-error hover:underline"
                      onClick={() => {
                        set({
                          trustedHookProjects: (
                            settings.trustedHookProjects || []
                          ).filter((r) => r !== root),
                        })
                        void import('../agent/projectHooks').then((m) =>
                          m.invalidateProjectHooks(root),
                        )
                      }}
                    >
                      移除信任
                    </button>
                  }
                />
              ))}
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
              <SettingsStack title="Post-state Webhook target（選填）">
                <input
                  type="url"
                  className={settingsInputCls}
                  value={settings.webhookTarget || ''}
                  onChange={(e) => set({ webhookTarget: e.target.value })}
                  placeholder="https://example.com/hooks/subagents"
                  autoComplete="off"
                />
                <p className="text-[11px] text-outline mt-1">
                  只有 Next_State=Dispatch Webhook 才會送出；未設定或非 http/https 會留下失敗 audit。
                </p>
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
                description="代理載入已啟用來源的 namespaced native MCP tools"
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
                {listPluginSecretMeta().length === 0 ? (
                  <p className="text-outline">尚無 connector 密鑰 — 在學習中心 → 外掛完成授權後會顯示於此。</p>
                ) : (
                  listPluginSecretMeta().map((meta) => (
                    <div
                      key={meta.id}
                      className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-1.5 last:border-0"
                    >
                      <span className="font-[family-name:var(--font-mono)] text-on-surface-variant truncate">
                        {meta.id}
                        <span className="ml-2 text-outline">{meta.tokenHint}</span>
                        {meta.encrypted ? (
                          <span className="ml-2 text-[10px] text-primary/80">vault</span>
                        ) : (
                          <span className="ml-2 text-[10px] text-amber-300/80">未加密（無 OS 鑰匙圈）</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-outline">
                        {meta.hasRefreshToken
                          ? secretNeedsRefresh(meta)
                            ? 'refresh 待執行'
                            : meta.expiresAt
                              ? `到期 ${new Date(meta.expiresAt).toLocaleString()}`
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
              description="含設定、排程與事件；API 金鑰與 token 會自動遮罩"
              control={
                <button
                  type="button"
                  className={settingsBtnPrimaryCls}
                  onClick={async () => {
                    // Issue 06 — 匯出前明確同意：說明遮罩範圍與仍包含的敏感 metadata
                    if (!window.confirm(bundleSensitivityNotice())) {
                      setBundleMsg('已取消匯出。')
                      return
                    }
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

/**
 * 工具目錄（Host 投影）— the Settings tool list IS the Host's catalog.
 *
 * Every entry carries its own availability fact with a reason, so live and
 * not-yet-live tools sit beside each other instead of greying out wholesale
 * (issue 03). When the Host cannot produce a catalog this section FAILS
 * CLOSED with an explicit message — it never falls back to the deleted
 * renderer list, because that fallback is the two-catalog problem restated.
 */
function HostToolCatalogSection() {
  const [catalog, setCatalog] = useState<Array<{ name: string; description: string; pack: string; source: 'discovered' | 'installed'; active: boolean; available: boolean; reason?: string; schemaDigest: string }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const api = window.subagents?.piHost?.tools?.catalog
        if (!api) throw new Error('目前是 plain-browser compatibility mode，沒有 Electron Pi Host contract；工具目錄不會回退到 renderer definitions')
        const { catalog: entries } = await api()
        if (!cancelled) setCatalog(entries)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [])
  return (
    <SettingsStack title="工具目錄（Host 投影）">
      <p className="text-[12px] text-on-surface-variant mb-2 leading-relaxed">
        這份清單就是 agent 實際可用的工具：由 Pi Core Host 投影，每筆帶自己的可用狀態與原因。
        能力包內的工具在 load_capability 後才會變 active。
      </p>
      {error ? (
        <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
          工具目錄不可用：{error}。請確認 Pi Core Host 已啟動；此頁不會回退到本機清單。
        </div>
      ) : !catalog ? (
        <div className="text-[12px] text-outline">載入中…</div>
      ) : (
        (() => {
          const byPack = new Map<string, typeof catalog>()
          for (const entry of catalog) {
            byPack.set(entry.pack, [...(byPack.get(entry.pack) || []), entry])
          }
          return (
            <div className="space-y-3">
              {[...byPack.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pack, entries]) => (
                <div key={pack}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-outline mb-1.5">
                    {pack}
                    <span className="ml-1.5 normal-case font-normal opacity-70">
                      {entries.filter((entry) => entry.active).length}/{entries.length} active
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {entries.map((entry) => (
                      <span
                        key={entry.name}
                        title={`${entry.description}${entry.reason ? `\n${entry.reason}` : ''}\nsource: ${entry.source}\npack: ${entry.pack}\nschema: ${entry.schemaDigest}`}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium border ${
                          entry.active
                            ? 'border-primary/40 bg-primary/15 text-primary'
                            : 'border-white/10 text-on-surface-variant'
                        }`}
                      >
                        {entry.name}
                        {!entry.available ? ' · unavailable' : !entry.active ? ' · inactive' : ' · active'}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 space-y-0.5 text-[10px] text-outline">
                    {entries.map((entry) => (
                      <div key={`${entry.name}-facts`} className="flex flex-wrap gap-x-2">
                        <span>{entry.name}</span>
                        <span>source={entry.source}</span>
                        <span>pack={entry.pack}</span>
                        <span>schema={entry.schemaDigest.slice(0, 12)}…</span>
                        {entry.reason && <span className="text-error">{entry.reason}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        })()
      )}
    </SettingsStack>
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
