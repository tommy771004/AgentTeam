import type { SubDesignSurface } from './types.ts'
import type { OpenDesignCatalogRecord } from '../openDesign/catalog.ts'

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
export type SubDesignTemplateCollection = 'explore' | 'all'

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
export const OPEN_DESIGN_EXPLORE_SOURCE = 'https://open-design.ai/zh/plugins/'

/**
 * Ordered to match the official 「探索全部資源」 collection. These are stable
 * catalog references only; the OpenDesign inventory remains the source of
 * truth for template content and provenance.
 */
export const OPEN_DESIGN_EXPLORE_TEMPLATE_IDS = [
  'plugins:_official:examples:fs-editorial-forest',
  'plugins:_official:examples:webgl-aurora-veil',
  'plugins:_official:examples:blog-post',
  'plugins:_official:video-templates:frame-bold-poster',
  'plugins:_official:video-templates:frame-bold-signal',
  'plugins:_official:examples:html-ppt-testing-safety-alert',
  'plugins:_official:examples:html-ppt',
  'plugins:_official:examples:huashu-takram-soft-tech',
  'plugins:_official:examples:html-ppt-zhangzara-neo-grid-bold',
  'plugins:_official:examples:html-ppt-course-module',
  'plugins:_official:examples:huashu-pentagram-grid',
  'plugins:_official:examples:html-ppt-zhangzara-studio',
  'plugins:_official:examples:html-ppt-zhangzara-editorial-tri-tone',
  'plugins:_official:video-templates:frame-build-minimal',
  'plugins:_official:examples:webgl-caustic-pool',
  'plugins:_official:examples:clinical-case-report',
  'plugins:_official:examples:codex-interactive-capability-map',
  'plugins:_official:video-templates:frame-creative-voltage',
  'plugins:_official:examples:critique',
  'plugins:_official:examples:html-ppt-zhangzara-biennale-yellow',
  'plugins:_official:examples:dashboard',
  'plugins:_official:video-templates:frame-data-rollup',
  'plugins:_official:examples:dating-web',
  'plugins:_official:examples:dcf-valuation',
] as const

/**
 * The OpenDesign catalog (agent/openDesign/catalog.ts) is the single source of
 * truth for templates — see docs/adr/0001-opendesign-catalog-is-source-of-truth.md.
 * Curated entries carry a template.json manifest under app/public/open-design
 * so they get rich title/summary/icon instead of the generic vendor fallback.
 */
export const SUBDESIGN_TEMPLATE_CATEGORIES: ReadonlyArray<{
  id: SubDesignTemplateCategory
  label: string
}> = [
  { id: 'all', label: '全部' },
  { id: 'prototype', label: '原型' },
  { id: 'live-artifact', label: '即時產物' },
  { id: 'deck', label: '簡報' },
  { id: 'image', label: '圖像' },
  { id: 'video', label: '影片' },
  { id: 'hyperframes', label: 'HyperFrames' },
  { id: 'audio', label: '音訊' },
]

const CATEGORY_LABELS: Record<string, Exclude<SubDesignTemplateCategory, 'all'>> = {
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
  const category = CATEGORY_LABELS[record.category] || 'prototype'
  const surface: SubDesignSurface | undefined = record.surface || (
    category === 'deck' ? 'deck' :
      category === 'live-artifact' ? 'dashboard' :
        category === 'prototype' ? 'prototype' :
          category === 'video' ? 'video' : undefined
  )
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    category,
    surface,
    icon: record.icon || CATEGORY_ICONS[record.category] || 'extension',
    suggestedObjective: record.suggestedObjective || (surface === 'deck' ? '製作一份可交付的敘事簡報。' : '建立一個可驗證、可交付的設計產物。'),
    sourcePath: record.sourcePath,
    availability: record.executionStatus === 'ready' && Boolean(surface) ? 'ready' : 'requires-capability',
  }
}

export function getOpenDesignExploreTemplates(
  templates: readonly SubDesignTemplate[],
): SubDesignTemplate[] {
  const byId = new Map(templates.map((template) => [template.id, template]))
  return OPEN_DESIGN_EXPLORE_TEMPLATE_IDS
    .map((id) => byId.get(id))
    .filter((template): template is SubDesignTemplate => Boolean(template))
}

// Populated by SubDesignPage once the OpenDesign catalog loads, so prompt.ts
// (which needs a synchronous lookup) can resolve a template by id without
// re-fetching the catalog itself.
let templateCache: SubDesignTemplate[] = []

export function setSubDesignTemplateCache(templates: readonly SubDesignTemplate[]): void {
  templateCache = [...templates]
}

export function findSubDesignTemplate(id: string | undefined): SubDesignTemplate | undefined {
  if (!id) return undefined
  return templateCache.find((template) => template.id === id)
}
