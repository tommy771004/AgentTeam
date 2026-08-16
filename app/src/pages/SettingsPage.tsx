import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from '../commands/settingsSections'
import { AppearancePanel } from '../components/settings/panels/AppearancePanel'
import { PersonalizationPanel } from '../components/settings/panels/PersonalizationPanel'
import { DataControlsPanel } from '../components/settings/panels/DataControlsPanel'
import { GeneralPanel } from '../components/settings/panels/GeneralPanel'
import { CliPanel } from '../components/settings/panels/CliPanel'
import { LlmPanel } from '../components/settings/panels/LlmPanel'
import { OpenCodePanel } from '../components/settings/panels/OpenCodePanel'
import { RolesPanel } from '../components/settings/panels/RolesPanel'
import { SafetyPanel } from '../components/settings/panels/SafetyPanel'
import { MemoryPanel } from '../components/settings/panels/MemoryPanel'
import { ShortcutsPanel } from '../components/settings/panels/ShortcutsPanel'
import {
  SettingsAnchor,
  SettingsField,
  type SettingsFieldContext,
} from '../components/settings/SettingsField'
import { SettingsSearch } from '../components/settings/SettingsSearch'
import { fieldAnchorId, getSettingsField, sectionHasVisibleFields } from '../settings/fieldRegistry'
import { useSettingsUiStore } from '../store/settingsUiStore'


