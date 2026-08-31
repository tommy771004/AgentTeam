import { parsePinnedNpmPackageSource, PiPackageDomainError } from './piPackageDomain.ts'

const MAX_RESULTS = 12
const MAX_QUERY_BYTES = 160
const MAX_SEARCH_BYTES = 1024 * 1024
const MAX_DETAIL_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 60_000

export type PiPackageCatalogCompatibility = {
  kind: 'extensions' | 'skills' | 'prompts' | 'themes' | 'resources'
  status: 'supported' | 'unsupported' | 'unknown'
}

export type PiPackageCatalogItem = {
  name: string
  version: string
  source: string
  description: string
  repositoryUrl?: string
  npmUrl: string
  piDevUrl: string
  compatibility: PiPackageCatalogCompatibility[]
}

type SearchPackage = {
  name?: unknown
  version?: unknown
  description?: unknown
  keywords?: unknown
  links?: { npm?: unknown; repository?: unknown }
}

type PackageDetail = {
  name?: unknown
  version?: unknown
  keywords?: unknown
  pi?: unknown
  repository?: unknown
}

const cache = new Map<string, { at: number; items: PiPackageCatalogItem[] }>()

function registryBase(): URL {
  const candidate = process.env.SUBAGENTS_PI_NPM_REGISTRY || 'https://registry.npmjs.org'
  const url = new URL(candidate)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new PiPackageDomainError('unavailable', 'Pi package catalog registry URL is not allowed')
  }
  return url
}

async function boundedJson(url: URL, maxBytes: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`npm registry returned HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('npm registry response exceeded the catalog limit')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new Error('npm registry response exceeded the catalog limit')
      }
      chunks.push(value)
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(body))
  } finally {
    clearTimeout(timeout)
  }
}

function string(value: unknown, max = 500): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function keywords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 64)
    : []
}

function safeHttpUrl(value: unknown): string | undefined {
  const raw = string(value, 2_048)?.replace(/^git\+/, '').replace(/\.git$/, '')
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href.replace(/\/$/, '') : undefined
  } catch { return undefined }
}

function repositoryUrl(detail: PackageDetail, search: SearchPackage): string | undefined {
  const repository = detail.repository
  if (typeof repository === 'string') return safeHttpUrl(repository)
  if (repository && typeof repository === 'object') {
    const url = safeHttpUrl((repository as { url?: unknown }).url)
    if (url) return url
  }
  return safeHttpUrl(search.links?.repository)
}

function compatibility(detail: PackageDetail): PiPackageCatalogCompatibility[] {
  if (!detail.pi || typeof detail.pi !== 'object' || Array.isArray(detail.pi)) {
    return [{ kind: 'resources', status: 'unknown' }]
  }
  const manifest = detail.pi as Record<string, unknown>
  const kinds = (['extensions', 'skills', 'prompts', 'themes'] as const)
    .filter((kind) => Array.isArray(manifest[kind]) && (manifest[kind] as unknown[]).length > 0)
  if (kinds.length === 0) return [{ kind: 'resources', status: 'unknown' }]
  return kinds.map((kind) => ({
    kind,
    // A manifest can prove that extension files exist, but not whether they
    // register tools rather than unsupported hooks, providers, commands, or
    // custom UI. Only the trusted runtime may discover that distinction.
    status: kind === 'skills' ? 'supported' : kind === 'extensions' ? 'unknown' : 'unsupported',
  }))
}

async function catalogItem(search: SearchPackage, base: URL): Promise<PiPackageCatalogItem | undefined> {
  const name = string(search.name, 214)
  const version = string(search.version, 128)
  if (!name || !version || !keywords(search.keywords).includes('pi-package')) return undefined
  let pinned: ReturnType<typeof parsePinnedNpmPackageSource>
  try { pinned = parsePinnedNpmPackageSource(`npm:${name}@${version}`) } catch { return undefined }
  const detailUrl = new URL(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, `${base.href.replace(/\/$/, '')}/`)
  const detail = await boundedJson(detailUrl, MAX_DETAIL_BYTES) as PackageDetail
  if (detail.name !== name || detail.version !== version || !keywords(detail.keywords).includes('pi-package')) return undefined
  return {
    name,
    version,
    source: pinned.source,
    description: string(search.description, 1_000) || 'No description provided',
    ...(repositoryUrl(detail, search) ? { repositoryUrl: repositoryUrl(detail, search) } : {}),
    npmUrl: safeHttpUrl(search.links?.npm) || `https://www.npmjs.com/package/${name}`,
    piDevUrl: `https://pi.dev/packages/${encodeURIComponent(name)}`,
    compatibility: compatibility(detail),
  }
}

export async function searchPiPackageCatalog(queryInput: unknown): Promise<PiPackageCatalogItem[]> {
  if (typeof queryInput !== 'string') throw new PiPackageDomainError('invalid_request', 'Catalog query must be a string')
  const query = queryInput.trim().replace(/\s+/g, ' ')
  if (Buffer.byteLength(query, 'utf8') > MAX_QUERY_BYTES) throw new PiPackageDomainError('invalid_request', 'Catalog query is too long')
  const key = query.toLocaleLowerCase('en-US')
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return structuredClone(cached.items)
  const base = registryBase()
  const searchUrl = new URL('-/v1/search', `${base.href.replace(/\/$/, '')}/`)
  searchUrl.searchParams.set('text', `keywords:pi-package${query ? ` ${query}` : ''}`)
  searchUrl.searchParams.set('size', String(MAX_RESULTS))
  const raw = await boundedJson(searchUrl, MAX_SEARCH_BYTES) as { objects?: unknown }
  const objects = Array.isArray(raw.objects) ? raw.objects.slice(0, MAX_RESULTS) : []
  const settled = await Promise.allSettled(objects.map((entry) => catalogItem(
    entry && typeof entry === 'object' ? (entry as { package?: SearchPackage }).package || {} : {},
    base,
  )))
  const items = settled.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
  cache.set(key, { at: Date.now(), items })
  if (cache.size > 20) cache.delete(cache.keys().next().value!)
  return structuredClone(items)
}
