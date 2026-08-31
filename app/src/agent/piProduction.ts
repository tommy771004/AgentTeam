import type { LlmSettings } from './types.ts'
import { isSubscriptionProviderPreset } from './apiProviders.ts'

/**
 * Electron's Pi Host is the production runtime boundary. Plain-browser mode
 * may inspect browser-safe projections, but has no renderer-owned replacement
 * for execution or Host verification.
 */
export function hasPiHostBridge(): boolean {
  const renderer = (globalThis as typeof globalThis & { window?: { subagents?: { piHost?: { sessions?: { list?: unknown } } } } }).window
  return typeof renderer?.subagents?.piHost?.sessions?.list === 'function'
}

export function isElectronRuntime(): boolean {
  const renderer = (globalThis as typeof globalThis & { window?: { subagents?: { platform?: unknown } } }).window
  return typeof renderer?.subagents?.platform === 'function'
}

export function isElectronPiProduction(): boolean {
  return isElectronRuntime() && hasPiHostBridge()
}

export type PiSettingsPatch = {
  provider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  activeTools?: string[]
  approvalMode?: 'always' | 'auto' | 'full'
  bashRequireAsk?: boolean
  unattended?: boolean
  workspaceTextSearch?: boolean
}

export type PiHostSettingsProjection = {
  provider?: string
  model: string
  approvalMode: LlmSettings['approvalMode']
  unattended: boolean
  workspaceTextSearch?: boolean
}

/** Startup and live refresh must project the same non-secret connection pair. */
export function llmSettingsFromPiHost(pi: PiHostSettingsProjection): Partial<LlmSettings> {
  const provider = pi.provider?.trim()
  return {
    ...(provider ? { apiProvider: provider as LlmSettings['apiProvider'] } : {}),
    model: pi.model,
    approvalMode: pi.approvalMode,
    unattended: pi.unattended,
    workspaceTextSearch: pi.workspaceTextSearch === true,
    ...(provider && isSubscriptionProviderPreset(provider) ? { baseUrl: '', apiKey: '' } : {}),
  }
}

/**
 * Renderer setting -> the Pi Host settings field that stores and executes it.
 *
 * This table is the entire ownership contract, and both directions are derived
 * from it on purpose. A key listed here is stripped from renderer storage AND
 * forwarded to the Host; a key absent from it stays renderer-owned and keeps
 * being persisted locally. The two used to be written out separately, so
 * `toolsEnabled`, `functionCalling`, `capabilitiesEnabled`, `toolSearchEnabled`,
 * `codeModeEnabled`, `roleModels`, `fallbackModels` and `discoveredModels` were
 * claimed by the Host, deleted from local storage, and then never sent anywhere
 * — the Settings UI wrote them to nothing at all. Add a key here only once the
 * Host protocol genuinely accepts it (see electron/piAgentProfile.ts PiSettings).
 */
const PI_SETTINGS_FIELD_BY_KEY = {
  apiProvider: 'provider',
  baseUrl: 'baseUrl',
  apiKey: 'apiKey',
  model: 'model',
  approvalMode: 'approvalMode',
  bashRequireAsk: 'bashRequireAsk',
  unattended: 'unattended',
  workspaceTextSearch: 'workspaceTextSearch',
} as const satisfies Partial<Record<keyof LlmSettings, keyof PiSettingsPatch>>

/** Fields whose runtime authority belongs to Pi Host in Electron. */
export const PI_OWNED_SETTINGS_KEYS = Object.keys(
  PI_SETTINGS_FIELD_BY_KEY,
) as Array<keyof LlmSettings & keyof typeof PI_SETTINGS_FIELD_BY_KEY>

/** Remove renderer copies of fields that Pi Host persists and executes. */
export function stripPiOwnedSettings(input: Partial<LlmSettings>): Partial<LlmSettings> {
  const output = { ...input }
  for (const key of PI_OWNED_SETTINGS_KEYS) delete (output as Record<string, unknown>)[key]
  return output
}

/**
 * Project renderer settings into the Pi Host settings protocol.
 *
 * Driven by the ownership table rather than a hand-written list, so every key
 * the renderer stops persisting is a key that actually reaches the Host.
 */
export function piSettingsPatchFromLlmSettings(
  settings: Partial<LlmSettings>,
): PiSettingsPatch {
  const patch: Record<string, unknown> = {}
  // ADR-0052: a subscription connection's credential lives Host-side in the
  // synced CLI-login store. The renderer never sends an API key
  // or endpoint for one — not even an empty string — so the Host's legacy
  // endpoint persist can never latch onto a subscription provider.
  const subscriptionConnection = isSubscriptionProviderPreset(String(settings.apiProvider ?? ''))
  for (const [key, field] of Object.entries(PI_SETTINGS_FIELD_BY_KEY)) {
    const value = (settings as Record<string, unknown>)[key]
    // `apiProvider` is the one field an empty string cannot describe: the Host
    // reads '' as "no provider chosen" and would drop a working connection.
    if (value == null || (key === 'apiProvider' && value === '')) continue
    if (subscriptionConnection && (key === 'baseUrl' || key === 'apiKey')) continue
    patch[field] = value
  }
  return patch as PiSettingsPatch
}
