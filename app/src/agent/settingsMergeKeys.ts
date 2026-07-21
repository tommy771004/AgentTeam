/**
 * Settings fields that need custom deep-merge (not shallow overwrite).
 * Single source of truth for mergeSettings + completeness smoke.
 *
 * Adding an object/array field to LlmSettings / DEFAULT_LLM_SETTINGS without
 * listing it here will fail the settings-merge completeness smoke test.
 */
import type { LlmSettings } from './types'

export const SETTINGS_CUSTOM_MERGE_KEYS = [
  'roleModels',
  'mcpServers',
  'mcpAgentServers',
  'discoveredModels',
  'fallbackModels',
  'customTools',
  'customToolSecrets',
  'pluginOAuthClients',
  'cliProviders',
  'alwaysOnCapabilities',
  'modelProfiles',
  'hookRules',
  'trustedHookProjects',
  'delegatePersonas',
] as const satisfies readonly (keyof LlmSettings)[]

export type SettingsCustomMergeKey = (typeof SETTINGS_CUSTOM_MERGE_KEYS)[number]
