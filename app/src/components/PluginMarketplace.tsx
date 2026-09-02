import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { PluginBrandTile } from './PluginBrandIcon'
import { useLearningStore } from '../store/learningStore'
import { useProjectStore } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import type { PluginCatalogCategory, PluginCatalogItem } from '../agent/hermes/pluginCatalog'
import { oauthProviderForPlugin } from '../agent/hermes/pluginOAuth'
import {
  installKindUserLabel,
  softTipUserFacing,
} from '../lib/capabilityStatus'

async function openExternal(url: string) {
  if (window.subagents?.shell?.openExternal) {
    await window.subagents.shell.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

const CATEGORIES: Array<'All' | PluginCatalogCategory> = [
  'All',
  'Featured',
  'Productivity',
  'Creativity',
]

const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  All: '全部',
  Featured: 'Featured',
  Productivity: 'Productivity',
  Creativity: 'Creativity',
}

/** Featured 列預設可見列數（兩欄 × 3 列）；其餘以「查看…」展開 */
const COLLAPSED_PER_CATEGORY = 6

function healthStatus(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.status || record.state || (record.ok === true ? 'ready' : ''))
  }
  return ''
}

function errorMessage(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.message || record.error || '')
  }
  return String(value)
}

export function PluginMarketplace() {
  const {
    catalog,
    plugins,
    installingPluginId,
    pluginHealth,
    pluginError,
    installPlugin,
    checkPlugin,
    setPluginEnabled,
    removePlugin,
    importPlugin,
    authorizePlugin,
    clearPluginAuth,
    runPluginOAuth,
  } = useLearningStore()
  const projectRoot = useProjectStore((state) => state.root)
  const pluginOAuthClients = useSettingsStore((s) => s.settings.pluginOAuthClients)
  const [scope, setScope] = useState<'public' | 'personal'>('public')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')
  /** simple = task-first (hide advanced packs); all = full catalog */
  const [catalogMode, setCatalogMode] = useState<'simple' | 'all'>('simple')
  const [query, setQuery] = useState('')
  const [managedId, setManagedId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [pluginJson, setPluginJson] = useState('')
  const [importError, setImportError] = useState('')

  const installedPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.id !== 'example-edge'),
    [plugins],
  )
  const installedById = useMemo(
    () => new Map(installedPlugins.map((plugin) => [plugin.id, plugin])),
    [installedPlugins],
  )

  const visibleCatalog = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return catalog.filter((item) => {
      if (scope === 'personal' && !installedById.has(item.id)) return false
      if (category !== 'All' && item.category !== category) return false
      // Task-first: hide advanced tool packs that only wrap another connector
      if (
        catalogMode === 'simple' &&
        scope === 'public' &&
        item.installKind === 'npm-mcp' &&
        (item.dependsOnPluginId || item.npm?.secretPluginId) &&
        item.id !== 'filesystem-mcp'
      ) {
        return false
      }
      if (!normalized) return true
      return [item.name, item.description, item.category, ...(item.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    })
  }, [catalog, catalogMode, category, installedById, query, scope])

  const uncataloguedPlugins = useMemo(() => {
    if (scope !== 'personal') return []
    const normalized = query.trim().toLowerCase()
    return installedPlugins.filter((plugin) => {
      if (catalog.some((item) => item.id === plugin.id)) return false
      if (category !== 'All') return false
      return !normalized || `${plugin.name} ${plugin.description || ''}`.toLowerCase().includes(normalized)
    })
  }, [catalog, category, installedPlugins, query, scope])

  const installedCatalog = catalog.filter((item) => installedById.has(item.id))
  const storeError = errorMessage(pluginError)
  const hasPluginInstaller = Boolean(window.subagents?.plugins?.install)
  const canUseProjectRoot = Boolean(projectRoot)

  const handleImport = async () => {
    setImportError('')
    try {
      const manifest = JSON.parse(pluginJson) as { id?: string; name?: string }
      if (!manifest.id || !manifest.name) throw new Error('能力 JSON 需要 id 與 name。')
      await importPlugin(manifest as Parameters<typeof importPlugin>[0])
      setPluginJson('')
      setScope('personal')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="w-full pb-16">
      {/* Title + search — Codex-like centered column rhythm */}
      <header className="mb-7">
        <h1 className="font-[family-name:var(--font-sora)] text-[28px] leading-tight font-semibold tracking-tight text-on-surface">
          擴充能力
        </h1>
        <p className="mt-1.5 break-words text-[13px] leading-relaxed text-on-surface-variant/85">
          連接服務後，就能在新任務直接使用。
        </p>
      </header>

      {(storeError || importError) && (
        <div className="mb-4 rounded-xl border border-error/25 bg-error/10 px-4 py-3 text-sm text-error flex gap-2">
          <Icon name="error" size={18} />
          <span>{importError || storeError}</span>
        </div>
      )}

      <div className="relative mb-8">
        <Icon
          name="search"
          size={18}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-outline/75 pointer-events-none"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋能力（GitHub、Notion…）"
          className="w-full h-10 rounded-control border border-line bg-surface-container-high/60 pl-10 pr-4 text-[13px] text-on-surface placeholder:text-outline/65 outline-none transition-colors focus:border-line-strong focus:bg-surface-container-high/80"
        />
      </div>

      {/* 已安裝 — title + gear, icon strip, no count subtitle */}
      <div className="mb-7 pb-5 border-b border-white/[0.07]">
        <div className="flex items-center justify-between gap-3 mb-3.5">
          <h2 className="text-[13px] font-semibold text-on-surface">已安裝</h2>
          <button
            type="button"
            onClick={() => setScope('personal')}
            title="管理已安裝能力"
            className="flex size-8 items-center justify-center rounded-lg bg-transparent text-outline transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          >
            <Icon name="settings" size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-0.5 min-h-9">
          {installedPlugins.length === 0 && (
            <span className="text-[12px] text-outline/70 py-1.5">尚未安裝 — 下方列表可一鍵安裝</span>
          )}
          {installedCatalog.map((item) => (
            <PluginBrandTile
              key={item.id}
              pluginId={item.id}
              name={item.name}
              accent={item.accent}
              brandIcon={item.brandIcon}
              size={36}
              title={`${item.name} — 管理`}
              onClick={() => {
                setScope('personal')
                setQuery('')
                setCategory('All')
                setManagedId(item.id)
              }}
            />
          ))}
          {installedPlugins
            .filter((plugin) => !catalog.some((item) => item.id === plugin.id))
            .map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                title={plugin.name}
                onClick={() => {
                  setScope('personal')
                  setQuery(plugin.name)
                }}
                className="w-9 h-9 flex items-center justify-center shrink-0 text-secondary"
              >
                <Icon name="deployed_code" size={18} />
              </button>
            ))}
        </div>
      </div>

      {/* 公開 / 個人 + filter icon (category menu) */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-0.5" role="group" aria-label="擴充來源">
            {(['public', 'personal'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`min-w-[3.75rem] rounded-control px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  scope === value
                    ? 'bg-hover text-on-surface'
                    : 'text-outline hover:bg-hover-2 hover:text-on-surface-variant'
                }`}
              >
                {value === 'public' ? '商店' : '我的'}
              </button>
            ))}
          </div>
          {scope === 'public' && (
            <div className="inline-flex gap-0.5" role="group" aria-label="擴充目錄模式">
              {(['simple', 'all'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={catalogMode === mode}
                  onClick={() => setCatalogMode(mode)}
                  className={`rounded-control px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    catalogMode === mode
                      ? 'bg-primary/15 text-primary'
                      : 'text-outline hover:bg-hover-2 hover:text-on-surface-variant'
                  }`}
                >
                  {mode === 'simple' ? '常用' : '全部（含進階）'}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            title="分類篩選"
            aria-expanded={filterOpen}
            aria-haspopup="menu"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              category !== 'All' || filterOpen
                ? 'text-on-surface bg-white/8'
                : 'text-outline hover:text-on-surface hover:bg-white/5'
            }`}
          >
            <Icon name="tune" size={18} />
          </button>
          {filterOpen && (
            <>
              <button
                type="button"
                aria-label="關閉篩選"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setFilterOpen(false)}
              />
              <div className="absolute right-0 top-9 z-20 min-w-[9.5rem] rounded-card border border-line bg-surface-container-high py-1 shadow-raised">
                {CATEGORIES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setCategory(value)
                      setFilterOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-[12px] font-medium transition-colors ${
                      category === value
                        ? 'text-primary bg-primary/10'
                        : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'
                    }`}
                  >
                    {CATEGORY_LABEL[value]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {CATEGORIES.filter((value): value is PluginCatalogCategory => value !== 'All')
          .filter((value) => category === 'All' || category === value)
          .map((value) => {
            const items = visibleCatalog.filter((item) => item.category === value)
            if (!items.length) return null
            const expanded = expandedCategories[value] || Boolean(query.trim())
            const visible = expanded ? items : items.slice(0, COLLAPSED_PER_CATEGORY)
            const hidden = items.length - visible.length
            const previewNames = items
              .slice(COLLAPSED_PER_CATEGORY, COLLAPSED_PER_CATEGORY + 2)
              .map((item) => item.name)

            return (
              <section key={value}>
                <h2 className="border-b border-white/[0.07] pb-2.5 mb-0.5 text-[13px] font-semibold text-on-surface">
                  {CATEGORY_LABEL[value]}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-8">
                  {visible.map((item) => (
                    <MarketplaceRow
                      key={item.id}
                      item={item}
                      installed={installedById.get(item.id)}
                      installing={installingPluginId === item.id}
                      health={pluginHealth[item.id]}
                      managed={managedId === item.id}
                      hasPluginInstaller={hasPluginInstaller}
                      canUseProjectRoot={canUseProjectRoot}
                      softTip={installSoftTip(item, installedById)}
                      onToggleManaged={() => setManagedId((id) => (id === item.id ? null : item.id))}
                      onInstall={() => {
                        void installPlugin(item.id, projectRoot || undefined).then(() => {
                          // 安裝後展開管理（連接器可立即授權）
                          setManagedId(item.id)
                        })
                      }}
                      onCheck={() => void checkPlugin(item.id)}
                      onEnabled={(enabled) => void setPluginEnabled(item.id, enabled)}
                      onRemove={() => void removePlugin(item.id)}
                      onAuthorize={(token) => void authorizePlugin(item.id, token)}
                      onClearAuth={() => void clearPluginAuth(item.id)}
                      onRunOAuth={() => {
                        const key = oauthProviderForPlugin(item.id)?.clientKey
                        return runPluginOAuth(item.id, key ? pluginOAuthClients?.[key] : undefined)
                      }}
                    />
                  ))}
                </div>
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedCategories((prev) => ({ ...prev, [value]: true }))}
                    className="mt-2 flex items-center gap-2 text-[12px] text-outline hover:text-on-surface-variant transition-colors py-1"
                  >
                    <span className="flex -space-x-1.5">
                      {items.slice(COLLAPSED_PER_CATEGORY, COLLAPSED_PER_CATEGORY + 3).map((item) => (
                        <PluginBrandTile
                          key={item.id}
                          pluginId={item.id}
                          name={item.name}
                          accent={item.accent}
                          brandIcon={item.brandIcon}
                          size={16}
                          iconSize={10}
                          className=""
                        />
                      ))}
                    </span>
                    <span>
                      {(() => {
                        const extra = Math.max(0, hidden - previewNames.length)
                        if (previewNames.length === 0) return `查看另外 ${hidden} 個`
                        if (extra > 0) return `查看 ${previewNames.join('、')} 以及另外 ${extra} 個`
                        return `查看 ${previewNames.join('、')}`
                      })()}
                    </span>
                  </button>
                )}
              </section>
            )
          })}

        {uncataloguedPlugins.map((plugin) => (
          <div key={plugin.id} className="border-b border-white/[0.06] py-4">
            <div className="flex gap-3 items-start">
              <div className="w-9 h-9 flex items-center justify-center shrink-0 text-secondary">
                <Icon name="deployed_code" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[13px] text-on-surface truncate">{plugin.name}</div>
                <p className="text-[12px] text-outline mt-0.5 line-clamp-2">{plugin.description || plugin.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setManagedId((id) => (id === plugin.id ? null : plugin.id))}
                className="w-8 h-8 rounded-lg text-outline hover:text-on-surface hover:bg-white/5 flex items-center justify-center"
              >
                <Icon name="more_horiz" size={20} />
              </button>
            </div>
            {managedId === plugin.id && (
              <div className="mt-3 pt-3 border-t border-white/[0.07] flex items-center justify-between gap-3 pl-12">
                <label className="text-xs text-on-surface-variant flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={(event) => void setPluginEnabled(plugin.id, event.target.checked)}
                    className="accent-primary"
                  />
                  啟用
                </label>
                <button type="button" onClick={() => void removePlugin(plugin.id)} className="text-xs font-semibold text-error">
                  移除
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {visibleCatalog.length === 0 && uncataloguedPlugins.length === 0 && (
        <div className="py-14 text-center rounded-2xl border border-dashed border-white/10 text-outline">
          <Icon name="extension_off" size={30} className="mx-auto mb-2 opacity-70" />
          <p className="text-sm">找不到符合條件的能力</p>
        </div>
      )}

      <div className="mt-10 border-t border-white/[0.07] pt-5">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex items-center gap-2 text-xs font-semibold text-outline hover:text-on-surface-variant"
        >
          <Icon name={advancedOpen ? 'expand_less' : 'expand_more'} size={18} />
          進階：匯入能力 JSON
        </button>
        {advancedOpen && (
          <div className="mt-3 rounded-2xl border border-white/8 bg-surface-container/30 p-4 space-y-3">
            <p className="text-xs text-outline">僅匯入你信任的 declarative manifest；能力仍受工具核准與隔離規則限制。</p>
            <textarea
              rows={8}
              value={pluginJson}
              onChange={(event) => setPluginJson(event.target.value)}
              placeholder='{"id":"my-plugin","name":"My Plugin","enabled":true,"skills":[]}'
              className="w-full rounded-xl border border-white/10 bg-surface p-3 text-xs font-[family-name:var(--font-mono)] text-on-surface-variant outline-none resize-y focus:border-primary/40"
            />
            <button
              type="button"
              disabled={!pluginJson.trim()}
              onClick={() => void handleImport()}
              className="rounded-lg bg-primary-container px-3 py-2 text-xs font-semibold text-on-primary-container disabled:opacity-40"
            >
              匯入並啟用
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function installBlockReason(
  item: PluginCatalogItem,
  hasPluginInstaller: boolean,
  canUseProjectRoot: boolean,
): string | null {
  if (item.installKind === 'npm-mcp') {
    if (!hasPluginInstaller) return '需使用桌面版安裝'
    if (item.npm?.requiresProjectRoot && !canUseProjectRoot) {
      return '請先選擇本機專案'
    }
  }
  return null
}

function installSoftTip(
  item: PluginCatalogItem,
  installedById: Map<string, { id: string; enabled: boolean; connectorAuth?: { hasCredential?: boolean } }>,
): string | null {
  const dep = item.dependsOnPluginId || item.npm?.secretPluginId
  if (!dep || item.installKind !== 'npm-mcp') return null
  const depName = dep.replace(/-connector$/, '').replace(/-/g, ' ')
  const depPlugin = installedById.get(dep)
  if (!depPlugin) {
    return softTipUserFacing(`可先安裝並授權「${depName}」連線；多數任務其實只靠連線即可，不必裝進階包`)
  }
  if (!depPlugin.connectorAuth?.hasCredential) {
    return softTipUserFacing(`請先完成「${depName}」授權，再使用此進階工具包`)
  }
  return null
}

function MarketplaceRow({
  item,
  installed,
  installing,
  health,
  managed,
  hasPluginInstaller,
  canUseProjectRoot,
  softTip,
  onToggleManaged,
  onInstall,
  onCheck,
  onEnabled,
  onRemove,
  onAuthorize,
  onClearAuth,
  onRunOAuth,
}: {
  item: PluginCatalogItem
  installed?: { id: string; enabled: boolean; connectorAuth?: { hasCredential?: boolean; accountHint?: string } }
  installing: boolean
  health: unknown
  managed: boolean
  hasPluginInstaller: boolean
  canUseProjectRoot: boolean
  softTip?: string | null
  onToggleManaged: () => void
  onInstall: () => void
  onCheck: () => void
  onEnabled: (enabled: boolean) => void
  onRemove: () => void
  onAuthorize: (token: string) => void
  onClearAuth: () => void
  onRunOAuth: () => Promise<{ ok: boolean; error?: string }>
}) {
  const [tokenDraft, setTokenDraft] = useState('')
  const [savingAuth, setSavingAuth] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthStatus, setOauthStatus] = useState<{
    phase?: string
    userCode?: string
    verificationUri?: string
    message?: string
  }>({})
  const status = healthStatus(health)
  const authorized =
    installed?.connectorAuth?.hasCredential === true || status === 'ready'
  const needsSetup = item.installKind === 'connector' && Boolean(installed) && !authorized
  const blockReason = installed ? null : installBlockReason(item, hasPluginInstaller, canUseProjectRoot)
  const installDisabled = installing || Boolean(blockReason)
  const auth = item.auth
  const oauthProvider = oauthProviderForPlugin(item.id)
  const hasElectronOAuth = Boolean(window.subagents?.oauth?.run)

  useEffect(() => {
    if (!managed || !oauthProvider) return
    const unsub = window.subagents?.oauth?.onStatus?.((payload) => {
      if (payload.pluginId !== item.id) return
      setOauthStatus({
        phase: payload.phase,
        userCode: payload.userCode,
        verificationUri: payload.verificationUri,
        message: payload.message || payload.error,
      })
    })
    return () => {
      unsub?.()
    }
  }, [managed, oauthProvider, item.id])

  const saveAuth = async () => {
    setSavingAuth(true)
    try {
      onAuthorize(tokenDraft)
      setTokenDraft('')
    } finally {
      setSavingAuth(false)
    }
  }

  const startOAuth = async () => {
    setOauthBusy(true)
    setOauthStatus({ phase: 'starting', message: '啟動 OAuth…' })
    try {
      const result = await onRunOAuth()
      if (!result.ok) {
        setOauthStatus({ phase: 'error', message: result.error })
      } else {
        setOauthStatus({ phase: 'done', message: '授權成功' })
      }
    } finally {
      setOauthBusy(false)
    }
  }

  return (
    <article className="min-w-0 border-b border-white/[0.06] px-1 py-3.5 transition-colors hover:bg-white/[0.02]">
      <div className="flex min-w-0 items-center gap-3">
        <PluginBrandTile
          pluginId={item.id}
          name={item.name}
          accent={item.accent}
          brandIcon={item.brandIcon}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-[13px] font-semibold text-on-surface truncate leading-snug">{item.name}</h3>
                {installed && needsSetup && (
                  <span className="shrink-0 rounded-full border border-secondary/30 bg-secondary/10 px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                    需設定
                  </span>
                )}
                {installed && !needsSetup && authorized && (
                  <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    已授權
                  </span>
                )}
                {installed && !needsSetup && installed.enabled && !authorized && (
                  <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    已啟用
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-1 break-words text-[12px] leading-snug text-outline">
                {item.description}
              </p>
            </div>
            {installed ? (
              <button
                type="button"
                onClick={onToggleManaged}
                title="管理能力"
                className="w-8 h-8 rounded-lg text-outline hover:text-on-surface hover:bg-white/5 flex items-center justify-center shrink-0"
              >
                <Icon name="more_horiz" size={20} />
              </button>
            ) : (
              <button
                type="button"
                disabled={installDisabled}
                onClick={onInstall}
                title={blockReason || '安裝能力'}
                className="rounded-full px-3 py-1 text-[12px] font-semibold shrink-0 disabled:opacity-45 bg-white/[0.08] text-on-surface hover:bg-white/[0.12] border border-white/[0.06] transition-colors"
              >
                {installing ? '安裝中…' : '安裝'}
              </button>
            )}
          </div>
          {!installed && blockReason && (
            <p className="mt-1 break-words text-[11px] text-outline/80">{blockReason}</p>
          )}
          {!blockReason && softTip && (
            <p className="mt-1 break-words text-[11px] text-secondary/90">{softTipUserFacing(softTip)}</p>
          )}
          {!installed && item.installKind === 'connector' && (
            <p className="mt-1 break-words text-[11px] text-outline/80">
              授權後即可在新任務使用。
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-outline/50">{installKindUserLabel(item.installKind)}</p>
        </div>
      </div>
      {managed && installed && (
        <div className="mt-3 pt-3 border-t border-white/[0.07] space-y-3 pl-12">
          <div className="flex flex-wrap items-center gap-3">
            <label className="mr-auto text-xs text-on-surface-variant flex items-center gap-2">
              <input
                type="checkbox"
                checked={installed.enabled}
                onChange={(event) => onEnabled(event.target.checked)}
                className="accent-primary"
                disabled={needsSetup && item.installKind === 'connector'}
                title={
                  needsSetup && item.installKind === 'connector'
                    ? '完成授權後才可啟用'
                    : undefined
                }
              />
              啟用
            </label>
            {needsSetup && (
              <span className="text-[11px] font-medium text-secondary">需設定</span>
            )}
            {authorized && installed.connectorAuth?.accountHint && (
              <span className="text-[11px] text-outline">token {installed.connectorAuth.accountHint}</span>
            )}
            <button type="button" onClick={onCheck} className="text-xs font-semibold text-primary hover:text-primary/80">
              檢查狀態
            </button>
            <button type="button" onClick={onRemove} className="text-xs font-semibold text-error hover:text-error/80">
              移除
            </button>
          </div>

          {item.installKind === 'connector' && (auth || oauthProvider) && (
            <div className="rounded-xl border border-white/[0.08] bg-surface-container/40 p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-semibold text-on-surface">
                    {oauthProvider
                      ? `連接 ${item.name}`
                      : auth?.label || '連接器授權'}
                  </div>
                  <p className="text-[11px] text-outline mt-0.5 leading-relaxed">
                    {oauthProvider
                      ? '將開啟供應商授權頁；完成後自動安全儲存。'
                      : item.setupHint || '貼上供應商核發的 token；僅存於本機。'}
                  </p>
                </div>
                {(oauthProvider?.docsUrl || auth?.docsUrl) && (
                  <button
                    type="button"
                    onClick={() => void openExternal(oauthProvider?.docsUrl || auth?.docsUrl || '')}
                    className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                  >
                    開發者後台
                  </button>
                )}
              </div>

              {!authorized && oauthProvider && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={oauthBusy || !hasElectronOAuth}
                      onClick={() => void startOAuth()}
                      className="rounded-lg bg-primary-container px-3 py-2 text-[12px] font-semibold text-on-primary-container disabled:opacity-40"
                    >
                      {oauthBusy ? '等待授權…' : `連接 ${item.name}`}
                    </button>
                    {oauthBusy && (
                      <button
                        type="button"
                        onClick={() => void window.subagents?.oauth?.cancel?.()}
                        className="text-[12px] font-semibold text-outline"
                      >
                        取消
                      </button>
                    )}
                  </div>
                  {!hasElectronOAuth && (
                    <p className="text-[11px] text-secondary">OAuth 需使用桌面版。</p>
                  )}
                  {oauthStatus.message && (
                    <div className="break-words text-[11px] text-on-surface-variant">
                      {oauthStatus.message}
                      {oauthStatus.userCode && (
                        <div className="mt-1 font-[family-name:var(--font-mono)] tracking-widest">
                          {oauthStatus.userCode}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!authorized && oauthProvider && (
                <details className="rounded-lg border border-white/[0.06] bg-surface/40 px-3 py-2">
                  <summary className="text-[11px] font-semibold text-outline cursor-pointer select-none">
                    其他方式：使用存取金鑰
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="password"
                        autoComplete="off"
                        value={tokenDraft}
                        onChange={(e) => setTokenDraft(e.target.value)}
                        placeholder={auth?.placeholder || '貼上 access token / PAT / API key'}
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface px-3 py-2 text-[12px] text-on-surface outline-none focus:border-primary/40 font-[family-name:var(--font-mono)]"
                      />
                      <button
                        type="button"
                        disabled={!tokenDraft.trim() || savingAuth}
                        onClick={() => void saveAuth()}
                        className="rounded-lg border border-white/10 bg-white/[0.08] px-3 py-2 text-[12px] font-semibold text-on-surface disabled:opacity-40"
                      >
                        {savingAuth ? '儲存中…' : '儲存'}
                      </button>
                    </div>
                  </div>
                </details>
              )}

              {!authorized && !oauthProvider && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    autoComplete="off"
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    placeholder={auth?.placeholder || '貼上 access token / PAT / API key'}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface px-3 py-2 text-[12px] text-on-surface outline-none focus:border-primary/40 font-[family-name:var(--font-mono)]"
                  />
                  <button
                    type="button"
                    disabled={!tokenDraft.trim() || savingAuth}
                    onClick={() => void saveAuth()}
                    className="rounded-lg bg-primary-container px-3 py-2 text-[12px] font-semibold text-on-primary-container disabled:opacity-40"
                  >
                    {savingAuth ? '儲存中…' : '儲存並開始用'}
                  </button>
                </div>
              )}

              {authorized && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-primary font-medium">已就緒 — 可回新任務直接下指令</span>
                  <a
                    href="#/"
                    className="text-[11px] font-semibold text-primary hover:underline"
                    onClick={(e) => {
                      e.preventDefault()
                      window.location.hash = '#/'
                    }}
                  >
                    去新任務
                  </a>
                  <button
                    type="button"
                    onClick={onClearAuth}
                    className="text-[11px] font-semibold text-error hover:text-error/80"
                  >
                    撤銷授權
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
