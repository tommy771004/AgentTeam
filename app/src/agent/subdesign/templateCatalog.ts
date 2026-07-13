import type { SubDesignSurface } from './types'
import type { OpenDesignCatalogRecord } from '../openDesign/catalog'

export type SubDesignTemplateCategory =
  | 'all'
  | 'prototype'
  | 'live-artifact'
  | 'deck'
  | 'image'
  | 'video'
  | 'hyperframes'
  | 'audio'

export type SubDesignTemplateAvailability = 'ready' | 'requires-capability'

export type SubDesignTemplate = {
  id: string
  title: string
  summary: string
  category: Exclude<SubDesignTemplateCategory, 'all'>
  surface?: SubDesignSurface
  icon: string
  suggestedObjective: string
  sourcePath: string
  availability: SubDesignTemplateAvailability
}

export const OPEN_DESIGN_TEMPLATE_SOURCE = 'https://open-design.ai/zh/plugins/templates/'

/** Upstream counts; source and assets live in app/public/open-design/. */
export const SUBDESIGN_TEMPLATE_CATEGORIES: ReadonlyArray<{
  id: SubDesignTemplateCategory
  label: string
  upstreamCount: number
}> = [
  { id: 'all', label: '全部', upstreamCount: 288 },
  { id: 'prototype', label: '原型', upstreamCount: 82 },
  { id: 'live-artifact', label: '即時產物', upstreamCount: 5 },
  { id: 'deck', label: '簡報', upstreamCount: 80 },
  { id: 'image', label: '圖像', upstreamCount: 46 },
  { id: 'video', label: '影片', upstreamCount: 49 },
  { id: 'hyperframes', label: 'HyperFrames', upstreamCount: 25 },
  { id: 'audio', label: '音訊', upstreamCount: 1 },
]

