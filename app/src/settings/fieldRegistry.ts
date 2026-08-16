/**
 * Settings field registry（ADR-0032 落實，spec 3/6 ticket 01）。
 *
 * 「誰看得到、怎麼被找到」是宣告出來的，不是寫死在畫面裡：每個設定欄位在這裡
 * 宣告所屬節、basic/advanced、中英文搜尋關鍵字、一句話說明與穩定錨點；渲染層
 * 只消費查詢結果。
 *
 * 這裡**不是**第二個 source of truth：值仍然只存在 settings（Pi 落地後為 Pi 的
 * runtime settings，ADR-0025）。registry 只描述呈現與可發現性。
 */
import { fuzzyMatch } from '../commands/registry.ts'
import { SETTINGS_SECTIONS } from '../commands/settingsSections.ts'

export type SettingsTier = 'basic' | 'advanced'

/** 條件可見性——以宣告表達，不在 panel 裡長 if 樹。 */
export type SettingsVisibility = 'always' | 'policyAdminBuild'

export type SettingsFieldDef = {
  /** 穩定錨點 id（`<section>.<field>`）；深連結與高亮都用它 */
  id: string
  /** SETTINGS_SECTIONS 的節 id */
  section: string
  /** 節內的卡片群組標題（沿用現行分組） */
  group?: string
  tier: SettingsTier
  label: string
  /** 一句話說明它調什麼——進階欄位必備，讓人敢調也知道何時調回去 */
  summary: string
  /** 中英文搜尋關鍵字（zh-TW + en） */
  keywords: string[]
  /**
   * 這個欄位讀寫的 settings key。
   * 動作列（例如「重新導覽」）沒有對應 key，留空陣列。
   * fail-closed 覆蓋率檢查以此對照 DEFAULT_LLM_SETTINGS。
   */
  settingsKeys: string[]
  visibility?: SettingsVisibility
}

/**
 * 已宣告的欄位。
 *
 * 目前只有外觀節走完整條路（ticket 01 的垂直切片）；其餘節由 ticket 03–05
 * 逐群補齊，過渡期列在 PENDING_SETTINGS_KEYS。
 */
