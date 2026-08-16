/**
 * zh-TW — source of truth。
 *
 * 規則：
 * 1. 這裡的文字**就是**目前畫面上的文字，逐字相同。遷入是搬家，不是改稿；
 *    任何潤飾都應該是獨立的一次改動，否則「視覺零 diff」就無從驗證。
 * 2. key 依「域.元件.用途」命名，讓語言檔可以被人讀懂與維護。
 * 3. 帶變數的字串用 `{param}` 內插，不要在呼叫端相接字串——語序會隨語言改變。
 *
 * 新增 key 一定要同時出現在使用點，否則 `smoke-i18n` 會以孤兒 key 讓 build 紅。
 */
export const zhTW = {
  // ── 外觀設定（ticket 01 的垂直切片）─────────────────────────────
  'settings.appearance.group.theme': '主題',
  'settings.appearance.group.tour': '導覽',
  'settings.appearance.group.fontSize': '字級',
  'settings.appearance.theme.label': '外觀主題',
  'settings.appearance.theme.summary': '深色、淺色或跟隨系統。',
  'settings.appearance.theme.dark': '深色',
  'settings.appearance.theme.light': '淺色',
  'settings.appearance.theme.system': '系統',
  'settings.appearance.reducedMotion.label': '減少動畫',
  'settings.appearance.reducedMotion.summary': '降低動效，或跟隨系統的減少動態偏好。',
  'settings.appearance.reducedMotion.on': '開啟',
  'settings.appearance.reducedMotion.off': '關閉',
  'settings.appearance.translucentSidebar.label': '側欄半透明',
  'settings.appearance.translucentSidebar.summary':
    '側欄改用半透明材質；在低效能機器上關掉可讓捲動更順。',
  'settings.appearance.tour.label': '重新執行使用導覽',
  'settings.appearance.tour.summary':
    '再看一次四個概念點：Loop Pattern、執行引擎、Approval Mode、誠實性。',
  'settings.appearance.tour.action': '重新導覽',
  'settings.appearance.uiFontSize.label': '介面字級',
  'settings.appearance.uiFontSize.summary': '整個介面的文字大小。',
  'settings.appearance.codeFontSize.label': '程式碼字級',
  'settings.appearance.codeFontSize.summary': '終端機、程式碼區塊與 diff 的等寬字大小。',

  // ── 介面語言（本系列新增的設定）─────────────────────────────────
  'settings.appearance.language.label': '介面語言',
  'settings.appearance.language.summary': '介面文字使用的語言；切換後立即生效，不需重新啟動。',
  'settings.appearance.language.system': '跟隨系統',
  'settings.appearance.language.zhTW': '繁體中文',
  'settings.appearance.language.en': 'English',

  // ── 設定頁外殼 ──────────────────────────────────────────────────
  'settings.view.showAdvanced': '顯示進階',
  'settings.view.basicHint': '基礎檢視：只顯示常用設定；進階參數仍在，值不受影響。',
  'settings.view.advancedHint': '進階檢視：工程參數與少用開關都在。',
  'settings.field.advancedBadge': '進階',
  'settings.search.placeholder': '搜尋設定（中英文皆可）',
  'settings.search.label': '搜尋設定',
  'settings.search.resultsLabel': '設定搜尋結果',
  'settings.search.empty': '沒有符合的設定。',
  'settings.footer.autoApply': '變更會立即套用，無需儲存。',
} as const