export const SUBDESIGN_TEMPLATES: readonly SubDesignTemplate[] = [
  {
    id: 'web-prototype', title: '網站原型', summary: '從首頁與主視覺開始建立可回應的介面。',
    category: 'prototype', surface: 'prototype', icon: 'web',
    suggestedObjective: '設計一個產品首頁與核心使用流程。', sourcePath: 'design-templates/web-prototype', availability: 'ready',
  },
  {
    id: 'saas-landing', title: 'SaaS Landing', summary: '主視覺、功能、方案與 CTA 的行銷頁。',
    category: 'prototype', surface: 'prototype', icon: 'campaign',
    suggestedObjective: '設計一個 SaaS 產品的行銷首頁。', sourcePath: 'design-templates/saas-landing', availability: 'ready',
  },
  {
    id: 'dashboard', title: '營運儀表板', summary: '帶側欄、KPI 與分析圖表的操作介面。',
    category: 'prototype', surface: 'dashboard', icon: 'dashboard',
    suggestedObjective: '設計一個供團隊日常決策使用的營運儀表板。', sourcePath: 'design-templates/dashboard', availability: 'ready',
  },
  {
    id: 'mobile-app', title: '行動 App', summary: '以行動裝置情境呈現的產品介面。',
    category: 'prototype', surface: 'prototype', icon: 'phone_iphone',
    suggestedObjective: '設計一個行動 App 的核心任務流程。', sourcePath: 'design-templates/mobile-app', availability: 'ready',
  },
  {
    id: 'mobile-onboarding', title: '行動 Onboarding', summary: '啟動、價值主張與登入的引導流程。',
    category: 'prototype', surface: 'prototype', icon: 'rocket_launch',
    suggestedObjective: '設計一個讓新使用者快速理解價值的行動 onboarding。', sourcePath: 'design-templates/mobile-onboarding', availability: 'ready',
  },
  {
    id: 'email-marketing', title: '行銷 Email', summary: '兼顧品牌表現與 table fallback 的信件版型。',
    category: 'prototype', surface: 'prototype', icon: 'mail',
    suggestedObjective: '設計一封可交付開發的產品行銷 Email。', sourcePath: 'design-templates/email-marketing', availability: 'ready',
  },
  {
    id: 'docs-page', title: '文件頁面', summary: '有清楚導覽與內容節奏的產品文件。',
    category: 'prototype', surface: 'prototype', icon: 'description',
    suggestedObjective: '設計一個易於閱讀與搜尋的產品文件頁。', sourcePath: 'design-templates/docs-page', availability: 'ready',
  },
  {
    id: 'blog-post', title: '文章頁面', summary: '支援長文閱讀、摘要與延伸內容的版型。',
    category: 'prototype', surface: 'prototype', icon: 'article',
    suggestedObjective: '設計一個兼顧閱讀節奏與轉換的文章頁。', sourcePath: 'design-templates/blog-post', availability: 'ready',
  },
  {
    id: 'pm-spec', title: 'PM Spec', summary: '含目錄、決策紀錄與交付條件的規格頁。',
    category: 'prototype', surface: 'prototype', icon: 'assignment',
    suggestedObjective: '整理一份可供產品與工程協作的功能規格。', sourcePath: 'design-templates/pm-spec', availability: 'ready',
  },
  {
    id: 'team-okrs', title: '團隊 OKR', summary: '以目標、關鍵成果與進度呈現的 scorecard。',
    category: 'prototype', surface: 'dashboard', icon: 'track_changes',
    suggestedObjective: '設計一個讓團隊檢視 OKR 進度的工作台。', sourcePath: 'design-templates/team-okrs', availability: 'ready',
  },
  {
    id: 'eng-runbook', title: '工程 Runbook', summary: '事件應變步驟、責任與狀態的操作文件。',
    category: 'prototype', surface: 'prototype', icon: 'engineering',
    suggestedObjective: '設計一份工程事故應變 runbook。', sourcePath: 'design-templates/eng-runbook', availability: 'ready',
  },
  {
    id: 'finance-report', title: '財務摘要', summary: '讓管理者快速掌握核心數字與趨勢。',
    category: 'prototype', surface: 'dashboard', icon: 'query_stats',
    suggestedObjective: '設計一份供管理階層閱讀的財務摘要。', sourcePath: 'design-templates/finance-report', availability: 'ready',
  },
  {
    id: 'live-dashboard', title: '即時儀表板', summary: '以持續更新的資料與狀態為核心的工作台。',
    category: 'live-artifact', surface: 'dashboard', icon: 'monitoring',
    suggestedObjective: '設計一個即時更新、能協助決策的資料儀表板。', sourcePath: 'design-templates/live-dashboard', availability: 'ready',
  },
  {
    id: 'live-artifact', title: '互動 Artifact', summary: '將資訊、控制與即時回饋整合成單一介面。',
    category: 'live-artifact', surface: 'dashboard', icon: 'bolt',
    suggestedObjective: '設計一個讓使用者操作並即時取得回饋的 artifact。', sourcePath: 'design-templates/live-artifact', availability: 'ready',
  },
  {
    id: 'flowai-live-dashboard', title: 'Flow 資料看板', summary: '著重工作流、狀態與資料流的即時可視化。',
    category: 'live-artifact', surface: 'dashboard', icon: 'account_tree',
    suggestedObjective: '設計一個呈現工作流狀態與瓶頸的即時看板。', sourcePath: 'design-templates/flowai-live-dashboard-template', availability: 'ready',
  },
  {
    id: 'github-dashboard', title: 'GitHub 看板', summary: '以 PR、issue 與交付節奏為主的團隊視圖。',
    category: 'live-artifact', surface: 'dashboard', icon: 'code',
    suggestedObjective: '設計一個讓團隊追蹤 GitHub 交付狀態的看板。', sourcePath: 'design-templates/github-dashboard', availability: 'ready',
  },
  {
    id: 'worker-visualizer', title: 'Worker 視覺化', summary: '將背景任務、佇列與處理狀態轉成可理解的圖像。',
    category: 'live-artifact', surface: 'dashboard', icon: 'hub',
    suggestedObjective: '設計一個可視化背景任務與佇列健康度的看板。', sourcePath: 'design-templates/worker-visualizer', availability: 'ready',
  },
  {
    id: 'guizang-ppt', title: '雜誌式簡報', summary: '以編輯節奏與橫向瀏覽呈現有個性的敘事。',
    category: 'deck', surface: 'deck', icon: 'auto_stories',
    suggestedObjective: '製作一份具有鮮明觀點的品牌或產品簡報。', sourcePath: 'design-templates/guizang-ppt', availability: 'ready',
  },
  {
    id: 'html-ppt-pitch-deck', title: 'Pitch Deck', summary: '將問題、方案、成果與下一步整理成提案敘事。',
    category: 'deck', surface: 'deck', icon: 'slideshow',
    suggestedObjective: '製作一份清楚說明產品價值與商業機會的 pitch deck。', sourcePath: 'design-templates/html-ppt-pitch-deck', availability: 'ready',
  },
  {
    id: 'weekly-update', title: '週報更新', summary: '用進度、風險、數字和下一步快速對齊團隊。',
    category: 'deck', surface: 'deck', icon: 'calendar_view_week',
    suggestedObjective: '製作一份供團隊同步使用的每週進度簡報。', sourcePath: 'design-templates/weekly-update', availability: 'ready',
  },
  {
    id: 'simple-deck', title: '簡潔簡報', summary: '以清楚層級承載報告、教學或產品說明。',
    category: 'deck', surface: 'deck', icon: 'view_carousel',
    suggestedObjective: '製作一份內容清楚、可直接交付的簡潔簡報。', sourcePath: 'design-templates/simple-deck', availability: 'ready',
  },
  {
    id: 'kami-deck', title: 'Kami Deck', summary: '紙感排版與墨藍色調的專業敘事簡報。',
    category: 'deck', surface: 'deck', icon: 'menu_book',
    suggestedObjective: '製作一份帶有紙本閱讀節奏的專業簡報。', sourcePath: 'design-templates/kami-deck', availability: 'ready',
  },
  {
    id: 'image-poster', title: '海報圖像', summary: '單張視覺主導的宣傳或活動素材。',
    category: 'image', icon: 'image', suggestedObjective: '建立一張用於活動宣傳的主視覺海報。',
    sourcePath: 'design-templates/image-poster', availability: 'requires-capability',
  },
  {
    id: 'social-carousel', title: '社群輪播圖', summary: '以多張 1:1 卡片組成可滑動的內容敘事。',
    category: 'image', icon: 'collections', suggestedObjective: '建立一組適合社群發布的輪播圖。',
    sourcePath: 'design-templates/social-carousel', availability: 'requires-capability',
  },
  {
    id: 'video-shortform', title: '短影音', summary: '為短篇內容預先安排節奏、字幕與畫面段落。',
    category: 'video', icon: 'movie', suggestedObjective: '規劃一支用於社群發布的短影音。',
    sourcePath: 'design-templates/video-shortform', availability: 'requires-capability',
  },
  {
    id: 'hyperframes', title: 'HyperFrames 動態圖像', summary: '以 HTML、CSS 與動畫組成可渲染的 motion graphic。',
    category: 'hyperframes', icon: 'animation', suggestedObjective: '規劃一段產品功能的動態圖像。',
    sourcePath: 'design-templates/hyperframes', availability: 'requires-capability',
  },
  {
    id: 'audio-jingle', title: '品牌 Jingle', summary: '為短片或產品體驗設定短篇品牌聲音。',
    category: 'audio', icon: 'graphic_eq', suggestedObjective: '規劃一段用於品牌識別的短篇音訊。',
    sourcePath: 'design-templates/audio-jingle', availability: 'requires-capability',
  },
]

