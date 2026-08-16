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

  // ── 組態（safety）───────────────────────────────────────────────────
  {
    id: 'safety.safetyEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'basic',
    label: '安全閘道',
    summary: '工具執行前的安全檢查與人工介入；關掉等於拿掉最後一道防線。',
    keywords: ['安全', '閘道', '防護', 'safety', 'guard', 'protection'],
    settingsKeys: ['safetyEnabled'],
  },
  {
    id: 'safety.toolsEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'basic',
    label: '代理工具',
    summary: '允許 agent 使用工具（讀寫檔案、執行指令、上網）。',
    keywords: ['工具', '代理工具', 'tools', 'tool use', 'enable tools'],
    settingsKeys: ['toolsEnabled'],
  },
  {
    id: 'safety.webSearchEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'basic',
    label: 'web_search',
    summary: '允許 agent 上網搜尋即時資訊。',
    keywords: ['網頁搜尋', '上網', '搜尋', 'web search', 'internet', 'browse'],
    settingsKeys: ['webSearchEnabled'],
  },
  {
    id: 'safety.functionCalling',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: 'Function Calling',
    summary: '由模型自己決定呼叫哪個工具；關掉會退回關鍵字挑工具的啟發式路徑。',
    keywords: ['函式呼叫', '工具迴圈', 'function calling', 'fc', 'tool loop'],
    settingsKeys: ['functionCalling'],
  },
  {
    id: 'safety.llmParseEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: 'LLM 任務解析',
    summary: '用模型精煉任務計畫與驗收標準；關掉只用啟發式解析，較快但較粗。',
    keywords: ['任務解析', '計畫', '解析', 'parse', 'planning', 'llm parse'],
    settingsKeys: ['llmParseEnabled'],
  },
  {
    id: 'safety.sessionRecallEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: '跨 Session 召回',
    summary: '把先前 session 的相關片段帶進這次的上下文；會增加 token 用量。',
    keywords: ['召回', '跨對話', '上下文', 'recall', 'session', 'retrieval'],
    settingsKeys: ['sessionRecallEnabled'],
  },
  {
    id: 'safety.capabilitiesEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: 'Capability 漸進披露',
    summary: '工具先收在能力包裡、模型要用才載入；關掉會一次把所有工具塞進提示。',
    keywords: ['能力', '漸進披露', '能力包', 'capability', 'progressive disclosure'],
    settingsKeys: ['capabilitiesEnabled'],
  },
  {
    id: 'safety.alwaysOnCapabilities',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: '常駐能力包',
    summary: '這些能力包不等模型呼叫就先載入；設太多會吃掉提示空間。',
    keywords: ['常駐能力', '預載', '能力包', 'always on', 'capabilities', 'preload'],
    settingsKeys: ['alwaysOnCapabilities'],
  },
  {
    id: 'safety.toolSearchEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: 'Tool Search',
    summary: '工具太多時先藏起來，讓模型用搜尋找出需要的那幾個。',
    keywords: ['工具搜尋', '工具太多', 'tool search', 'discovery'],
    settingsKeys: ['toolSearchEnabled'],
  },
  {
    id: 'safety.toolSearchThreshold',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: 'Tool Search 門檻',
    summary: '可見工具數超過這個門檻才啟動工具搜尋；調低會更早開始隱藏工具。',
    keywords: ['工具門檻', '工具數量', 'tool search threshold', 'threshold'],
    settingsKeys: ['toolSearchThreshold'],
  },
  {
    id: 'safety.codeModeEnabled',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: 'CodeMode（run_code）',
    summary: '允許模型在沙盒 worker 裡跑自己寫的 JS 來串接多個工具；網路已封鎖。',
    keywords: ['程式碼模式', '沙盒', 'code mode', 'run_code', 'sandbox'],
    settingsKeys: ['codeModeEnabled'],
  },
  {
    id: 'safety.haltOnPayloadOverflow',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: '輸出超限中止',
    summary: '工具輸出超過上限時直接中止任務，而不是截斷後繼續。',
    keywords: ['超限', '中止', '輸出上限', 'overflow', 'halt', 'payload'],
    settingsKeys: ['haltOnPayloadOverflow'],
  },
  {
    id: 'safety.customTools',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'advanced',
    label: '自訂工具',
    summary: '自己定義的 HTTP／指令工具；每個都會經過同一套核准與稽核。',
    keywords: ['自訂工具', '工具定義', 'custom tools', 'http tool', 'template'],
    settingsKeys: ['customTools'],
  },
  {
    id: 'safety.approvalMode',
    section: 'safety',
    group: '核准與沙盒',
    tier: 'basic',
    label: '核准模式',
    summary: '什麼時候要問你：一律先問、只在有風險時問、或全部放行。',
    keywords: ['核准', '權限', '詢問', 'approval', 'permission', 'ask'],
    settingsKeys: ['approvalMode'],
  },
  {
    id: 'safety.authLevel',
    section: 'safety',
    group: '門檻',
    tier: 'advanced',
    label: '授權等級',
    summary: 'agent 可以自己做到哪裡；調高會減少中途詢問，也降低你的介入點。',
    keywords: ['授權', '等級', '權限層級', 'auth level', 'autonomy', 'permission'],
    settingsKeys: ['authLevel'],
  },
  {
    id: 'safety.minConfidence',
    section: 'safety',
    group: '門檻',
    tier: 'advanced',
    label: '最低信心度',
    summary: '低於這個信心就不算完成，會再迭代；調太高會讓任務一直跑不完。',
    keywords: ['信心', '信心度', '門檻', 'confidence', 'threshold', 'min confidence'],
    settingsKeys: ['minConfidence'],
  },
  {
    id: 'safety.maxIterationsDefault',
    section: 'safety',
    group: '門檻',
    tier: 'advanced',
    label: '預設最大迭代',
    summary: '目標迴圈最多重試幾輪；調高更可能達標，也更花時間與額度。',
    keywords: ['迭代', '輪數', '最大迭代', 'iterations', 'max iterations', 'loop'],
    settingsKeys: ['maxIterationsDefault'],
  },
  {
    id: 'safety.maxToolPayloadKb',
    section: 'safety',
    group: '門檻',
    tier: 'advanced',
    label: '工具輸出上限',
    summary: '單次工具輸出可佔的位元組上限；調太小會讓長輸出被截斷。',
    keywords: ['工具輸出', '上限', '位元組', 'payload', 'kb', 'limit'],
    settingsKeys: ['maxToolPayloadKb'],
  },
  {
    id: 'safety.maxToolRounds',
    section: 'safety',
    group: '門檻',
    tier: 'advanced',
    label: 'FC 最大輪數',
    summary: '一個步驟裡最多來回呼叫工具幾輪；調低可避免鑽牛角尖，也可能做不完。',
    keywords: ['工具輪數', '回合', 'tool rounds', 'max rounds', 'fc'],
    settingsKeys: ['maxToolRounds'],
  },
  {
    id: 'safety.llmRetryMaxAttempts',
    section: 'safety',
    group: 'LLM 韌性',
    tier: 'advanced',
    label: '重試次數',
    summary: '模型呼叫失敗時重試幾次；調高更耐斷線，失敗時也更慢才放棄。',
    keywords: ['重試', '次數', '韌性', 'retry', 'attempts', 'resilience'],
    settingsKeys: ['llmRetryMaxAttempts'],
  },
  {
    id: 'safety.llmCircuitBreakerEnabled',
    section: 'safety',
    group: 'LLM 韌性',
    tier: 'advanced',
    label: 'Circuit breaker',
    summary: '連續失敗時暫時停止打模型，避免一直撞同一道牆。',
    keywords: ['斷路器', '熔斷', '保護', 'circuit breaker', 'backoff'],
    settingsKeys: ['llmCircuitBreakerEnabled'],
  },
  {
    id: 'safety.defaultContextWindowTokens',
    section: 'safety',
    group: 'LLM 韌性',
    tier: 'advanced',
    label: '預設 context window',
    summary: '模型沒回報上下文長度時採用的預設值；設錯會讓壓縮過早或太晚。',
    keywords: ['上下文', '長度', 'token', 'context window', 'tokens'],
    settingsKeys: ['defaultContextWindowTokens'],
  },
  {
    id: 'safety.hookRules',
    section: 'safety',
    group: '專案 Hooks 信任',
    tier: 'advanced',
    label: 'Hook 規則',
    summary: '生命週期規則（拒絕／要求核准／附加脈絡）；只能收緊，不能放寬。',
    keywords: ['hook', '規則', '生命週期', 'hooks', 'rules', 'lifecycle'],
    settingsKeys: ['hookRules'],
  },
  {
    id: 'safety.trustedHookProjects',
    section: 'safety',
    group: '專案 Hooks 信任',
    tier: 'advanced',
    label: '信任目前專案',
    summary: '信任後才會採用該專案自帶的 hook 規則。',
    keywords: ['信任', '專案', 'hooks', 'trust', 'project', 'trusted'],
    settingsKeys: ['trustedHookProjects'],
  },
  // ── 語言模型 ───────────────────────────────────────────────────────
  {
    id: 'llm.enabled',
    section: 'llm',
    group: '連線',
    tier: 'basic',
    label: '啟用 LLM',
    summary: '關閉時任務以模擬模式執行，不會真的呼叫模型。',
    keywords: ['啟用', '語言模型', '模型', 'llm', 'enable', 'model'],
    settingsKeys: ['enabled'],
  },
  {
    id: 'llm.apiProvider',
    section: 'llm',
    group: '連線',
    tier: 'basic',
    label: 'API 供應商',
    summary: '要連到哪一家 OpenAI 相容服務。',
    keywords: ['供應商', '服務商', 'provider', 'api provider', 'vendor'],
    settingsKeys: ['apiProvider'],
  },
  {
    id: 'llm.apiKey',
    section: 'llm',
    group: '連線',
    tier: 'basic',
    label: 'API Key',
    summary: '呼叫模型用的憑證，只存在本機。',
    keywords: ['金鑰', '憑證', 'api key', 'key', 'token', 'credential'],
    settingsKeys: ['apiKey'],
  },
  {
    id: 'llm.baseUrl',
    section: 'llm',
    group: '連線',
    tier: 'advanced',
    label: 'Base URL',
    summary: 'OpenAI 相容端點位址；自架或代理服務才需要改。',
    keywords: ['端點', '網址', '代理', 'base url', 'endpoint', 'host'],
    settingsKeys: ['baseUrl'],
  },
  {
    id: 'llm.model',
    section: 'llm',
    group: '連線',
    tier: 'basic',
    label: '預設模型',
    summary: '沒有另外指定時使用的模型。',
    keywords: ['模型', '預設模型', 'model', 'default model'],
    settingsKeys: ['model'],
  },
  // ── 角色模型 ───────────────────────────────────────────────────────
  {
    id: 'roles.roleModels',
    section: 'roles',
    tier: 'advanced',
    label: '各角色模型',
    summary: '替 Manager／Analyzer／Writer／Core 指定不同模型，貴的只用在需要的角色。',
    keywords: ['角色', '模型指派', '子代理', 'role models', 'roles', 'assignment'],
    settingsKeys: ['roleModels'],
  },
  {
    id: 'roles.subAgentsEnabled',
    section: 'roles',
    tier: 'advanced',
    label: '啟用 Sub Agent',
    summary: '允許把子任務分派給子代理；關掉則全部由主代理自己做。',
    keywords: ['子代理', '分派', 'sub agent', 'delegate', 'subagents'],
    settingsKeys: ['subAgentsEnabled'],
  },
  {
    id: 'roles.outboundProtectionEnabled',
    section: 'roles',
    tier: 'advanced',
    label: '出站資料閘門',
    summary: '送往模型前先過濾受保護內容；此開關的可用性依 build flavor 而定。',
    keywords: ['出站', '資料閘門', '外洩防護', 'outbound', 'egress', 'protection', 'dlp'],
    settingsKeys: ['outboundProtectionEnabled'],
  },
  {
    id: 'roles.classificationEndpointUrl',
    section: 'roles',
    tier: 'advanced',
    label: 'Classification endpoint',
    summary: '公司分類服務位址；出站閘門用它判定受保護內容。',
    keywords: ['分類', '端點', '公司政策', 'classification', 'endpoint', 'classifier'],
    settingsKeys: ['classificationEndpointUrl'],
  },
  {
    id: 'roles.classificationAllowPlaintextHttp',
    section: 'roles',
    tier: 'advanced',
    label: '允許 plaintext HTTP classifier',
    summary: '允許以未加密 HTTP 連分類服務；僅限本機或受控網路。',
    keywords: ['明文', 'HTTP', '未加密', 'plaintext', 'insecure', 'classifier'],
    settingsKeys: ['classificationAllowPlaintextHttp'],
  },
  // ── CLI 授權 ───────────────────────────────────────────────────────
  {
    id: 'cli.bashRequireAsk',
    section: 'cli',
    group: '安全',
    tier: 'advanced',
    label: 'bash 一律核准',
    summary: '每個 shell 指令都先問你，即使允許規則已涵蓋。',
    keywords: ['bash', '指令', '核准', 'shell', 'approval', 'command'],
    settingsKeys: ['bashRequireAsk'],
  },
  {
    id: 'cli.cliProviders',
    section: 'cli',
    group: '廠商',
    tier: 'basic',
    label: 'CLI 授權',
    summary: '啟用並授權本機 CLI（Codex／Claude／Gemini…）作為執行引擎。',
    keywords: ['CLI', '授權', '執行引擎', 'cli', 'providers', 'authorize'],
    settingsKeys: ['cliProviders'],
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
  mcpAgentServers: '由 OpenCode agent 匯入推導，於 MCP 節整體呈現',
  delegatePersonas: '由 persona 管理流程維護',
  unattended: '每次 run 由來源決定（自動化來源自動為無人值守），設定畫面不提供全域開關',
  fallbackModels: '由語言模型節的模型清單流程維護',
}

/**
 * 尚未宣告的 settings key（過渡期）。
 *
 * ticket 03–05 逐群清空；ticket 05 收尾後這個陣列必須為空，fail-closed 才真正生效。
 */
export const PENDING_SETTINGS_KEYS: string[] = [
  'gitBranchPrefix',
  'gitCommitInstructions',
  'gitCreateDraftPr',
  'gitForcePush',
  'gitPrInstructions',
  'mcpEnabled',
  'mcpServers',
  'telegramAllowedChatIds',
  'telegramAutoRun',
  'telegramBotToken',
  'telegramEnabled',
  'telegramReplyWithResult',
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
