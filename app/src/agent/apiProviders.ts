import type { ApiProviderPreset } from './types.ts'
import { SUBSCRIPTION_PROVIDERS, type SubscriptionProviderId } from './subscriptionCatalog.ts'

export type ApiProviderDefinition = {
  id: ApiProviderPreset
  label: string
  baseUrl: string
  defaultModel: string
  fallbackModels: string[]
  note: string
}

/**
 * Native Pi providers whose credential comes from a local CLI login sync
 * (ADR-0052): the CLI OAuth lands in the Host-side synced credential store
 * and the builtin Pi loop runs on the subscription model. The list is the
 * catalog module's OWN definition re-exported under its settings-surface
 * name — one list, never a mirrored copy.
 */
export type SubscriptionProviderPreset = SubscriptionProviderId

export const SUBSCRIPTION_PROVIDER_PRESETS: readonly SubscriptionProviderPreset[] = SUBSCRIPTION_PROVIDERS

export function isSubscriptionProviderPreset(id: ApiProviderPreset | string): boolean {
  return (SUBSCRIPTION_PROVIDER_PRESETS as readonly string[]).includes(id)
}

/** OpenAI-compatible connection presets. Custom keeps the user's exact endpoint. */
export const API_PROVIDER_PRESETS: ApiProviderDefinition[] = [
  {
    id: 'aihubmix',
    label: 'AIHubMix',
    baseUrl: 'https://aihubmix.com/v1',
    defaultModel: 'gpt-4.1-mini-free',
    fallbackModels: [
      'glm-4.7-flash-free',
      'xiaomi-mimo-v2-pro-free',
      'coding-glm-5.1-free',
    ],
    note: '免費模型可能暫時無通道；會依序嘗試備援模型。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    fallbackModels: [],
    note: '使用 OpenAI 官方 API 金鑰。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    fallbackModels: [],
    note: '使用 OpenRouter 的 OpenAI 相容端點。',
  },
  {
    id: 'openai-codex',
    label: 'Codex 訂閱（CLI 登入）',
    baseUrl: '',
    defaultModel: '',
    fallbackModels: [],
    note: '使用本機 Codex CLI 登入的訂閱憑證，由 Pi loop 執行（非 Codex agent）。模型清單由訂閱目錄提供；受訂閱條款與限流約束。',
  },
  {
    id: 'anthropic',
    label: 'Claude 訂閱（CLI 登入）',
    baseUrl: '',
    defaultModel: '',
    fallbackModels: [],
    note: '使用本機 Claude CLI 登入的訂閱憑證，由 Pi loop 執行（非 Claude Code）。模型清單由訂閱目錄提供；受訂閱條款與限流約束。',
  },
  {
    id: 'custom',
    label: '其他 OpenAI 相容 API',
    baseUrl: '',
    defaultModel: '',
    fallbackModels: [],
    note: '可填入任何提供 /v1/chat/completions 的端點。',
  },
]

const CUSTOM_API_PROVIDER = API_PROVIDER_PRESETS.find((provider) => provider.id === 'custom')!

export function apiProviderPreset(id: ApiProviderPreset) {
  return API_PROVIDER_PRESETS.find((provider) => provider.id === id) || CUSTOM_API_PROVIDER
}