export const SETTINGS_FIELDS: SettingsFieldDef[] = [
  {
    id: 'appearance.theme',
    section: 'appearance',
    group: '主題',
    tier: 'basic',
    label: '外觀主題',
    summary: '深色、淺色或跟隨系統。',
    keywords: ['主題', '深色', '淺色', '暗色', 'theme', 'dark', 'light', 'appearance'],
    settingsKeys: ['theme'],
  },
  {
    id: 'appearance.reducedMotion',
    section: 'appearance',
    group: '主題',
    tier: 'basic',
    label: '減少動畫',
    summary: '降低動效，或跟隨系統的減少動態偏好。',
    keywords: ['動畫', '動效', '減少動畫', 'motion', 'reduced motion', 'animation', 'a11y'],
    settingsKeys: ['reducedMotion'],
  },
  {
    id: 'appearance.translucentSidebar',
    section: 'appearance',
    group: '主題',
    tier: 'advanced',
    label: '側欄半透明',
    summary: '側欄改用半透明材質；在低效能機器上關掉可讓捲動更順。',
    keywords: ['側欄', '半透明', '毛玻璃', 'sidebar', 'translucent', 'glass', 'blur'],
    settingsKeys: ['translucentSidebar'],
  },
  {
    id: 'appearance.tour',
    section: 'appearance',
    group: '導覽',
    tier: 'basic',
    label: '重新執行使用導覽',
    summary: '再看一次四個概念點：Loop Pattern、執行引擎、Approval Mode、誠實性。',
    keywords: ['導覽', '教學', '新手', 'tour', 'onboarding', 'guide'],
    settingsKeys: [],
  },
  {
    id: 'appearance.uiFontSize',
    section: 'appearance',
    group: '字級',
    tier: 'basic',
    label: '介面字級',
    summary: '整個介面的文字大小。',
    keywords: ['字級', '字體大小', '字型大小', 'font size', 'ui font', 'text size'],
    settingsKeys: ['uiFontSize'],
  },
  {
    id: 'appearance.codeFontSize',
    section: 'appearance',
    group: '字級',
    tier: 'advanced',
    label: '程式碼字級',
    summary: '終端機、程式碼區塊與 diff 的等寬字大小。',
    keywords: ['程式碼字級', '等寬', '終端機字級', 'code font', 'monospace', 'terminal font'],
    settingsKeys: ['codeFontSize'],
  },
// ── 一般 ───────────────────────────────────────────────────────────
  {
    id: 'general.enterBehavior',
    section: 'general',
    group: '輸入與行為',
    tier: 'basic',
    label: '送出快捷鍵',
    summary: 'Enter 送出、或改成 Enter 換行而以 ⌘/Ctrl+Enter 送出。',
    keywords: ['送出', '快捷鍵', 'Enter', '換行', 'enter', 'send', 'shortcut', 'submit'],
    settingsKeys: ['enterBehavior'],
  },
  {
    id: 'general.followUpMode',
    section: 'general',
    group: '輸入與行為',
    tier: 'advanced',
    label: '執行中追問行為',
    summary: '任務執行中再輸入時：轉向目前任務，或排隊等它跑完。',
    keywords: ['追問', '排隊', '轉向', 'follow up', 'queue', 'steer', 'busy'],
    settingsKeys: ['followUpMode'],
  },
  {
    id: 'general.concurrentRunsEnabled',
    section: 'general',
    group: '輸入與行為',
    tier: 'advanced',
    label: '允許並行執行',
    summary: '預設一次只跑一個任務；開啟後可同時跑多個，較耗資源也較難追。',
    keywords: ['並行', '併行', '同時執行', 'concurrent', 'concurrency', 'parallel'],
    settingsKeys: ['concurrentRunsEnabled'],
  },
  {
    id: 'general.maxConcurrentRuns',
    section: 'general',
    group: '輸入與行為',
    tier: 'advanced',
    label: '並行上限',
    summary: '同時最多幾個任務在跑；調高會同時吃更多額度與 CPU。',
    keywords: ['並行上限', '併行上限', '同時數量', 'concurrency', 'max concurrent', 'limit'],
    settingsKeys: ['maxConcurrentRuns'],
  },
  {
    id: 'general.notifyOnComplete',
    section: 'general',
    group: '通知',
    tier: 'basic',
    label: '任務完成通知',
    summary: '任務結束時發系統通知。',
    keywords: ['通知', '完成通知', '提醒', 'notify', 'notification', 'complete'],
    settingsKeys: ['notifyOnComplete'],
  },
  {
    id: 'general.soundOnComplete',
    section: 'general',
    group: '通知',
    tier: 'basic',
    label: '完成提示音',
    summary: '任務結束時發出提示音。',
    keywords: ['提示音', '音效', '聲音', 'sound', 'chime', 'audio'],
    settingsKeys: ['soundOnComplete'],
  },
  {
    id: 'general.preventSleepWhileRunning',
    section: 'general',
    group: '通知',
    tier: 'advanced',
    label: '執行中防止睡眠',
    summary: '長任務執行期間阻止系統睡眠；跑完自動放開。',
    keywords: ['睡眠', '休眠', '待機', 'sleep', 'idle', 'power', 'keep awake'],
    settingsKeys: ['preventSleepWhileRunning'],
  },
  {
    id: 'general.ambientSuggestions',
    section: 'general',
    group: '建議',
    tier: 'basic',
    label: '建議提示',
    summary: '在對話中主動提出可自動化或可延伸的建議（僅提示，不會自己執行）。',
    keywords: ['建議', '提示', '主動', 'suggestion', 'ambient', 'hint'],
    settingsKeys: ['ambientSuggestions'],
  },

  // ── 個人化 ─────────────────────────────────────────────────────────
  {
    id: 'personalization.personality',
    section: 'personalization',
    group: '人格',
    tier: 'basic',
    label: '預設人格',
    summary: '回覆的預設語氣與風格。',
    keywords: ['人格', '語氣', '風格', 'personality', 'tone', 'style'],
    settingsKeys: ['personality'],
  },
  {
    id: 'personalization.customAboutUser',
    section: 'personalization',
    group: '自訂指令',
    tier: 'basic',
    label: '關於你',
    summary: '讓 agent 一直記得的背景資訊（職稱、慣用語言、專案脈絡）。',
    keywords: ['關於你', '個人資訊', '背景', 'about', 'about you', 'profile', 'context'],
    settingsKeys: ['customAboutUser'],
  },
  {
    id: 'personalization.customResponseStyle',
    section: 'personalization',
    group: '自訂指令',
    tier: 'basic',
    label: '希望如何回覆',
    summary: '固定的回覆偏好（長度、格式、要不要先給結論）。',
    keywords: ['回覆風格', '格式', '長度', 'response', 'style', 'format', 'instructions'],
    settingsKeys: ['customResponseStyle'],
  },

  // ── 記憶 ───────────────────────────────────────────────────────────
  {
    id: 'memory.memoryEnabled',
    section: 'memory',
    group: '記憶控制',
    tier: 'basic',
    label: '啟用記憶',
    summary: '讓 agent 跨對話記住你的偏好與專案脈絡。',
    keywords: ['記憶', '長期記憶', '記住', 'memory', 'remember', 'recall'],
    settingsKeys: ['memoryEnabled'],
  },
  {
    id: 'memory.memoryWriteEnabled',
    section: 'memory',
    group: '記憶控制',
    tier: 'advanced',
    label: '自動寫入',
    summary: '任務結束後自動把值得記的事寫進記憶；關掉就只能手動新增。',
    keywords: ['自動寫入', '記憶寫入', 'memory write', 'auto save', 'persist'],
    settingsKeys: ['memoryWriteEnabled'],
  },
  {
    id: 'memory.referenceChatHistory',
    section: 'memory',
    group: '記憶控制',
    tier: 'advanced',
    label: '參考對話歷史',
    summary: '回答時參考同一對話稍早的內容；關掉可讓每輪更獨立、也更省 token。',
    keywords: ['對話歷史', '上下文', '歷史', 'chat history', 'context', 'reference'],
    settingsKeys: ['referenceChatHistory'],
  },

  // ── 資料控制 ───────────────────────────────────────────────────────
  {
    id: 'data.temporaryChatDefault',
    section: 'data',
    group: '對話',
    tier: 'basic',
    label: '預設臨時對話',
    summary: '新對話預設不讀寫跨對話記憶。',
    keywords: ['臨時對話', '無痕', '不記憶', 'temporary', 'incognito', 'ephemeral'],
    settingsKeys: ['temporaryChatDefault'],
  },
  {
    id: 'data.autoArchiveDays',
    section: 'data',
    group: '對話',
    tier: 'advanced',
    label: '自動封存',
    summary: '幾天沒動的對話自動收進封存；設 0 表示不自動封存。',
    keywords: ['封存', '自動封存', '保留天數', 'archive', 'retention', 'cleanup'],
    settingsKeys: ['autoArchiveDays'],
  },

]

