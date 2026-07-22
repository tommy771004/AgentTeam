import { DEFAULT_PI_SETTINGS, validatePiSettingsPatch, type PiSettings } from './piAgentProfile.ts'

export type LegacySettingsInput = {
  provider?: unknown
  model?: unknown
  thinkingLevel?: unknown
  activeTools?: unknown
  compaction?: unknown
  approvalMode?: unknown
  unattended?: unknown
  apiKey?: unknown
}

export type PiSettingsMigration = {
  version: 1
  settings: PiSettings
  credential: { provider: string; apiKey: string } | null
  electronOwned: string[]
}

/** Main-process-only adapter. Credential material is returned only to the caller that persists it. */
export function migrateLegacySettings(input: LegacySettingsInput): PiSettingsMigration {
  const patch = validatePiSettingsPatch({
    ...(typeof input.provider === 'string' ? { provider: input.provider } : {}),
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
    ...(typeof input.thinkingLevel === 'string' ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(Array.isArray(input.activeTools) ? { activeTools: input.activeTools } : {}),
    ...(typeof input.compaction === 'string' ? { compaction: input.compaction } : {}),
    ...(typeof input.approvalMode === 'string' ? { approvalMode: input.approvalMode } : {}),
    ...(typeof input.unattended === 'boolean' ? { unattended: input.unattended } : {}),
  })
  const settings: PiSettings = { ...DEFAULT_PI_SETTINGS, ...patch }
  const credential = typeof input.apiKey === 'string' && input.apiKey.length > 0
    ? { provider: settings.provider, apiKey: input.apiKey }
    : null
  return { version: 1, settings, credential, electronOwned: ['theme', 'shortcuts', 'windowBounds'] }
}
