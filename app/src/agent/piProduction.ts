import type { LlmSettings } from './types.ts'

/**
 * Electron's Pi Host is the production runtime boundary. The renderer keeps
 * the legacy engine only for browser-only unit/smoke runs where no host can
 * exist; it must never become a second owner in a real Electron session.
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

/** Fields whose runtime authority belongs to Pi Host in Electron. */
export const PI_OWNED_SETTINGS_KEYS = [
  'apiProvider',
  'baseUrl',
  'apiKey',
  'model',
  'fallbackModels',
  'discoveredModels',
  'roleModels',
  'toolsEnabled',
  'functionCalling',
  'capabilitiesEnabled',
  'toolSearchEnabled',
  'codeModeEnabled',
  'approvalMode',
  'bashRequireAsk',
  'unattended',
] as const

/** Remove renderer copies of fields that Pi Host persists and executes. */
export function stripPiOwnedSettings(input: Partial<LlmSettings>): Partial<LlmSettings> {
  const output = { ...input }
  for (const key of PI_OWNED_SETTINGS_KEYS) delete (output as Record<string, unknown>)[key]
  return output
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
}

/** Project the legacy UI shape into the Pi Host settings protocol. */
export function piSettingsPatchFromLlmSettings(
  settings: Partial<LlmSettings>,
): PiSettingsPatch {
  const patch: PiSettingsPatch = {}
  if (settings.apiProvider) patch.provider = settings.apiProvider
  if (settings.baseUrl != null) patch.baseUrl = settings.baseUrl
  if (settings.apiKey != null) patch.apiKey = settings.apiKey
  if (settings.model != null) patch.model = settings.model
  if (settings.approvalMode != null) patch.approvalMode = settings.approvalMode
  if (settings.bashRequireAsk != null) patch.bashRequireAsk = settings.bashRequireAsk
  if (settings.unattended != null) patch.unattended = settings.unattended
  return patch
}
