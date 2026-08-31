import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { useSettingsStore } from '../../store/settingsStore'
import {
  PillSelect,
  SettingsGroup,
  SettingsRow,
  SettingsStack,
  SettingsToggle,
  settingsBtnCls,
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

type PiPackageView = {
  source: string
  scope: 'user'
  filtered: boolean
  installed: boolean
  name?: string
  version?: string
  resourceTypesKnown: boolean
  resources: Array<{ kind: 'extensions' | 'skills' | 'prompts' | 'themes'; total: number; enabled: number }>
  diagnostics: Array<{ code: string; message: string }>
}

type PiPackageLoadStatus = 'loading' | 'ready' | 'unavailable' | 'error'

const PACKAGE_RESOURCE_LABELS: Record<PiPackageView['resources'][number]['kind'], string> = {
  extensions: 'Extensions',
  skills: 'Skills',
  prompts: 'Prompts',
  themes: 'Themes',
}

function piPackageResourcesLabel(item: PiPackageView): string {
  if (!item.resourceTypesKnown) return '資源未知'
  if (item.resources.length === 0) return '未發現 Pi resources'
  return item.resources.map((resource) => `${PACKAGE_RESOURCE_LABELS[resource.kind]} ${resource.enabled}/${resource.total}`).join(' · ')
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
  const [packages, setPackages] = useState<PiPackageView[]>([])
  const [packageStatus, setPackageStatus] = useState<PiPackageLoadStatus>('loading')
  const [packageMessage, setPackageMessage] = useState('')
  const [packageSource, setPackageSource] = useState('')
  const [packageMutating, setPackageMutating] = useState(false)
  const [packageOperationMessage, setPackageOperationMessage] = useState('')
  const [configStatus, setConfigStatus] = useState<PiConfigStatus | undefined>()

  const refreshPackages = useCallback(async (showLoading = true) => {
    const listPackages = window.subagents?.piHost?.packages?.list
    if (!listPackages) {
      setPackageStatus('unavailable')
      return
    }
    if (showLoading) setPackageStatus('loading')
    try {
      const result = await listPackages()
      setPackages(result.packages || [])
      setPackageMessage(result.diagnostics?.[0]?.message || '')
      setPackageStatus('ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : '無法讀取 Pi Packages'
      setPackageMessage(message)
      setPackageStatus(/unknown|unsupported|protocol|not running/i.test(message) ? 'unavailable' : 'error')
    }
  }, [])

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
    void refreshPackages()
    return () => { active = false }
  }, [refreshPackages, syncPiHostSettings])

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

  const installPackage = async () => {
    const source = packageSource.trim()
    const install = window.subagents?.piHost?.packages?.install
    if (!source || !install) return
    const confirmed = window.confirm(
      `確定安裝 ${source}？\n\n此 package、npm lifecycle scripts 與 extensions 不是 sandbox，可能取得完整 filesystem、process、network、environment 與 credentials 權限。`,
    )
    if (!confirmed) return
    setPackageMutating(true)
    setPackageOperationMessage('安裝中…')
    try {
      const result = await install({ source, trusted: true })
      setPackages(result.packages || [])
      setPackageMessage(result.diagnostics?.[0]?.message || '')
      setPackageStatus('ready')
      setPackageSource('')
      setPackageOperationMessage(`已安裝 ${result.mutation?.source || source}；下一輪 Pi run 會載入新 state`)
    } catch (error) {
      setPackageOperationMessage(error instanceof Error ? `安裝失敗：${error.message}` : '安裝失敗')
      await refreshPackages(false)
    } finally {
      setPackageMutating(false)
    }
  }

  const removePackage = async (source: string) => {
    const remove = window.subagents?.piHost?.packages?.remove
    if (!remove) return
    const confirmed = window.confirm(`確定移除 ${source}？npm uninstall lifecycle scripts 也可能以完整本機權限執行。`)
    if (!confirmed) return
    setPackageMutating(true)
    setPackageOperationMessage('移除中…')
    try {
      const result = await remove({ source })
      setPackages(result.packages || [])
      setPackageMessage(result.diagnostics?.[0]?.message || '')
      setPackageStatus('ready')
      setPackageOperationMessage(`已移除 ${result.mutation?.source || source}；下一輪 Pi run 會載入新 state`)
    } catch (error) {
      setPackageOperationMessage(error instanceof Error ? `移除失敗：${error.message}` : '移除失敗')
      await refreshPackages(false)
    } finally {
      setPackageMutating(false)
    }
  }

  const mcpExtensions = extensions.filter((extension) => extension.kind === 'mcp')
  const packageMutationAvailable = Boolean(window.subagents?.piHost?.packages?.install && window.subagents?.piHost?.packages?.remove)

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
      <SettingsGroup title="Pi Packages" action={<span className="text-[11px] text-outline">Pi Host 真實狀態</span>}>
        <SettingsStack
          title="安裝 pinned npm package"
          description="只接受 npm:<name>@<exact-version>，安裝於 user scope；不提供 update、git、URL 或 local path。"
        >
          <div role="note" className="text-[11px] leading-relaxed text-danger">
            完整信任：Package、npm lifecycle scripts 與 extensions 不是 sandbox，可能存取 filesystem、process、network、environment 與 credentials。
          </div>
          <div className="flex items-center gap-2">
            <input
              className={settingsInputCls}
              value={packageSource}
              disabled={packageMutating || !packageMutationAvailable}
              placeholder="npm:@scope/package@1.2.3"
              onChange={(event) => setPackageSource(event.target.value)}
            />
            <button
              type="button"
              className={settingsBtnPrimaryCls}
              disabled={packageMutating || !packageMutationAvailable || !packageSource.trim()}
              onClick={() => void installPackage()}
            >
              {packageMutating ? '處理中…' : '確認並安裝'}
            </button>
          </div>
          {!packageMutationAvailable && packageStatus !== 'loading' && <span className="text-[11px] text-outline">目前 Pi Host 僅支援唯讀 package inventory</span>}
          {packageOperationMessage && <span role="status" className="text-[11px] text-outline">{packageOperationMessage}</span>}
        </SettingsStack>
        {packageStatus === 'loading' && <span className="text-[11px] text-outline">載入中…</span>}
        {packageStatus === 'unavailable' && <span className="text-[11px] text-outline">目前 Pi Host 不支援 Packages{packageMessage ? ` · ${packageMessage}` : ''}</span>}
        {packageStatus === 'error' && <span role="status" className="text-[11px] text-danger">無法讀取 Pi Packages{packageMessage ? ` · ${packageMessage}` : ''}</span>}
        {packageStatus === 'ready' && packages.length === 0 && <span className="text-[11px] text-outline">尚未設定 Pi Package{packageMessage ? ` · ${packageMessage}` : ''}</span>}
        {packageStatus === 'ready' && packages.map((item) => (
          <SettingsRow
            key={`${item.scope}:${item.source}`}
            title={`${item.name || item.source} · ${item.version || '版本未知'}`}
            description={`${item.source} · ${item.installed ? '已安裝' : '設定存在，檔案缺失'} · ${piPackageResourcesLabel(item)}${item.filtered ? ' · 已套用 resource filters' : ''}${item.diagnostics[0]?.message ? ` · ${item.diagnostics[0].message}` : ''}`}
            control={packageMutationAvailable ? (
              <button
                type="button"
                className={settingsBtnCls}
                disabled={packageMutating}
                onClick={() => void removePackage(item.source)}
              >
                移除
              </button>
            ) : <span className="text-[11px] text-outline">User scope</span>}
          />
        ))}
        {packageStatus === 'ready' && packages.length > 0 && packageMessage && <span role="status" className="text-[11px] text-outline">{packageMessage}</span>}
      </SettingsGroup>
      <SettingsGroup title="MCP Extensions" action={<span className="text-[11px] text-outline">由 Pi Host 管理</span>}>
        {mcpExtensions.length === 0 ? <span className="text-[11px] text-outline">尚未安裝 MCP extension</span> : mcpExtensions.map((extension) => (
          <SettingsRow
            key={extension.id}
            title={`${extension.name} · ${extension.version}`}
            description={`MCP · ${extension.trusted ? '已信任來源' : '未信任來源'}${extension.credentialRefs.length ? ` · ${extension.credentialRefs.length} 個 credential reference` : ''}`}
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