/**
 * 不屬於設定畫面的 settings key，附理由。
 *
 * 這些是 runtime 狀態或由專屬流程管理的資料，不該長成一列開關。列在這裡是為了
 * 讓覆蓋率檢查仍然 fail-closed：新增的 key 必須明確歸類，不能默默沒人管。
 */
export const NON_UI_SETTINGS_KEYS: Record<string, string> = {
  discoveredModels: '本機探索結果快取，由 CLI 診斷寫入',
  modelProfiles: '每個模型的能力事實與 provenance，由探針寫入',
  customToolSecrets: '憑證只存在 main process 的加密保管庫，畫面只見 metadata',
  pluginOAuthClients: '由外掛 OAuth 流程寫入，非手動欄位',
  trustedHookProjects: '由專案信任提示累積，非手動欄位',
  mcpAgentServers: '由 OpenCode agent 匯入推導，於 MCP 節整體呈現',
  delegatePersonas: '由 persona 管理流程維護',
  fallbackModels: '由語言模型節的模型清單流程維護',
}

/**
 * 尚未宣告的 settings key（過渡期）。
 *
 * ticket 03–05 逐群清空；ticket 05 收尾後這個陣列必須為空，fail-closed 才真正生效。
 */
export const PENDING_SETTINGS_KEYS: string[] = [
  'alwaysOnCapabilities',
  'apiKey',
  'apiProvider',
  'approvalMode',
  'authLevel',
  'baseUrl',
  'bashRequireAsk',
  'capabilitiesEnabled',
  'classificationAllowPlaintextHttp',
  'classificationEndpointUrl',
  'cliProviders',
  'codeModeEnabled',
  'customTools',
  'defaultContextWindowTokens',
  'enabled',
  'functionCalling',
  'gitBranchPrefix',
  'gitCommitInstructions',
  'gitCreateDraftPr',
  'gitForcePush',
  'gitPrInstructions',
  'haltOnPayloadOverflow',
  'hookRules',
  'llmCircuitBreakerEnabled',
  'llmParseEnabled',
  'llmRetryMaxAttempts',
  'maxIterationsDefault',
  'maxToolPayloadKb',
  'maxToolRounds',
  'mcpEnabled',
  'mcpServers',
  'minConfidence',
  'model',
  'outboundProtectionEnabled',
  'roleModels',
  'safetyEnabled',
  'sessionRecallEnabled',
  'subAgentsEnabled',
  'telegramAllowedChatIds',
  'telegramAutoRun',
  'telegramBotToken',
  'telegramEnabled',
  'telegramReplyWithResult',
  'toolSearchEnabled',
  'toolSearchThreshold',
  'toolsEnabled',
  'unattended',
  'webSearchEnabled',
  'webhookEnabled',
  'webhookPort',
  'webhookTarget',
  'webhookToken',
]

