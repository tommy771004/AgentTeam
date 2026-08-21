import type { SubDesignPluginExecutionProjection } from '../pluginExecution.ts'
import { persistSubDesignMetadata, readSubDesignMetadata } from '../metadata.ts'
import { STORYBOOK_PINNED_VERSION } from './storybookProvider.ts'
import { CDT_PINNED_VERSION } from './chromeDevToolsProvider.ts'
import { HARNESS_PINNED_VERSION } from './harnessProvider.ts'

export const STORYBOOK_PROVIDER_SETTINGS_ID = 'storybook'
export const CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID = 'chrome-devtools'
export const HARNESS_PROVIDER_SETTINGS_ID = 'harness'

export type StorybookProviderSettings = {
  schemaVersion: 1
  id: typeof STORYBOOK_PROVIDER_SETTINGS_ID
  enabled: boolean
  endpoint: string
  resolvedVersion: typeof STORYBOOK_PINNED_VERSION
  updatedAt: string
}

export type ChromeDevToolsProviderSettings = {
  schemaVersion: 1
  id: typeof CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID
  enabled: boolean
  endpoint: string
  resolvedVersion: typeof CDT_PINNED_VERSION
  updatedAt: string
}

export type HarnessProviderSettings = {
  schemaVersion: 1
  id: typeof HARNESS_PROVIDER_SETTINGS_ID
  enabled: boolean
  binaryPath: string
  targetUrl: string
  resolvedVersion: typeof HARNESS_PINNED_VERSION
  updatedAt: string
}

export const DEFAULT_STORYBOOK_PROVIDER_SETTINGS: StorybookProviderSettings = {
  schemaVersion: 1,
  id: STORYBOOK_PROVIDER_SETTINGS_ID,
  enabled: false,
  endpoint: 'http://127.0.0.1:6006',
  resolvedVersion: STORYBOOK_PINNED_VERSION,
  updatedAt: '',
}

export const DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS: ChromeDevToolsProviderSettings = {
  schemaVersion: 1,
  id: CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID,
  enabled: false,
  endpoint: 'http://127.0.0.1:9222',
  resolvedVersion: CDT_PINNED_VERSION,
  updatedAt: '',
}

export const DEFAULT_HARNESS_PROVIDER_SETTINGS: HarnessProviderSettings = {
  schemaVersion: 1,
  id: HARNESS_PROVIDER_SETTINGS_ID,
  enabled: false,
  binaryPath: 'harness-mcp',
  targetUrl: 'http://127.0.0.1:5173',
  resolvedVersion: HARNESS_PINNED_VERSION,
  updatedAt: '',
}

function isLoopbackHttpEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

export function normalizeStorybookProviderSettings(value: unknown): StorybookProviderSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_STORYBOOK_PROVIDER_SETTINGS
  const input = value as Partial<StorybookProviderSettings>
  const rawEndpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : ''
  const endpointValid = isLoopbackHttpEndpoint(rawEndpoint)
  const endpoint = endpointValid
    ? rawEndpoint.slice(0, 500)
    : DEFAULT_STORYBOOK_PROVIDER_SETTINGS.endpoint
  return {
    schemaVersion: 1,
    id: STORYBOOK_PROVIDER_SETTINGS_ID,
    enabled: input.enabled === true && endpointValid,
    endpoint,
    resolvedVersion: STORYBOOK_PINNED_VERSION,
    updatedAt: typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : '',
  }
}

export function validateStorybookProviderEndpoint(endpoint: string): string | null {
  return isLoopbackHttpEndpoint(endpoint.trim()) ? null : 'Endpoint 必須是 localhost HTTP，且不可包含帳密。'
}

export function normalizeChromeDevToolsProviderSettings(value: unknown): ChromeDevToolsProviderSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS
  const input = value as Partial<ChromeDevToolsProviderSettings>
  const rawEndpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : ''
  const endpointValid = isLoopbackHttpEndpoint(rawEndpoint)
  return {
    schemaVersion: 1,
    id: CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID,
    enabled: input.enabled === true && endpointValid,
    endpoint: endpointValid ? rawEndpoint.slice(0, 500) : DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS.endpoint,
    resolvedVersion: CDT_PINNED_VERSION,
    updatedAt: typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : '',
  }
}

export const validateChromeDevToolsProviderEndpoint = validateStorybookProviderEndpoint

export function normalizeHarnessProviderSettings(value: unknown): HarnessProviderSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_HARNESS_PROVIDER_SETTINGS
  const input = value as Partial<HarnessProviderSettings>
  const binaryPath = typeof input.binaryPath === 'string' && (input.binaryPath === 'harness-mcp' || input.binaryPath.startsWith('/')) ? input.binaryPath.slice(0, 500) : 'harness-mcp'
  const targetUrl = typeof input.targetUrl === 'string' && isLoopbackHttpEndpoint(input.targetUrl) ? input.targetUrl.slice(0, 500) : DEFAULT_HARNESS_PROVIDER_SETTINGS.targetUrl
  return { schemaVersion: 1, id: HARNESS_PROVIDER_SETTINGS_ID, enabled: input.enabled === true, binaryPath, targetUrl, resolvedVersion: HARNESS_PINNED_VERSION, updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '' }
}