export function findSubDesignTemplate(id: string | undefined): SubDesignTemplate | undefined {
  return SUBDESIGN_TEMPLATES.find((template) => template.id === id)
}

const CATEGORY_LABELS: Record<string, SubDesignTemplateCategory> = {
  prototype: 'prototype',
  dashboard: 'live-artifact',
  deck: 'deck',
  image: 'image',
  video: 'video',
  hyperframes: 'hyperframes',
  audio: 'audio',
}

const CATEGORY_ICONS: Record<string, string> = {
  prototype: 'web',
  dashboard: 'dashboard',
  deck: 'slideshow',
  image: 'image',
  video: 'movie',
  hyperframes: 'animation',
  audio: 'graphic_eq',
}

export function openDesignRecordToTemplate(record: OpenDesignCatalogRecord): SubDesignTemplate {
  const category = CATEGORY_LABELS[record.category] || (record.kind === 'template' ? 'prototype' : 'prototype')
  const surface: SubDesignSurface | undefined = record.surface || (
    category === 'deck' ? 'deck' :
      category === 'live-artifact' ? 'dashboard' :
        category === 'prototype' ? 'prototype' : undefined
  )
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    category: category as Exclude<SubDesignTemplateCategory, 'all'>,
    surface,
    icon: CATEGORY_ICONS[record.category] || 'extension',
    suggestedObjective: surface === 'deck' ? '製作一份可交付的敘事簡報。' : '建立一個可驗證、可交付的設計產物。',
    sourcePath: record.sourcePath,
    availability: record.executionStatus === 'ready' && Boolean(surface) ? 'ready' : 'requires-capability',
  }
}
