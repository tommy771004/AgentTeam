import type { ReactNode } from 'react'
import type { MessageKey } from '../../i18n'
import { useTranslation } from '../../i18n/useTranslation'
import {
  fieldAnchorId,
  fieldIsVisible,
  getSettingsField,
  groupHasVisibleFields,
} from '../../settings/fieldRegistry'
import { SettingsGroup, SettingsRow, SettingsStack } from './SettingsChrome'

export type SettingsFieldContext = {
  showAdvanced: boolean
  policyAdminBuild: boolean
  /** 搜尋跳轉／深連結命中的欄位 id — 高亮用 */
  highlightId?: string | null
}

/**
 * Settings registry restructure（spec 3/6 ticket 01）— registry 驅動的設定列。
 *
 * 控件留在各自的 panel 裡（它們本來就長得都不一樣），但「這一列叫什麼、屬於哪一
 * 節、是基礎還是進階、搜尋怎麼找到它、錨點是什麼」一律來自 registry。於是分層與
 * 可發現性是宣告出來的，不是散在畫面裡的條件判斷。
 *
 * 未宣告的 id 會直接不畫並在 console 抱怨——比默默漏一列好，而且 fail-closed
 * 的覆蓋率檢查本來就會先攔下來。
 */
export function SettingsField({
  id,
  control,
  children,
  description,
  ctx,
}: {
  /** registry 的欄位 id（同時是錨點） */
  id: string
  /** 靠右的控件（row 版面） */
  control?: ReactNode
  /** 標題下方的整寬控件（stack 版面，例如多行輸入） */
  children?: ReactNode
  /** 覆寫說明文字（用於值會變動的說明，例如目前字級） */
  description?: ReactNode
  ctx: SettingsFieldContext
}) {
  const { t } = useTranslation()
  const field = getSettingsField(id)
  if (!field) {
    console.warn(`[settings] 未宣告的欄位 id：${id}`)
    return null
  }
  if (!fieldIsVisible(field, ctx)) return null

  // 已 key 化的欄位走語言檔；尚未遷入的沿用 registry 的 zh-TW 字面值。
  const label = field.labelKey ? t(field.labelKey) : field.label
  const summary = field.summaryKey ? t(field.summaryKey) : field.summary
  const highlighted = ctx.highlightId === id
  const title =
    field.tier === 'advanced' ? (
      <span className="inline-flex items-baseline gap-1.5">
        {label}
        <span className="text-[10px] font-normal text-outline">
          {t('settings.field.advancedBadge')}
        </span>
      </span>
    ) : (
      label
    )

  return (
    <div
      id={fieldAnchorId(id)}
      data-settings-field={id}
      className={`scroll-mt-24 transition-colors ${highlighted ? 'bg-accent-tint' : ''}`}
    >
      {children ? (
        <SettingsStack title={title} description={description ?? summary}>
          {children}
        </SettingsStack>
      ) : (
        <SettingsRow title={title} description={description ?? summary} control={control} />
      )}
    </div>
  )
}

/**
 * 給「不是一列開關」的欄位用的錨點包裝。
 *
 * CLI 授權矩陣、角色模型指派、MCP 伺服器這些是完整的工作流，不該被硬塞進
 * 標題＋控件的格子裡。它們保留原本的畫面，只補上 registry 的可見性與錨點，
 * 於是搜尋跳得到、tier 也管得到。
 */
export function SettingsAnchor({
  id,
  ctx,
  children,
}: {
  id: string
  ctx: SettingsFieldContext
  children: ReactNode
}) {
  const field = getSettingsField(id)
  if (!field) {
    console.warn(`[settings] 未宣告的欄位 id：${id}`)
    return null
  }
  if (!fieldIsVisible(field, ctx)) return null

  return (
    <div
      id={fieldAnchorId(id)}
      data-settings-field={id}
      className={`scroll-mt-24 transition-colors ${ctx.highlightId === id ? 'bg-accent-tint' : ''}`}
    >
      {children}
    </div>
  )
}

/**
 * 只在這個群組還有欄位可看時才畫出卡片。
 *
 * 一整組都是進階欄位時（例如「門檻」「LLM 韌性」），基礎檢視若照畫卡片，
 * 使用者會看到一張只有標題、裡面空空如也的卡。這個規則必須是結構性的，
 * 不能靠每個 panel 各自記得寫一次 if。
 */
export function SettingsGroupFor({
  section,
  group,
  titleKey,
  ctx,
  action,
  children,
}: {
  section: string
  /** registry 裡的群組識別（同時是尚未 key 化時的 zh-TW 標題） */
  group: string
  /** 已 key 化的群組標題（spec 6/6） */
  titleKey?: MessageKey
  ctx: SettingsFieldContext
  action?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  if (!groupHasVisibleFields(section, group, ctx)) return null
  return (
    <SettingsGroup title={titleKey ? t(titleKey) : group} action={action}>
      {children}
    </SettingsGroup>
  )
}