export async function loadStorybookProviderState(projectRoot?: string): Promise<{
  settings: StorybookProviderSettings
  runs: SubDesignPluginExecutionProjection[]
}> {
  if (!projectRoot) return { settings: DEFAULT_STORYBOOK_PROVIDER_SETTINGS, runs: [] }
  const metadata = await readSubDesignMetadata(projectRoot)
  const rawSettings = metadata?.openDesignProviderSettings.find((item) => (
    Boolean(item && typeof item === 'object' && !Array.isArray(item))
    && (item as Record<string, unknown>).id === STORYBOOK_PROVIDER_SETTINGS_ID
  ))
  const runs = (metadata?.openDesignProviderRuns || [])
    .filter((item): item is SubDesignPluginExecutionProjection => Boolean(
      item && typeof item === 'object' && !Array.isArray(item)
      && (item as Record<string, unknown>).schemaVersion === 1
      && (item as Record<string, unknown>).providerId === STORYBOOK_PROVIDER_SETTINGS_ID,
    ))
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return { settings: normalizeStorybookProviderSettings(rawSettings), runs }
}

export async function saveStorybookProviderSettings(
  value: Pick<StorybookProviderSettings, 'enabled' | 'endpoint'>,
  projectRoot?: string,
): Promise<{ ok: true; settings: StorybookProviderSettings } | { ok: false; reason: string }> {
  if (!projectRoot) return { ok: false, reason: '請先綁定 project。' }
  const endpoint = value.endpoint.trim()
  const error = validateStorybookProviderEndpoint(endpoint)
  if (error) return { ok: false, reason: error }
  const settings: StorybookProviderSettings = {
    schemaVersion: 1,
    id: STORYBOOK_PROVIDER_SETTINGS_ID,
    enabled: value.enabled,
    endpoint,
    resolvedVersion: STORYBOOK_PINNED_VERSION,
    updatedAt: new Date().toISOString(),
  }
  const persisted = await persistSubDesignMetadata('open-design-provider-settings', settings, projectRoot)
  return persisted ? { ok: true, settings } : { ok: false, reason: '無法寫入 project provider settings。' }
}

export async function loadChromeDevToolsProviderState(projectRoot?: string): Promise<{
  settings: ChromeDevToolsProviderSettings
  runs: SubDesignPluginExecutionProjection[]
}> {
  if (!projectRoot) return { settings: DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS, runs: [] }
  const metadata = await readSubDesignMetadata(projectRoot)
  const rawSettings = metadata?.openDesignProviderSettings.find((item) => (
    Boolean(item && typeof item === 'object' && !Array.isArray(item))
    && (item as Record<string, unknown>).id === CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID
  ))
  const runs = (metadata?.openDesignProviderRuns || [])
    .filter((item): item is SubDesignPluginExecutionProjection => Boolean(
      item && typeof item === 'object' && !Array.isArray(item)
      && (item as Record<string, unknown>).schemaVersion === 1
      && (item as Record<string, unknown>).providerId === CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID,
    ))
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return { settings: normalizeChromeDevToolsProviderSettings(rawSettings), runs }
}

export async function saveChromeDevToolsProviderSettings(
  value: Pick<ChromeDevToolsProviderSettings, 'enabled' | 'endpoint'>,
  projectRoot?: string,
): Promise<{ ok: true; settings: ChromeDevToolsProviderSettings } | { ok: false; reason: string }> {
  if (!projectRoot) return { ok: false, reason: '請先綁定 project。' }
  const endpoint = value.endpoint.trim()
  const error = validateChromeDevToolsProviderEndpoint(endpoint)
  if (error) return { ok: false, reason: error }
  const settings: ChromeDevToolsProviderSettings = {
    schemaVersion: 1,
    id: CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID,
    enabled: value.enabled,
    endpoint,
    resolvedVersion: CDT_PINNED_VERSION,
    updatedAt: new Date().toISOString(),
  }
  const persisted = await persistSubDesignMetadata('open-design-provider-settings', settings, projectRoot)
  return persisted ? { ok: true, settings } : { ok: false, reason: '無法寫入 project provider settings。' }
}

export async function loadHarnessProviderState(projectRoot?: string): Promise<{ settings: HarnessProviderSettings; runs: SubDesignPluginExecutionProjection[] }> {
  if (!projectRoot) return { settings: DEFAULT_HARNESS_PROVIDER_SETTINGS, runs: [] }
  const metadata = await readSubDesignMetadata(projectRoot)
  const rawSettings = metadata?.openDesignProviderSettings.find((item) => Boolean(item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).id === HARNESS_PROVIDER_SETTINGS_ID))
  const runs = (metadata?.openDesignProviderRuns || []).filter((item): item is SubDesignPluginExecutionProjection => Boolean(item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).schemaVersion === 1 && (item as Record<string, unknown>).providerId === HARNESS_PROVIDER_SETTINGS_ID)).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  return { settings: normalizeHarnessProviderSettings(rawSettings), runs }
}

export async function saveHarnessProviderSettings(value: Pick<HarnessProviderSettings, 'enabled' | 'binaryPath' | 'targetUrl'>, projectRoot?: string): Promise<{ ok: true; settings: HarnessProviderSettings } | { ok: false; reason: string }> {
  if (!projectRoot) return { ok: false, reason: '請先綁定 project。' }
  const binaryPath = value.binaryPath.trim()
  if (binaryPath !== 'harness-mcp' && !binaryPath.startsWith('/')) return { ok: false, reason: 'Harness binary 必須是 harness-mcp 或絕對路徑。' }
  if (!isLoopbackHttpEndpoint(value.targetUrl.trim())) return { ok: false, reason: 'Harness web target 必須是 localhost HTTP。' }
  const settings: HarnessProviderSettings = { schemaVersion: 1, id: HARNESS_PROVIDER_SETTINGS_ID, enabled: value.enabled, binaryPath, targetUrl: value.targetUrl.trim(), resolvedVersion: HARNESS_PINNED_VERSION, updatedAt: new Date().toISOString() }
  const persisted = await persistSubDesignMetadata('open-design-provider-settings', settings, projectRoot)
  return persisted ? { ok: true, settings } : { ok: false, reason: '無法寫入 project provider settings。' }
}