import { ThemePage } from '../components/SectionNav'
import {
  SettingsGroup,
  SettingsHeader,
  type OutboundStatus,
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
import type {
  McpServerConfig,
} from '../agent/types'
import {
  listAllMcpTools,
  mcpEnsureSession,
  mcpListSessions,
  mcpStopSession,
} from '../agent/hermes/mcp'
import { useGatewayStore } from '../store/gatewayStore'
import {
} from '../agent/outbound/outboundGate'
import { useOpenCodeConfigStore } from '../store/opencodeConfigStore'
import { useProjectStore } from '../store/projectStore'
import { applyRendererStorageSnapshot } from '../agent/updateMigration'
import { bundleSensitivityNotice } from '../agent/settingsExport'
import {
} from '../store/shortcutStore'
import {
  OAUTH_REDIRECT_URI,
  PLUGIN_OAUTH_PROVIDERS,
} from '../agent/hermes/pluginOAuth'
import { listPluginSecretMeta, secretNeedsRefresh } from '../agent/hermes/pluginSecrets'
import { customToolsForSettings, listPendingToolPackages } from '../agent/tools/customTools'
import { pluginRegistry } from '../agent/hermes/plugins'
import {
} from '../agent/opencode/serverClient'

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

export function SettingsPage() {
  const { settings, update, testConnection, exportBundle, importBundle } = useSettingsStore()
  // ?section= 深連結（誠實性橫幅 CTA / Command Palette 共用）；無效值回一般節
  const [searchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const [section, setSection] = useState(
    requestedSection && SETTINGS_SECTIONS.some((s) => s.id === requestedSection) ? requestedSection : 'general',
  )
  // 已掛載的設定頁再次收到深連結（palette / 橫幅重複點擊）也要切節
  useEffect(() => {
    if (requestedSection && SETTINGS_SECTIONS.some((s) => s.id === requestedSection)) {
      setSection(requestedSection)
    }
  }, [requestedSection])
  const [bundleMsg, setBundleMsg] = useState<string | null>(null)
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null)
  const [mcpProbe, setMcpProbe] = useState<string | null>(null)
  const [mcpSessions, setMcpSessions] = useState<string | null>(null)
  const [mcpHealthById, setMcpHealthById] = useState<Record<string, string>>({})
  const [gatewayMsg, setGatewayMsg] = useState<string | null>(null)
  // G9 persona 疊層新增表單
  const gatewayInbound = useGatewayStore((s) => s.inbound)
  const bgJobs = useGatewayStore((s) => s.jobs)
  const projectRoot = useProjectStore((s) => s.root)
  const oc = useOpenCodeConfigStore()
  const ocCandidates = useOpenCodeConfigStore((s) => s.candidates)
  const ocSources = useOpenCodeConfigStore((s) => s.sources)
  const adoptOcCandidate = useOpenCodeConfigStore((s) => s.adoptCandidate)
  const loadLearning = useLearningStore((s) => s.load)
  const [customToolsDraft, setCustomToolsDraft] = useState('')
  const [customToolsError, setCustomToolsError] = useState<string | null>(null)
  const [oauthRefreshMsg, setOauthRefreshMsg] = useState<string | null>(null)
  const [outboundStatus, setOutboundStatus] = useState<OutboundStatus | null>(null)
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
  const showAdvanced = useSettingsUiStore((state) => state.showAdvanced)
  const setShowAdvanced = useSettingsUiStore((state) => state.setShowAdvanced)
  /** 搜尋跳轉／深連結命中的欄位——捲到它並短暫高亮 */
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const isPolicyAdminBuild =
    outboundStatus?.buildFlavor === 'policy-admin' ||
    (typeof process !== 'undefined' &&
      (process as { env?: Record<string, string | undefined> }).env?.SUBAGENTS_BUILD_FLAVOR ===
        'policy-admin')
  const navSections = useMemo(() => {
    const byBuild = isPolicyAdminBuild
      ? SETTINGS_SECTIONS
      : SETTINGS_SECTIONS.filter((s) => s.id !== 'policyAdmin')
    // 整節都是進階的節（例如角色模型）在基礎檢視直接收起來——留一個點進去
    // 空白的節名比藏起來更糟。
    return byBuild.filter((s) =>
      sectionHasVisibleFields(s.id, { showAdvanced, policyAdminBuild: isPolicyAdminBuild }),
    )
  }, [isPolicyAdminBuild, showAdvanced])
  const fieldCtx: SettingsFieldContext = {
    showAdvanced,
    policyAdminBuild: isPolicyAdminBuild,
    highlightId,
  }

  /**
   * 跳到某個設定欄位：切節 → 需要時打開進階 → 捲動並高亮。
   *
   * 進階欄位若停在 basic 檢視就會捲到一個不存在的節點，所以這裡先展開再捲。
   */
  const jumpToField = (fieldId: string) => {
    const field = getSettingsField(fieldId)
    if (!field) return
    setSection(field.section)
    if (field.tier === 'advanced' && !showAdvanced) setShowAdvanced(true)
    setHighlightId(fieldId)
  }

  // 目前這一節因為切回基礎檢視而被收起時，退回第一個仍看得見的節，
  // 否則畫面會停在一個導覽列上已經不存在的節。
  useEffect(() => {
    if (navSections.some((item) => item.id === section)) return
    setSection(navSections[0]?.id || 'general')
  }, [navSections, section])

  // 切節／展開後 DOM 才存在，等這一輪 render 完成再捲。
  useEffect(() => {
    if (!highlightId) return
    const node = document.getElementById(fieldAnchorId(highlightId))
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setHighlightId(null), 2_400)
    return () => window.clearTimeout(timer)
  }, [highlightId, section, showAdvanced])

  // ?section=&field= 深連結：橫幅 CTA／palette／文件都能連到指定欄位
  const requestedField = searchParams.get('field')
  useEffect(() => {
    if (requestedField && getSettingsField(requestedField)) jumpToField(requestedField)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedField])

  return (
    <ThemePage
      title="設定"
      sections={navSections}
      groups={SETTINGS_SECTION_GROUPS}
      activeId={section}
      onChange={setSection}
      hideNavTitle
    >
      <div className="flex flex-col max-w-[820px] pb-10">
        <SettingsHeader title={meta.title} subtitle={meta.subtitle} />

        <div className="mb-4">
          <SettingsSearch
            policyAdminBuild={isPolicyAdminBuild}
            onJump={(hit) => jumpToField(hit.field.id)}
          />
        </div>

        <div className="mb-5 flex items-center justify-between gap-3 border-b border-line pb-3">
          <p className="text-[11px] leading-relaxed text-outline">
            {showAdvanced
              ? '進階檢視：工程參數與少用開關都在。'
              : '基礎檢視：只顯示常用設定；進階參數仍在，值不受影響。'}
          </p>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] font-medium text-on-surface">
            顯示進階
            <SettingsToggle checked={showAdvanced} onChange={setShowAdvanced} />
          </label>
        </div>

        {section === 'piCore' && <PiCoreSettingsSection />}

        {section === 'general' && (
          <GeneralPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
            appVersion={updateState?.currentVersion}
          />
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
          <AppearancePanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'personalization' && (
          <PersonalizationPanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'memory' && (
          <MemoryPanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'data' && (
          <DataControlsPanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'shortcuts' && (
          <ShortcutsPanel settings={settings} fieldCtx={fieldCtx} />
        )}

        {section === 'git' && (
          <>
            <SettingsGroup title="分支與推送">
              <SettingsField
                id="git.gitBranchPrefix"
                ctx={fieldCtx}
                control={
                  <input
                    className={settingsInputCls + ' w-40 text-right'}
                    value={settings.gitBranchPrefix || ''}
                    onChange={(e) => set({ gitBranchPrefix: e.target.value })}
                    placeholder="agent/"
                  />
                }
              />
              <SettingsField
                id="git.gitCreateDraftPr"
                ctx={fieldCtx}
                control={
                  <SettingsToggle
                    checked={settings.gitCreateDraftPr !== false}
                    onChange={(v) => set({ gitCreateDraftPr: v })}
                  />
                }
              />
              <SettingsField
                id="git.gitForcePush"
                ctx={fieldCtx}
                control={
                  <SettingsToggle
                    checked={settings.gitForcePush === true}
                    onChange={(v) => set({ gitForcePush: v })}
                  />
                }
              />
            </SettingsGroup>
            <SettingsGroup title="指引（注入提示）">
              <SettingsField id="git.gitCommitInstructions" ctx={fieldCtx}>
                <textarea
                  className={settingsInputCls + ' min-h-[72px] resize-y'}
                  value={settings.gitCommitInstructions || ''}
                  onChange={(e) =>
                    set({ gitCommitInstructions: e.target.value })
                  }
                  placeholder="例如：conventional commits、中文摘要…"
                />
              </SettingsField>
              <SettingsField id="git.gitPrInstructions" ctx={fieldCtx}>
                <textarea
                  className={settingsInputCls + ' min-h-[72px] resize-y'}
                  value={settings.gitPrInstructions || ''}
                  onChange={(e) => set({ gitPrInstructions: e.target.value })}
                  placeholder="例如：標題簡短、描述含測試計畫…"
                />
              </SettingsField>
            </SettingsGroup>
          </>
        )}

        {section === 'llm' && (
          <LlmPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
            testConnection={testConnection}
          />
        )}

        {section === 'cli' && (
          <CliPanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'opencode' && (
          <OpenCodePanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'roles' && (
          <RolesPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
            outboundStatus={outboundStatus}
            onNavigateSection={setSection}
          />
        )}

        {section === 'policyAdmin' && (
          <PolicyAdminSection isPolicyAdminBuild={isPolicyAdminBuild} />
        )}

        {section === 'safety' && (
          <SafetyPanel settings={settings} set={set} fieldCtx={fieldCtx} />
        )}

        {section === 'webhook' && (
          <>
            <SettingsGroup title="本機 Webhook">
              <SettingsField
                id="webhook.webhookEnabled"
                ctx={fieldCtx}
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
              <SettingsField
                id="webhook.webhookPort"
                ctx={fieldCtx}
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
              <SettingsField id="webhook.webhookToken" ctx={fieldCtx}>
                <input
                  type="password"
                  className={settingsInputCls}
                  value={settings.webhookToken || ''}
                  onChange={(e) => set({ webhookToken: e.target.value })}
                  autoComplete="off"
                />
              </SettingsField>
              <SettingsField id="webhook.webhookTarget" ctx={fieldCtx}>
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
              </SettingsField>
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
              <SettingsField
                id="gateway.telegramEnabled"
                ctx={fieldCtx}
                control={
                  <SettingsToggle
                    checked={settings.telegramEnabled === true}
                    onChange={(v) => set({ telegramEnabled: v })}
                  />
                }
              />
              <SettingsField id="gateway.telegramBotToken" ctx={fieldCtx}>
                <input
                  className={settingsInputCls}
                  type="password"
                  value={settings.telegramBotToken || ''}
                  onChange={(e) => set({ telegramBotToken: e.target.value })}
                  placeholder="123456:ABC-DEF..."
                />
              </SettingsField>
              <SettingsField id="gateway.telegramAllowedChatIds" ctx={fieldCtx} description="逗號分隔，空白＝全部">
                <input
                  className={settingsInputCls}
                  value={settings.telegramAllowedChatIds || ''}
                  onChange={(e) =>
                    set({ telegramAllowedChatIds: e.target.value })
                  }
                  placeholder="例如 123456789"
                />
              </SettingsField>
              <SettingsField
                id="gateway.telegramAutoRun"
                ctx={fieldCtx}
                control={
                  <SettingsToggle
                    checked={settings.telegramAutoRun !== false}
                    onChange={(v) => set({ telegramAutoRun: v })}
                  />
                }
              />
              <SettingsField
                id="gateway.telegramReplyWithResult"
                ctx={fieldCtx}
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

