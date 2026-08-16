/**
 * Full localization（spec 6/6 ticket 01）— 輕量字串抽取層。
 *
 * 刻意不引入重型 i18n 框架：這裡要的是「一個查表函式 + 一份 zh-TW 真相 + 缺翻
 * 不炸畫面」，其餘（複數規則、ICU 訊息格式）本產品目前用不到，先不背。
 *
 * zh-TW 是 source of truth：所有 key 都必須在 zh-TW 檔裡存在（由 smoke fail-closed
 * 把關），其他語言缺 key 時 fallback 回 zh-TW —— 缺翻是少一層潤飾，不是空白畫面。
 */
import { zhTW } from './locales/zh-TW.ts'

/** 支援的介面語言。`system` 不是語言，是「跟隨作業系統」的選擇。 */
export const UI_LANGUAGES = ['zh-TW', 'en'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]
export type UiLanguagePreference = UiLanguage | 'system'

/** zh-TW 檔決定合法 key 的全集——型別安全從這裡來。 */
export type MessageKey = keyof typeof zhTW
export type MessageCatalog = Partial<Record<MessageKey, string>>

export type TranslateParams = Record<string, string | number>

const catalogs: Record<UiLanguage, MessageCatalog> = {
  'zh-TW': zhTW,
  en: {},
}

/** en 等語言檔以延遲註冊的方式掛上，避免啟動就載入所有語言。 */
export function registerCatalog(language: UiLanguage, catalog: MessageCatalog): void {
  catalogs[language] = catalog
}

export function catalogFor(language: UiLanguage): MessageCatalog {
  return catalogs[language]
}

/**
 * 把 OS 語言對到我們支援的語言。
 *
 * 只做前綴比對：`zh-Hant-TW`／`zh-TW`／`zh` 都算繁中，其餘一律 en。
 * spec 的 Out of Scope 明訂不做語言自動偵測，這裡只服從 OS 設定。
 */
export function resolveSystemLanguage(locales: readonly string[]): UiLanguage {
  for (const raw of locales) {
    const tag = raw.toLowerCase()
    if (tag.startsWith('zh')) return 'zh-TW'
    if (tag.startsWith('en')) return 'en'
  }
  return 'zh-TW'
}

/** 把偏好（可能是 `system`）解析成實際語言。 */
export function resolveLanguage(
  preference: UiLanguagePreference | undefined,
  systemLocales: readonly string[],
): UiLanguage {
  if (preference && preference !== 'system') return preference
  return resolveSystemLanguage(systemLocales)
}

/**
 * 內插：`{name} 已建立` + `{ name: '每日摘要' }`。
 *
 * 用具名參數而不是字串相接，是因為語序會隨語言改變——`{n} 個項目` 在別的語言
 * 可能得把數字放到句尾，相接寫法就沒救了。
 */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  )
}

/**
 * 查一個 key 在指定語言下的字串。
 *
 * 缺翻的順序是「目標語言 → zh-TW → key 本身」。回退到 key 本身只會發生在
 * 對帳閘門被繞過時，留著是為了不讓畫面出現空白。
 */
export function translate(
  language: UiLanguage,
  key: MessageKey,
  params?: TranslateParams,
): string {
  const template = catalogs[language]?.[key] ?? zhTW[key] ?? key
  return interpolate(template, params)
}

/** 目標語言相對 zh-TW 缺了哪些 key（對帳報表用）。 */
export function missingKeys(language: UiLanguage): MessageKey[] {
  const catalog = catalogs[language]
  return (Object.keys(zhTW) as MessageKey[]).filter((key) => !catalog?.[key])
}
