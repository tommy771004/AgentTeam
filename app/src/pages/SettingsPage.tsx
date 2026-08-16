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
import { BundlePanel } from '../components/settings/panels/BundlePanel'
import { GatewayPanel } from '../components/settings/panels/GatewayPanel'
import { GitPanel } from '../components/settings/panels/GitPanel'
import { McpPanel } from '../components/settings/panels/McpPanel'
import { OAuthPanel } from '../components/settings/panels/OAuthPanel'
import { SafetyPanel } from '../components/settings/panels/SafetyPanel'
import { UpdatesPanel, type UpdateState } from '../components/settings/panels/UpdatesPanel'
import { WebhookPanel } from '../components/settings/panels/WebhookPanel'
import { MemoryPanel } from '../components/settings/panels/MemoryPanel'
import { ShortcutsPanel } from '../components/settings/panels/ShortcutsPanel'
import {
  type SettingsFieldContext,
} from '../components/settings/SettingsField'
import { SettingsSearch } from '../components/settings/SettingsSearch'
import { fieldAnchorId, getSettingsField, sectionHasVisibleFields } from '../settings/fieldRegistry'
import { useSettingsUiStore } from '../store/settingsUiStore'


import { ThemePage } from '../components/SectionNav'
import {
  SettingsHeader,
  type OutboundStatus,
  SettingsToggle,
} from '../components/settings/SettingsChrome'
import { PolicyAdminSection } from '../components/settings/PolicyAdminSection'
import { PiCoreSettingsSection } from '../components/settings/PiCoreSettingsSection'
import { useSettingsStore } from '../store/settingsStore'
import { useLearningStore } from '../store/learningStore'
import { useOpenCodeConfigStore } from '../store/opencodeConfigStore'
import { useProjectStore } from '../store/projectStore'
import { applyRendererStorageSnapshot } from '../agent/updateMigration'

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
  // G9 persona 疊層新增表單
  const projectRoot = useProjectStore((s) => s.root)
  const oc = useOpenCodeConfigStore()
  const loadLearning = useLearningStore((s) => s.load)
  const [outboundStatus, setOutboundStatus] = useState<OutboundStatus | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)
  // Recompute secret key list when plugins change

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
  /**
   * 為了讓跳轉能看到進階欄位而「暫時」展開。
   *
   * 這一份刻意不寫進偏好：搜尋跳到一個進階欄位不代表你想從此改用進階檢視，
   * 把它存起來會讓一次搜尋永久翻掉記住的檢視模式。
   */
  const [revealAdvancedForJump, setRevealAdvancedForJump] = useState(false)
  const isPolicyAdminBuild =
    outboundStatus?.buildFlavor === 'policy-admin' ||
    (typeof process !== 'undefined' &&
      (process as { env?: Record<string, string | undefined> }).env?.SUBAGENTS_BUILD_FLAVOR ===
        'policy-admin')
  const effectiveShowAdvanced = showAdvanced || revealAdvancedForJump
  const navSections = useMemo(() => {
    const byBuild = isPolicyAdminBuild
      ? SETTINGS_SECTIONS
      : SETTINGS_SECTIONS.filter((s) => s.id !== 'policyAdmin')
    // 整節都是進階的節（例如角色模型）在基礎檢視直接收起來——留一個點進去
    // 空白的節名比藏起來更糟。
    return byBuild.filter((s) =>
      sectionHasVisibleFields(s.id, {
        showAdvanced: effectiveShowAdvanced,
        policyAdminBuild: isPolicyAdminBuild,
      }),
    )
  }, [isPolicyAdminBuild, effectiveShowAdvanced])
  const fieldCtx: SettingsFieldContext = {
    showAdvanced: effectiveShowAdvanced,
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
    // 暫時展開即可——不動使用者記住的檢視模式
    if (field.tier === 'advanced' && !showAdvanced) setRevealAdvancedForJump(true)
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
  }, [highlightId, section, effectiveShowAdvanced])

  // 使用者自己打開進階、或離開這一節之後，暫時展開就沒有存在的理由了。
  useEffect(() => {
    if (showAdvanced) setRevealAdvancedForJump(false)
  }, [showAdvanced])

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
          <UpdatesPanel
            updateState={updateState}
            updateMsg={updateMsg}
            updateProgress={updateProgress}
            checkForUpdate={checkForUpdate}
            downloadCurrentUpdate={downloadCurrentUpdate}
            installCurrentUpdate={installCurrentUpdate}
            deferCurrentUpdate={deferCurrentUpdate}
            rollbackCurrentUpdate={rollbackCurrentUpdate}
          />
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
          <ShortcutsPanel settings={settings} />
        )}

        {section === 'git' && (
          <GitPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
          />
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
          <OpenCodePanel settings={settings} set={set} />
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
          <WebhookPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
          />
        )}

        {section === 'gateway' && (
          <GatewayPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
          />
        )}

        {section === 'mcp' && (
          <McpPanel
            settings={settings}
            set={set}
            fieldCtx={fieldCtx}
          />
        )}

        {section === 'oauth' && (
          <OAuthPanel
            settings={settings}
            set={set}
          />
        )}

        {section === 'bundle' && (
          <BundlePanel
            exportBundle={exportBundle}
            importBundle={importBundle}
          />
        )}
        <p className="text-[11px] text-outline px-1 mt-2">變更會立即套用，無需儲存。</p>
      </div>
    </ThemePage>
  )
}

