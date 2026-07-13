/**
 * Open Design content is vendor data, never executable instructions.
 * The inventory is generated offline from app/public/open-design and loaded by
 * the renderer as a small, digestable catalog.  Keep this module free of Node
 * APIs so the browser preview and Electron renderer share the same parser.
 */

export const OPEN_DESIGN_INVENTORY_VERSION = 1
export const OPEN_DESIGN_UPSTREAM_COMMIT = '4567a0d'
export const OPEN_DESIGN_SOURCE_URL = 'https://open-design.ai/zh/plugins/'

export type OpenDesignCatalogKind = 'template' | 'skill' | 'design-system' | 'prompt' | 'craft' | 'media'
export type OpenDesignExecutionStatus = 'ready' | 'content-only' | 'invalid'

export type OpenDesignProvenance = {
  source: 'open-design'
  recordId?: string
  title?: string
  sourcePath?: string
  sourceUrl: string
  upstreamCommit: string
  digest: string
  licensePaths: string[]
  indexedAt: string
}

export type OpenDesignCatalogRecord = OpenDesignProvenance & {
  id: string
  kind: OpenDesignCatalogKind
  category: string
  title: string
  summary: string
  sourcePath: string
  assetPaths: string[]
  entryPaths: string[]
  tags: string[]
  surface?: 'prototype' | 'dashboard' | 'design-system' | 'deck'
  executionStatus: OpenDesignExecutionStatus
  parseWarnings: string[]
}

export type OpenDesignCatalogIndex = {
  version: typeof OPEN_DESIGN_INVENTORY_VERSION
  generatedAt: string
  upstreamCommit: string
  sourceUrl: string
  records: OpenDesignCatalogRecord[]
  warnings: string[]
}

const MAX_RECORDS = 2500
const MAX_TEXT = 2400
const MAX_TAGS = 32

function cleanText(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanPath(value: unknown): string {
  const path = cleanText(value, 500).replaceAll('\\', '/')
  if (!path || path.startsWith('/') || path.includes('\0') || path.includes('../') || path.includes('/..')) {
    return ''
  }
  return path.replace(/^\.\//, '')
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => cleanText(item, 80)).filter(Boolean))].slice(0, MAX_TAGS)
}

function normalizeRecord(value: unknown, _index: number): OpenDesignCatalogRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = cleanText(raw.id, 160)
  const sourcePath = cleanPath(raw.sourcePath)
  const kind = raw.kind
  if (!id || !sourcePath || !['template', 'skill', 'design-system', 'prompt', 'craft', 'media'].includes(String(kind))) {
    return null
  }
  const status = ['ready', 'content-only', 'invalid'].includes(String(raw.executionStatus))
    ? (String(raw.executionStatus) as OpenDesignExecutionStatus)
    : 'content-only'
  const surface = ['prototype', 'dashboard', 'design-system', 'deck'].includes(String(raw.surface))
    ? (String(raw.surface) as OpenDesignCatalogRecord['surface'])
    : undefined
  return {
    source: 'open-design',
    sourceUrl: cleanText(raw.sourceUrl, 500) || OPEN_DESIGN_SOURCE_URL,
    upstreamCommit: cleanText(raw.upstreamCommit, 80) || OPEN_DESIGN_UPSTREAM_COMMIT,
    digest: cleanText(raw.digest, 128),
    licensePaths: Array.isArray(raw.licensePaths) ? raw.licensePaths.map(cleanPath).filter(Boolean).slice(0, 32) : [],
    indexedAt: cleanText(raw.indexedAt, 40),
    id: id.slice(0, 160),
    kind: kind as OpenDesignCatalogKind,
    category: cleanText(raw.category, 80) || 'other',
    title: cleanText(raw.title, 180) || id,
    summary: cleanText(raw.summary, 1000) || 'Open Design vendor content；目前僅可作為受治理的內容參考。',
    sourcePath,
    assetPaths: Array.isArray(raw.assetPaths) ? raw.assetPaths.map(cleanPath).filter(Boolean).slice(0, 240) : [],
    entryPaths: Array.isArray(raw.entryPaths) ? raw.entryPaths.map(cleanPath).filter(Boolean).slice(0, 32) : [],
    tags: cleanTags(raw.tags),
    surface,
    executionStatus: status,
    parseWarnings: Array.isArray(raw.parseWarnings)
      ? raw.parseWarnings.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 16)
      : [],
  }
}

export function parseOpenDesignInventory(value: unknown): OpenDesignCatalogIndex {
  if (!value || typeof value !== 'object') return emptyOpenDesignCatalog('索引不是 JSON object。')
  const raw = value as Record<string, unknown>
  if (raw.version !== OPEN_DESIGN_INVENTORY_VERSION || !Array.isArray(raw.records)) {
    return emptyOpenDesignCatalog('索引版本不相容或缺少 records。')
  }
  const records = raw.records
    .slice(0, MAX_RECORDS)
    .map(normalizeRecord)
    .filter((item): item is OpenDesignCatalogRecord => Boolean(item))
  return {
    version: OPEN_DESIGN_INVENTORY_VERSION,
    generatedAt: cleanText(raw.generatedAt, 40),
    upstreamCommit: cleanText(raw.upstreamCommit, 80) || OPEN_DESIGN_UPSTREAM_COMMIT,
    sourceUrl: cleanText(raw.sourceUrl, 500) || OPEN_DESIGN_SOURCE_URL,
    records,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 100)
      : [],
  }
}

function emptyOpenDesignCatalog(warning: string): OpenDesignCatalogIndex {
  return {
    version: OPEN_DESIGN_INVENTORY_VERSION,
    generatedAt: '',
    upstreamCommit: OPEN_DESIGN_UPSTREAM_COMMIT,
    sourceUrl: OPEN_DESIGN_SOURCE_URL,
    records: [],
    warnings: [warning],
  }
}

let catalogPromise: Promise<OpenDesignCatalogIndex> | null = null

export async function loadOpenDesignCatalog(): Promise<OpenDesignCatalogIndex> {
  if (catalogPromise) return catalogPromise
  catalogPromise = fetch('/open-design/OPEN_DESIGN_INVENTORY.json', { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Open Design inventory HTTP ${response.status}`)
      return parseOpenDesignInventory(await response.json())
    })
    .catch((error) => emptyOpenDesignCatalog(error instanceof Error ? error.message : String(error)))
  return catalogPromise
}

export function findOpenDesignRecord(records: OpenDesignCatalogRecord[], id: string | undefined): OpenDesignCatalogRecord | null {
  const target = cleanText(id, 160)
  return records.find((record) => record.id === target) || null
}

export function openDesignAssetUrl(assetPath: string): string | null {
  const safe = cleanPath(assetPath)
  return safe ? `/open-design/${safe}` : null
}

export async function readOpenDesignText(assetPath: string, maxBytes = 512_000): Promise<string | null> {
  const url = openDesignAssetUrl(assetPath)
  if (!url || maxBytes < 1) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const text = await response.text()
    return text.slice(0, maxBytes)
  } catch {
    return null
  }
}
