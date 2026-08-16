import { useCallback, useSyncExternalStore } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import {
  resolveLanguage,
  translate,
  type MessageKey,
  type TranslateParams,
  type UiLanguage,
} from './index'

/**
 * 目前的系統語言。
 *
 * 用 `useSyncExternalStore` 訂閱 `languagechange`，這樣使用者在 OS 改語言時，
 * 選「跟隨系統」的人不必重開 app 就會跟著變。
 */
function subscribeSystemLanguage(onChange: () => void): () => void {
  window.addEventListener('languagechange', onChange)
  return () => window.removeEventListener('languagechange', onChange)
}

function systemLocalesSnapshot(): string {
  return navigator.languages?.join(',') || navigator.language || ''
}

export function useSystemLocales(): readonly string[] {
  const joined = useSyncExternalStore(
    subscribeSystemLanguage,
    systemLocalesSnapshot,
    () => 'zh-TW',
  )
  return joined ? joined.split(',') : []
}

/** 目前實際生效的介面語言（已解析 `system`）。 */
export function useUiLanguage(): UiLanguage {
  const preference = useSettingsStore((s) => s.settings.uiLanguage)
  const locales = useSystemLocales()
  return resolveLanguage(preference, locales)
}

/**
 * 取得 `t()`。
 *
 * 因為語言來自 settings store，切換語言會讓所有用到 `t` 的元件重繪——這就是
 * 「即時生效不重啟」的全部機制，不需要額外的事件或 provider。
 */
export function useTranslation(): {
  t: (key: MessageKey, params?: TranslateParams) => string
  language: UiLanguage
} {
  const language = useUiLanguage()
  const t = useCallback(
    (key: MessageKey, params?: TranslateParams) => translate(language, key, params),
    [language],
  )
  return { t, language }
}
