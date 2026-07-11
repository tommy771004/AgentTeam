/**
 * User-facing capability status for task-first UX (no MCP jargon).
 */

import { catalogItem, PLUGIN_CATALOG } from '../agent/hermes/pluginCatalog'
import { hasPluginSecret } from '../agent/hermes/pluginSecrets'
import type { PluginManifest } from '../agent/hermes/plugins'
import { useSettingsStore } from '../store/settingsStore'

export type CapabilityReadyState = 'ready' | 'needs_auth' | 'not_installed' | 'optional_extra'

export type CapabilityCard = {
  id: string
  title: string
  blurb: string
  state: CapabilityReadyState
  /** Prompt user can send on 新任務 without any setup */
  tryPrompt: string
  /** Install target plugin id if not installed */
  installId?: string
  /** Auth target (connector) */
  authId?: string
  /**
   * Capability ids forced into preload when user clicks「填入試用句」or runs the try prompt.
   * Aligns marketplace/empty-state UX with engine progressive disclosure.
   */
  preloadCapabilityIds: string[]
}

/** Core capabilities that work via direct tasks (HTTP tools after auth, or builtins). */
const PRIMARY_ABILITIES: Array<{
  id: string
  title: string
  blurb: string
  tryPrompt: string
  /** Connector/plugin that enables this for tasks */
  pluginId: string
  /** Engine capability ids to preload on try */
  preloadCapabilityIds: string[]
}> = [
  {
    id: 'github',
    title: 'GitHub',
    blurb: '查 PR、issue、倉庫狀態——直接在任務裡說即可',
    tryPrompt: '用 GitHub 查我最近有哪些 open PR（若尚未授權會提示）',
    pluginId: 'github-connector',
    preloadCapabilityIds: ['user:github-connector'],
  },
  {
    id: 'notion',
    title: 'Notion',
    blurb: '搜尋頁面與知識庫',
    tryPrompt: '在 Notion 裡搜尋「規格」相關頁面',
    pluginId: 'notion-connector',
    preloadCapabilityIds: ['user:notion-connector'],
  },
  {
    id: 'web',
    title: '網路研究',
    blurb: '內建搜尋與讀網頁，通常不必另外安裝',
    tryPrompt: '幫我找 3 款 AI 剪輯軟體並比較價格',
    pluginId: 'web-reader', // optional enhancement; builtins also cover search
    preloadCapabilityIds: [],
  },
  {
    id: 'workspace',
    title: '專案檔案',
    blurb: '選好專案目錄後可讀寫工作區（任務裡直接說路徑即可）',
    tryPrompt: '列出目前專案根目錄的檔案結構',
    pluginId: 'filesystem-mcp',
    preloadCapabilityIds: ['mcp:filesystem-mcp', 'workspace'],
  },
  {
    id: 'home',
    title: '智慧家庭',
    blurb: 'Home Assistant：查 entity、開關燈與場景（需區網 + Token）',
    tryPrompt: '用 Home Assistant 檢查 API 是否可用，並列出幾個 light 實體',
    pluginId: 'homeassistant-connector',
    preloadCapabilityIds: ['user:homeassistant-connector'],
  },
]

export function resolveAbilityState(
  pluginId: string,
  plugins: PluginManifest[],
): CapabilityReadyState {
  const p = plugins.find((x) => x.id === pluginId)
  if (!p) return 'not_installed'
  const item = catalogItem(pluginId)
  if (item?.installKind === 'connector' || item?.auth) {
    if (hasPluginSecret(pluginId) || p.connectorAuth?.hasCredential) return 'ready'
    return 'needs_auth'
  }
  if (item?.installKind === 'npm-mcp') {
    const secret = item.npm?.secretPluginId || item.dependsOnPluginId
    if (secret && !hasPluginSecret(secret)) return 'needs_auth'
    return p.enabled ? 'ready' : 'needs_auth'
  }
  // bundled
  return p.enabled ? 'ready' : 'needs_auth'
}

export function listPrimaryAbilities(plugins: PluginManifest[]): CapabilityCard[] {
  return PRIMARY_ABILITIES.map((a) => {
    let state = resolveAbilityState(a.pluginId, plugins)
    // web: builtins always work
    if (a.id === 'web') {
      state = plugins.some((p) => p.id === 'web-reader' && p.enabled) ? 'ready' : 'ready'
    }
    // workspace: ready if project root set (builtins) even without MCP
    if (a.id === 'workspace') {
      // project check is optional in UI caller
      const hasMcp = plugins.some((p) => p.id === 'filesystem-mcp' && p.enabled)
      state = hasMcp ? 'ready' : 'optional_extra'
    }
    return {
      id: a.id,
      title: a.title,
      blurb: a.blurb,
      state,
      tryPrompt: a.tryPrompt,
      installId: a.pluginId,
      authId: catalogItem(a.pluginId)?.auth ? a.pluginId : catalogItem(a.pluginId)?.dependsOnPluginId,
      preloadCapabilityIds: [...a.preloadCapabilityIds],
    }
  })
}

/** Map ability id → preload ids (for try-prompt runs) */
export function preloadIdsForAbility(abilityId: string): string[] {
  const a = PRIMARY_ABILITIES.find((x) => x.id === abilityId)
  return a ? [...a.preloadCapabilityIds] : []
}

/** Hide engineering jargon in marketplace kind labels */
export function installKindUserLabel(kind: string): string {
  if (kind === 'npm-mcp') return '進階工具包'
  if (kind === 'connector') return '連線授權'
  if (kind === 'bundled') return '內建能力'
  return kind
}

export function softTipUserFacing(tip: string | null): string | null {
  if (!tip) return null
  return tip
    .replace(/\bMCP\b/g, '進階工具')
    .replace(/connector/gi, '連線')
    .replace(/GITHUB_TOKEN|環境變數/g, '授權')
    .replace(/token 會自動注入/gi, '授權後即可使用')
}

/** Featured marketplace items that are "task-first" (skip pure MCP packaging cards in simple view) */
export function isTaskFirstCatalogId(id: string): boolean {
  const item = catalogItem(id)
  if (!item) return false
  // Hide pure packaging MCP packs from simple lists — they are advanced
  if (item.installKind === 'npm-mcp' && item.dependsOnPluginId) return false
  if (id.endsWith('-mcp') && id !== 'filesystem-mcp') return false
  return true
}

export function countReadyConnectors(plugins: PluginManifest[]): number {
  return plugins.filter((p) => {
    const item = catalogItem(p.id)
    if (!item || item.installKind !== 'connector') return false
    return p.enabled && (hasPluginSecret(p.id) || p.connectorAuth?.hasCredential)
  }).length
}

export function functionCallingOn(): boolean {
  return useSettingsStore.getState().settings.functionCalling !== false
}

export { PLUGIN_CATALOG }
