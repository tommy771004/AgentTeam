import type { ApiProviderPreset } from './types'

export type ApiProviderDefinition = {
  id: ApiProviderPreset
  label: string
  baseUrl: string
  defaultModel: string
  fallbackModels: string[]
  note: string
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
    id: 'custom',
    label: '其他 OpenAI 相容 API',
    baseUrl: '',
    defaultModel: '',
    fallbackModels: [],
    note: '可填入任何提供 /v1/chat/completions 的端點。',
  },
]

export function apiProviderPreset(id: ApiProviderPreset) {
  return API_PROVIDER_PRESETS.find((provider) => provider.id === id) || API_PROVIDER_PRESETS[3]
}
