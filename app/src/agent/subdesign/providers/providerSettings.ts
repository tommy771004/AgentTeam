import type { SubDesignPluginExecutionProjection } from '../pluginExecution.ts'
import { persistSubDesignMetadata, readSubDesignMetadata } from '../metadata.ts'
import { STORYBOOK_PINNED_VERSION } from './storybookProvider.ts'
import { CDT_PINNED_VERSION } from './chromeDevToolsProvider.ts'
import { HARNESS_PINNED_VERSION } from './harnessProvider.ts'

export const STORYBOOK_PROVIDER_SETTINGS_ID = 'storybook'
export const CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID = 'chrome-devtools'
export const HARNESS_PROVIDER_SETTINGS_ID = 'harness'
export const EXPERIMENTAL_PROVIDER_SETTINGS_ID = 'experimental-surfaces'

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

/**
 * Experimental in-product surfaces that have no endpoint or binary of their
 * own. Persisted like every other provider so the gate is reachable through a
 * real control rather than a test-only override (issue 09: host support must
 * be user-visible).
 */
export type ExperimentalSurfaceSettings = {
  schemaVersion: 1
  id: typeof EXPERIMENTAL_PROVIDER_SETTINGS_ID
  mcpApps: boolean
  streaming: boolean
  updatedAt: string
}

export const DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS: ExperimentalSurfaceSettings = {
  schemaVersion: 1,
  id: EXPERIMENTAL_PROVIDER_SETTINGS_ID,
  mcpApps: false,
  streaming: false,
  updatedAt: '',
}

export function normalizeExperimentalSurfaceSettings(value: unknown): ExperimentalSurfaceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS
  const input = value as Partial<ExperimentalSurfaceSettings>
  return {
    schemaVersion: 1,
    id: EXPERIMENTAL_PROVIDER_SETTINGS_ID,
    mcpApps: input.mcpApps === true,
    streaming: input.streaming === true,
    updatedAt: typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt)) ? input.updatedAt : '',
  }
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


// ── Shared project-metadata access ──────────────────────────────────────
// One reader for all three providers: the settings record for an id, and the
// provider runs that belong to it. Each provider only supplies its own
// normalizer, so adding a provider does not re-copy this plumbing.

export type ProviderSettingsId =
  | typeof STORYBOOK_PROVIDER_SETTINGS_ID
  | typeof CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID
  | typeof HARNESS_PROVIDER_SETTINGS_ID
  | typeof EXPERIMENTAL_PROVIDER_SETTINGS_ID

function isProviderRun(value: unknown): value is SubDesignPluginExecutionProjection {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === 1,
  )
}

/** Newest first. Pass an id to keep only that provider's runs. */
export function selectProviderRuns(
  runs: readonly unknown[] | undefined,
  providerId?: ProviderSettingsId,
): SubDesignPluginExecutionProjection[] {
  return (runs || [])
    .filter(isProviderRun)
    .filter((run) => !providerId || run.providerId === providerId)
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
}

async function loadProviderState<T>(
  projectRoot: string | undefined,
  providerId: ProviderSettingsId,
  normalize: (value: unknown) => T,
  fallback: T,
): Promise<{ settings: T; runs: SubDesignPluginExecutionProjection[] }> {
  if (!projectRoot) return { settings: fallback, runs: [] }
  const metadata = await readSubDesignMetadata(projectRoot)
  const rawSettings = metadata?.openDesignProviderSettings.find((item) => (
    Boolean(item && typeof item === 'object' && !Array.isArray(item))
    && (item as Record<string, unknown>).id === providerId
  ))
  return {
    settings: normalize(rawSettings),
    runs: selectProviderRuns(metadata?.openDesignProviderRuns, providerId),
  }
}