const FIELD_BY_ID = new Map(SETTINGS_FIELDS.map((field) => [field.id, field]))

export function getSettingsField(id: string): SettingsFieldDef | undefined {
  return FIELD_BY_ID.get(id)
}

/** 這個欄位在目前的 build 下是否存在（與 tier 無關）。 */
export function fieldIsAvailable(
  field: SettingsFieldDef,
  ctx: { policyAdminBuild: boolean },
): boolean {
  if (field.visibility === 'policyAdminBuild') return ctx.policyAdminBuild
  return true
}

/**
 * 這個欄位現在該不該畫出來。
 *
 * basic 檢視只是少畫幾列——被隱藏的欄位值一個字都沒動，切換檢視不改變任何行為。
 */
export function fieldIsVisible(
  field: SettingsFieldDef,
  ctx: { showAdvanced: boolean; policyAdminBuild: boolean },
): boolean {
  if (!fieldIsAvailable(field, ctx)) return false
  return ctx.showAdvanced || field.tier === 'basic'
}

export function fieldsForSection(
  section: string,
  ctx: { showAdvanced: boolean; policyAdminBuild: boolean },
): SettingsFieldDef[] {
  return SETTINGS_FIELDS.filter(
    (field) => field.section === section && fieldIsVisible(field, ctx),
  )
}

/** 這個節在目前檢視下還有東西可看嗎（用來決定要不要列出該節）。 */
export function sectionHasVisibleFields(
  section: string,
  ctx: { showAdvanced: boolean; policyAdminBuild: boolean },
): boolean {
  // 尚未宣告欄位的節一律視為有內容——過渡期不能因為還沒登記就把整節藏起來。
  if (!SETTINGS_FIELDS.some((field) => field.section === section)) return true
  return fieldsForSection(section, ctx).length > 0
}

export type SettingsSearchHit = {
  field: SettingsFieldDef
  sectionLabel: string
}

/**
 * 設定搜尋：關鍵字、標籤與說明做模糊匹配（與 Command Palette 同一支實作）。
 *
 * 刻意不看 tier——進階欄位在 basic 檢視下仍然找得到，否則使用者會以為設定不存在。
 * 條件可見性（policy-admin build）仍然過濾，那是可見性而非分層。
 */
export function searchSettingsFields(
  query: string,
  ctx: { policyAdminBuild: boolean },
): SettingsSearchHit[] {
  const q = query.trim()
  if (!q) return []
  const sectionLabel = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s.label]))
  return SETTINGS_FIELDS.filter((field) => fieldIsAvailable(field, ctx))
    .filter(
      (field) =>
        fuzzyMatch(q, field.label) ||
        fuzzyMatch(q, field.summary) ||
        field.keywords.some((keyword) => fuzzyMatch(q, keyword)) ||
        fuzzyMatch(q, sectionLabel.get(field.section) || ''),
    )
    .map((field) => ({ field, sectionLabel: sectionLabel.get(field.section) || field.section }))
}

/**
 * 深連結／高亮用的 DOM 錨點 id。
 *
 * 點號一律換成連字號：`#setting-appearance.theme` 在 CSS 選擇器裡會被讀成
 * 「id=setting-appearance 且 class=theme」，querySelector 就永遠找不到它。
 */
export function fieldAnchorId(fieldId: string): string {
  return `setting-${fieldId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
