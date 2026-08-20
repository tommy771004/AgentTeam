import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { useSettingsStore } from '../../store/settingsStore'
import {
  PillSelect,
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  SettingsToggle,
  settingsBtnPrimaryCls,
  settingsInputCls,
} from './SettingsChrome'

type PiSettings = {
  provider: string
  model: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  activeTools: string[]
  compaction: 'auto' | 'manual'
  approvalMode: 'always' | 'auto' | 'full'
  bashRequireAsk: boolean
  unattended: boolean
}

type PiConfigStatus = {
  settingsSource: 'native' | 'managed' | 'default'
  settingsLoaded: boolean
  oauthSources: Array<'codex-cli' | 'claude-cli'>
  oauthImportedProviders: string[]
  oauthSkippedProviders: string[]
  oauthConflicts: string[]
}

type PiExtensionView = {
  id: string
  name: string
  version: string
  kind: 'package' | 'mcp'
  enabled: boolean
  trusted: boolean
  tools: string[]
  credentialRefs: string[]
}

const TOOLS = [
  ['read', '讀取檔案'],
  ['write', '寫入檔案'],
  ['edit', '編輯檔案'],
  ['bash', '執行 Bash'],
  ['grep', '搜尋內容'],
  ['find', '尋找檔案'],
  ['ls', '列出目錄'],
] as const

function piSourceLabel(source: 'codex-cli' | 'claude-cli'): string {
  return source === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'
}

function piOAuthStatus(config: PiConfigStatus): string {
  const sources = config.oauthSources.map(piSourceLabel).join('、')
  if (config.oauthImportedProviders.length) return `已套用 ${sources || 'CLI'} OAuth`
  if (config.oauthSkippedProviders.length) return '已保留 Pi 目前 OAuth'
  if (config.oauthConflicts.length) return 'CLI OAuth 帳號不同，未覆蓋'
  return sources ? `已偵測 ${sources}，未變更` : '未偵測到 CLI OAuth'
}

function piSettingsSourceStatus(config?: PiConfigStatus): string {
  if (!config) return '由 Pi Core 管理'
  if (config.settingsSource === 'managed') return '使用 App 儲存的覆寫'
  if (config.settingsLoaded) return '已載入 ~/.pi/agent/settings.json'
  return '使用 Pi 預設值'
}

