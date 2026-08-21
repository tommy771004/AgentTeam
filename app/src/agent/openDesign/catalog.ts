/**
 * Open Design content is vendor data, never executable instructions.
 * The inventory is generated offline from app/public/open-design and loaded by
 * the renderer as a small, digestable catalog.  Keep this module free of Node
 * APIs so the browser preview and Electron renderer share the same parser.
 *
 * Plugin contract validation is owned by ./pluginContract.ts. Its verdict is
 * resolved once at index time (scripts/open-design-inventory.mts) and carried
 * on every record as `contractStatus`; catalog presentation reads that field
 * instead of re-parsing contract fields here.
 */
import { isSubDesignSurface, type SubDesignSurface } from '../subdesign/types.ts'

export const OPEN_DESIGN_INVENTORY_VERSION = 1
export const OPEN_DESIGN_UPSTREAM_COMMIT = '4567a0d'
export const OPEN_DESIGN_SOURCE_URL = 'https://open-design.ai/zh/plugins/'

export type OpenDesignCatalogKind = 'template' | 'skill' | 'design-system' | 'prompt' | 'craft' | 'media'
export type OpenDesignExecutionStatus = 'ready' | 'content-only' | 'invalid'
/**
 * Verdict of the authoritative parser (./pluginContract.ts), decided once at
 * index time. Catalog, plugin detail and Task-run admission all read this —
 * none of them re-infers contract fields.
 */
export type OpenDesignContractStatus =
  | 'v1-compatible'
  | 'legacy-compatible'
  | 'incompatible'
  | 'malformed'
  | 'absent'

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
  surface?: SubDesignSurface
  icon?: string
  suggestedObjective?: string
  executionStatus: OpenDesignExecutionStatus
  contractStatus: OpenDesignContractStatus
  contractReason?: string
  specVersion?: string
  /** Position in the official 「探索全部資源」 collection, or undefined if not in it. */
  exploreRank?: number
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

const CONTRACT_STATUSES: OpenDesignContractStatus[] = [
  'v1-compatible',
  'legacy-compatible',
  'incompatible',
  'malformed',
  'absent',
]

/** Explicit incompatibility copy — a rejected contract is never downgraded silently. */
export function openDesignContractLabel(status: OpenDesignContractStatus, reason?: string): string {
  const detail = reason ? `：${reason}` : '。'
  switch (status) {
    case 'incompatible':
      return `Plugin contract 版本不相容，無法執行${detail}`
    case 'malformed':
      return `Plugin contract 格式錯誤，已 fail closed${detail}`
    case 'v1-compatible':
      return 'Plugin Contract v1（相容）'
    case 'legacy-compatible':
      return 'Legacy 契約（可作為內容來源）'
    case 'absent':
      return '此內容沒有 plugin manifest。'
  }
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
  const assetPaths = Array.isArray(raw.assetPaths) ? raw.assetPaths.map(cleanPath).filter(Boolean).slice(0, 240) : []
  const hasDesignSystemDocument = kind !== 'design-system' || assetPaths.some((item) => /(^|\/)DESIGN\.md$/i.test(item))
  const contractStatus = CONTRACT_STATUSES.includes(String(raw.contractStatus) as OpenDesignContractStatus)
    ? (String(raw.contractStatus) as OpenDesignContractStatus)
    : 'absent'
  const contractRejected = contractStatus === 'incompatible' || contractStatus === 'malformed'
  const status = !hasDesignSystemDocument || contractRejected
    ? 'invalid'
    : ['ready', 'content-only', 'invalid'].includes(String(raw.executionStatus))
    ? (String(raw.executionStatus) as OpenDesignExecutionStatus)
    : 'content-only'
  const surface = isSubDesignSurface(raw.surface) ? raw.surface : undefined
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
    assetPaths,
    entryPaths: Array.isArray(raw.entryPaths) ? raw.entryPaths.map(cleanPath).filter(Boolean).slice(0, 32) : [],
    tags: cleanTags(raw.tags),
    surface,
    icon: cleanText(raw.icon, 64) || undefined,
    suggestedObjective: cleanText(raw.suggestedObjective, 400) || undefined,
    executionStatus: status,
    contractStatus,
    exploreRank: Number.isInteger(raw.exploreRank) && (raw.exploreRank as number) >= 0
      ? (raw.exploreRank as number)
      : undefined,
    contractReason: cleanText(raw.contractReason, 300) || undefined,
    specVersion: cleanText(raw.specVersion, 40) || undefined,
    parseWarnings: [
      ...(Array.isArray(raw.parseWarnings) ? raw.parseWarnings.map((item) => cleanText(item, 300)).filter(Boolean) : []),
      ...(!hasDesignSystemDocument ? ['design-system pack 缺少 DESIGN.md，已標記 invalid。'] : []),
      ...(contractRejected ? [openDesignContractLabel(contractStatus, cleanText(raw.contractReason, 300))] : []),
    ].slice(0, 16),
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