/** Every provider run in the project, newest first — used to recover previews. */
export async function loadAllProviderRuns(projectRoot?: string): Promise<SubDesignPluginExecutionProjection[]> {
  if (!projectRoot) return []
  const metadata = await readSubDesignMetadata(projectRoot)
  return selectProviderRuns(metadata?.openDesignProviderRuns)
}

type ProviderSettings =
  | StorybookProviderSettings
  | ChromeDevToolsProviderSettings
  | HarnessProviderSettings
  | ExperimentalSurfaceSettings

async function saveProviderSettings<T extends ProviderSettings>(
  settings: T,
  projectRoot: string,
): Promise<{ ok: true; settings: T } | { ok: false; reason: string }> {
  const persisted = await persistSubDesignMetadata('open-design-provider-settings', settings, projectRoot)
  return persisted ? { ok: true, settings } : { ok: false, reason: '無法寫入 project provider settings。' }
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
  return loadProviderState(
    projectRoot, STORYBOOK_PROVIDER_SETTINGS_ID,
    normalizeStorybookProviderSettings, DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
  )
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
  return saveProviderSettings(settings, projectRoot)
}

export async function loadChromeDevToolsProviderState(projectRoot?: string): Promise<{
  settings: ChromeDevToolsProviderSettings
  runs: SubDesignPluginExecutionProjection[]
}> {
  return loadProviderState(
    projectRoot, CHROME_DEVTOOLS_PROVIDER_SETTINGS_ID,
    normalizeChromeDevToolsProviderSettings, DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS,
  )
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
  return saveProviderSettings(settings, projectRoot)
}

export async function loadHarnessProviderState(projectRoot?: string): Promise<{
  settings: HarnessProviderSettings
  runs: SubDesignPluginExecutionProjection[]
}> {
  return loadProviderState(
    projectRoot, HARNESS_PROVIDER_SETTINGS_ID,
    normalizeHarnessProviderSettings, DEFAULT_HARNESS_PROVIDER_SETTINGS,
  )
}

export async function saveHarnessProviderSettings(value: Pick<HarnessProviderSettings, 'enabled' | 'binaryPath' | 'targetUrl'>, projectRoot?: string): Promise<{ ok: true; settings: HarnessProviderSettings } | { ok: false; reason: string }> {
  if (!projectRoot) return { ok: false, reason: '請先綁定 project。' }
  const binaryPath = value.binaryPath.trim()
  if (binaryPath !== 'harness-mcp' && !binaryPath.startsWith('/')) return { ok: false, reason: 'Harness binary 必須是 harness-mcp 或絕對路徑。' }
  if (!isLoopbackHttpEndpoint(value.targetUrl.trim())) return { ok: false, reason: 'Harness web target 必須是 localhost HTTP。' }
  const settings: HarnessProviderSettings = { schemaVersion: 1, id: HARNESS_PROVIDER_SETTINGS_ID, enabled: value.enabled, binaryPath, targetUrl: value.targetUrl.trim(), resolvedVersion: HARNESS_PINNED_VERSION, updatedAt: new Date().toISOString() }
  return saveProviderSettings(settings, projectRoot)
}

export async function loadExperimentalSurfaceSettings(projectRoot?: string): Promise<ExperimentalSurfaceSettings> {
  const { settings } = await loadProviderState(
    projectRoot, EXPERIMENTAL_PROVIDER_SETTINGS_ID,
    normalizeExperimentalSurfaceSettings, DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS,
  )
  return settings
}

export async function saveExperimentalSurfaceSettings(
  value: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>,
  projectRoot?: string,
): Promise<{ ok: true; settings: ExperimentalSurfaceSettings } | { ok: false; reason: string }> {
  if (!projectRoot) return { ok: false, reason: '請先綁定 project。' }
  return saveProviderSettings({
    schemaVersion: 1,
    id: EXPERIMENTAL_PROVIDER_SETTINGS_ID,
    mcpApps: value.mcpApps,
    streaming: value.streaming,
    updatedAt: new Date().toISOString(),
  }, projectRoot)
}
