import type { ReactNode } from 'react'
import {
  fieldAnchorId,
  fieldIsVisible,
  getSettingsField,
} from '../../settings/fieldRegistry'
import { SettingsRow, SettingsStack } from './SettingsChrome'

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
  const field = getSettingsField(id)
  if (!field) {
    console.warn(`[settings] 未宣告的欄位 id：${id}`)
    return null
  }
  if (!fieldIsVisible(field, ctx)) return null

  const highlighted = ctx.highlightId === id
  const title =
    field.tier === 'advanced' ? (
      <span className="inline-flex items-baseline gap-1.5">
        {field.label}
        <span className="text-[10px] font-normal text-outline">進階</span>
      </span>
    ) : (
      field.label
    )

  return (
    <div
      id={fieldAnchorId(id)}
      data-settings-field={id}
      className={`scroll-mt-24 transition-colors ${highlighted ? 'bg-accent-tint' : ''}`}
    >
      {children ? (
        <SettingsStack title={title} description={description ?? field.summary}>
          {children}
        </SettingsStack>
      ) : (
        <SettingsRow title={title} description={description ?? field.summary} control={control} />
      )}
    </div>
  )
}