export function PiCoreSettingsSection() {
  const syncPiHostSettings = useSettingsStore((state) => state.syncPiHostSettings)
  const [draft, setDraft] = useState<PiSettings>({ provider: '', model: '', thinkingLevel: 'medium', activeTools: [], compaction: 'auto', approvalMode: 'auto', bashRequireAsk: true, unattended: false })
  const [status, setStatus] = useState('載入中…')
  const [saving, setSaving] = useState(false)
  const [extensions, setExtensions] = useState<PiExtensionView[]>([])
  const [configStatus, setConfigStatus] = useState<PiConfigStatus | undefined>()

  useEffect(() => {
    let active = true
    void window.subagents?.piHost?.settings?.get?.().then((result) => {
      if (!active || !result?.settings) return
      setDraft(result.settings)
      syncPiHostSettings(result.settings)
      setConfigStatus(result.config)
      setStatus(result.config?.oauthImportedProviders.length ? '已載入 Pi 設定檔，並套用 CLI OAuth' : '已從 Pi Core 載入')
    }).catch((error: unknown) => {
      if (active) setStatus(error instanceof Error ? error.message : '無法載入 Pi 設定')
    })
    void window.subagents?.piHost?.extensions?.list?.().then((result) => {
      if (active) setExtensions((result.extensions || []) as PiExtensionView[])
    }).catch(() => { /* extensions are optional in older Hosts */ })
    return () => { active = false }
  }, [syncPiHostSettings])

  const toggleTool = (tool: string) => {
    setDraft((current) => ({
      ...current,
      activeTools: current.activeTools.includes(tool)
        ? current.activeTools.filter((item) => item !== tool)
        : [...current.activeTools, tool].sort(),
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await window.subagents?.piHost?.settings?.update?.(draft)
      if (result?.settings) {
        setDraft(result.settings)
        syncPiHostSettings(result.settings)
      }
      if (result?.config) setConfigStatus(result.config)
      setStatus('已儲存；下一輪代理執行會套用新設定')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <SettingsGroup title="Pi Agent">
        <SettingsStack title="Provider" description="選擇 Pi Agent 使用的供應商連線。">
          <input
            className={settingsInputCls}
            value={draft.provider}
            placeholder="沿用預設供應商"
            onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value }))}
          />
        </SettingsStack>
        <SettingsStack title="模型" description="Pi Core 的預設模型；角色或任務覆寫會在每輪開始時套用。">
          <input
            className={settingsInputCls}
            value={draft.model}
            placeholder="沿用供應商預設模型"
            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
          />
        </SettingsStack>
        <SettingsRow
          title="Thinking level"
          description="控制 Pi Agent 的推理深度。"
          control={
            <PillSelect value={draft.thinkingLevel} onChange={(value) => setDraft((current) => ({ ...current, thinkingLevel: value as PiSettings['thinkingLevel'] }))}>
              <option value="off">關閉</option>
              <option value="minimal">極低</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="xhigh">極高</option>
              <option value="max">最大</option>
            </PillSelect>
          }
        />
        <SettingsRow
          title="Compaction"
          description="由 Pi Core 自行壓縮長對話，或保留手動控制。"
          control={<PillSelect value={draft.compaction} onChange={(value) => setDraft((current) => ({ ...current, compaction: value as PiSettings['compaction'] }))}><option value="auto">自動</option><option value="manual">手動</option></PillSelect>}
        />
        <SettingsRow
          title="核准模式"
          description="沿用主程式安全政策；完整存取權仍會在 unattended 執行時要求明確核准。"
          control={<PillSelect value={draft.approvalMode} onChange={(value) => setDraft((current) => ({ ...current, approvalMode: value as PiSettings['approvalMode'] }))}><option value="always">要求核准</option><option value="auto">自動（副作用仍需核准）</option><option value="full">完整存取權</option></PillSelect>}
        />
        <SettingsRow
          title="Unattended"
          description="排程或背景執行；沒有明確核准時拒絕副作用工具。"
          control={<SettingsToggle checked={draft.unattended} onChange={() => setDraft((current) => ({ ...current, unattended: !current.unattended }))} />}
        />
        <SettingsRow
          title="Bash 分段安全檢查"
          description="逐段檢查鏈式命令；危險、子 shell 與未涵蓋命令一律要求核准。"
          control={<SettingsToggle checked={draft.bashRequireAsk} onChange={() => setDraft((current) => ({ ...current, bashRequireAsk: !current.bashRequireAsk }))} />}
        />
      </SettingsGroup>
      <SettingsGroup title="設定來源">
        <SettingsRow
          title="Pi 設定檔"
          description="Pi Host 啟動時自動讀取使用者的 Pi 設定；儲存後可由 App 覆寫。"
          control={<span className="text-[11px] text-outline">{piSettingsSourceStatus(configStatus)}</span>}
        />
        <SettingsRow
          title="CLI OAuth"
          description="OAuth 只在 Electron 主程序同步到 Pi auth.json，Renderer 不會接觸 token。"
          control={<span className="text-[11px] text-outline">{configStatus ? piOAuthStatus(configStatus) : '載入中…'}</span>}
        />
      </SettingsGroup>
      <SettingsGroup title="可用工具" action={<span className="text-[11px] text-outline">明確選取，不需編輯 JSON</span>}>
        {TOOLS.map(([id, label]) => (
          <SettingsRow
            key={id}
            title={label}
            description={id}
            control={<SettingsToggle checked={draft.activeTools.includes(id)} onChange={() => toggleTool(id)} />}
          />
        ))}
      </SettingsGroup>
      <SettingsGroup title="Pi Extensions / MCP" action={<span className="text-[11px] text-outline">由 Pi Host 管理</span>}>
        {extensions.length === 0 ? <span className="text-[11px] text-outline">尚未安裝 Pi package 或 MCP extension</span> : extensions.map((extension) => (
          <SettingsRow
            key={extension.id}
            title={`${extension.name} · ${extension.version}`}
            description={`${extension.kind === 'mcp' ? 'MCP' : 'Package'} · ${extension.trusted ? '已信任來源' : '未信任來源'}${extension.credentialRefs.length ? ` · ${extension.credentialRefs.length} 個 credential reference` : ''}`}
            control={<SettingsToggle checked={extension.enabled} onChange={() => {
              void window.subagents?.piHost?.extensions?.setEnabled?.(extension.id, !extension.enabled).then((result) => {
                if (result.extension) setExtensions((current) => current.map((item) => item.id === extension.id ? result.extension as PiExtensionView : item))
              })
            }} />}
          />
        ))}
      </SettingsGroup>
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="text-[11px] text-outline flex items-center gap-1.5"><Icon name="info" size={14} />{status}</span>
        <button type="button" className={settingsBtnPrimaryCls} disabled={saving} onClick={() => void save()}>
          {saving ? '儲存中…' : '儲存 Pi 設定'}
        </button>
      </div>
    </div>
  )
}
