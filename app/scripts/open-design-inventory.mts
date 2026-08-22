import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  parseOpenDesignPluginManifest,
  type PluginContractResult,
} from '../src/agent/openDesign/pluginContract.ts'
import { isSubDesignSurface } from '../src/agent/subdesign/types.ts'

const appRoot = path.resolve(import.meta.dirname, '..')
const vendorRoot = path.join(appRoot, 'public', 'open-design')
const outputPath = path.join(vendorRoot, 'OPEN_DESIGN_INVENTORY.json')
const UPSTREAM_COMMIT = '4567a0d'
const EXPLORE_COLLECTION_COMMIT = 'b032abed00ab4fde9bc6691b27206728c929597e'
const SOURCE_URL = 'https://open-design.ai/zh/plugins/'
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_JSON_BYTES = 256 * 1024
const MAX_DEPTH = 8

function safeRelative(value) {
  const normalized = value.split(path.sep).join('/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null
  return normalized
}

function walk(root) {
  const out = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile()) out.push(target)
    }
  }
  if (fs.existsSync(root)) visit(root)
  return out.sort()
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function parseBoundedJson(file, warnings) {
  try {
    const stat = fs.statSync(file)
    if (stat.size > MAX_JSON_BYTES) {
      warnings.push(`${path.basename(file)} 超過 JSON 大小限制，僅保存檔案 metadata。`)
      return null
    }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    const visit = (item, depth) => {
      if (depth > MAX_DEPTH) throw new Error('JSON nesting exceeds limit')
      if (typeof item === 'string' && item.length > 20000) throw new Error('JSON string exceeds limit')
      if (Array.isArray(item)) item.slice(0, 100).forEach((child) => visit(child, depth + 1))
      else if (item && typeof item === 'object') Object.values(item).slice(0, 100).forEach((child) => visit(child, depth + 1))
    }
    visit(value, 0)
    return value
  } catch (error) {
    warnings.push(`${path.basename(file)} 無法安全解析：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : fallback
}

function arrayStrings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 32) : []
}

function recordKind(relative, files) {
  if (relative.startsWith('prompt-templates/')) return 'prompt'
  if (relative.startsWith('plugins/_official/video-templates/')) return 'template'
  if (relative.startsWith('plugins/_official/examples/')) return 'template'
  if (relative.startsWith('design-systems/')) return 'design-system'
  if (relative.startsWith('design-templates/')) return 'template'
  if (files.some((file) => file.endsWith('/DESIGN.md'))) return 'design-system'
  if (files.some((file) => file.endsWith('/SKILL.md'))) return 'skill'
  return 'media'
}

function categoryFor(relative, parsed) {
  if (typeof parsed?.category === 'string' && parsed.category.trim()) return parsed.category.trim()
  const surface = parsed?.surface || parsed?.od?.mode || parsed?.od?.surface
  if (surface === 'video') return 'video'
  if (surface === 'prototype' || surface === 'dashboard' || surface === 'design-system' || surface === 'deck') return surface
  if (relative.startsWith('design-templates/')) {
    if (/deck|ppt|pitch|weekly-report|presentation|kami/i.test(relative)) return 'deck'
    if (/dashboard|tracker|okrs|finance|github|kanban|invoice|valuation|meeting-notes/i.test(relative)) return 'dashboard'
    if (/hyperframes|motion|sprite|webgl|animation/i.test(relative)) return 'hyperframes'
    return 'prototype'
  }
  if (relative.startsWith('prompt-templates/image/')) return 'image'
  if (relative.startsWith('prompt-templates/video/')) return 'video'
  if (relative.includes('video-templates')) return 'video'
  if (relative.includes('hyperframe') || relative.includes('motion')) return 'hyperframes'
  if (relative.includes('deck') || relative.includes('ppt')) return 'deck'
  if (relative.includes('dashboard') || relative.includes('tracker')) return 'dashboard'
  return 'other'
}

function titleFor(id, parsed, relative) {
  const fallback = (id.split(/[/:]/).at(-1) || id).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const localizedTitle = isExploreVendorDrop(relative)
    ? parsed?.title_i18n?.['zh-TW'] || parsed?.title_i18n?.['zh-CN']
    : undefined
  return text(localizedTitle || parsed?.title || parsed?.name || parsed?.title_i18n?.en || parsed?.title_i18n?.['zh-CN'], fallback)
}

/**
 * The official 「探索全部資源」 collection, in its published order. This is the
 * ONE list — it is emitted onto each record as `exploreRank`, so the renderer
 * orders the collection from the inventory rather than keeping a second copy
 * (docs/adr/0001-opendesign-catalog-is-source-of-truth.md).
 */
const EXPLORE_COLLECTION_ORDER = [
  'plugins/_official/examples/fs-editorial-forest',
  'plugins/_official/examples/webgl-aurora-veil',
  'plugins/_official/examples/blog-post',
  'plugins/_official/video-templates/frame-bold-poster',
  'plugins/_official/video-templates/frame-bold-signal',
  'plugins/_official/examples/html-ppt-testing-safety-alert',
  'plugins/_official/examples/html-ppt',
  'plugins/_official/examples/huashu-takram-soft-tech',
  'plugins/_official/examples/html-ppt-zhangzara-neo-grid-bold',
  'plugins/_official/examples/html-ppt-course-module',
  'plugins/_official/examples/huashu-pentagram-grid',
  'plugins/_official/examples/html-ppt-zhangzara-studio',
  'plugins/_official/examples/html-ppt-zhangzara-editorial-tri-tone',
  'plugins/_official/video-templates/frame-build-minimal',
  'plugins/_official/examples/webgl-caustic-pool',
  'plugins/_official/examples/clinical-case-report',
  'plugins/_official/examples/codex-interactive-capability-map',
  'plugins/_official/video-templates/frame-creative-voltage',
  'plugins/_official/examples/critique',
  'plugins/_official/examples/html-ppt-zhangzara-biennale-yellow',
  'plugins/_official/examples/dashboard',
  'plugins/_official/video-templates/frame-data-rollup',
  'plugins/_official/examples/dating-web',
  'plugins/_official/examples/dcf-valuation',
]

function exploreRankOf(relative) {
  const rank = EXPLORE_COLLECTION_ORDER.indexOf(relative)
  return rank < 0 ? undefined : rank
}

/**
 * Provenance, not presentation: these directories were vendored from the
 * explore-collection upstream drop, so they carry its commit and its localized
 * titles. A wider set than EXPLORE_COLLECTION_ORDER by design.
 */
function isExploreVendorDrop(relative) {
  return relative.startsWith('plugins/_official/examples/')
    || relative.startsWith('plugins/_official/video-templates/')
}

/**
 * The one mapping from an authoritative PluginContractResult to what the
 * catalog shows. A contract that fails to parse is `invalid` with a visible
 * reason — never a silent downgrade to `content-only`.
 */
function describeContract(contract: PluginContractResult | null): {
  contractStatus: 'v1-compatible' | 'legacy-compatible' | 'incompatible' | 'malformed' | 'absent'
  executionStatus: 'ready' | 'content-only' | 'invalid' | null
  specVersion?: string
  reason?: string
} {
  if (!contract) return { contractStatus: 'absent', executionStatus: null }
  if (!contract.ok) {
    return {
      contractStatus: contract.kind,
      executionStatus: 'invalid',
      specVersion: contract.kind === 'incompatible' ? contract.specVersion : undefined,
      reason: contract.reason,
    }
  }
  if (contract.kind === 'legacy') {
    return { contractStatus: 'legacy-compatible', executionStatus: null }
  }
  return {
    contractStatus: 'v1-compatible',
    // A v1 plugin is executable only when it declares a pipeline stage.
    executionStatus: contract.manifest.pipeline?.stages.length ? 'ready' : 'content-only',
    specVersion: contract.manifest.specVersion,
  }
}

function sourceDirectories(files) {
  const dirs = new Map()
  for (const file of files) {
    const relative = safeRelative(path.relative(vendorRoot, file))
    if (!relative) continue
    if (relative.endsWith('OPEN_DESIGN_INVENTORY.json')) continue
    const parts = relative.split('/')
    let dir = parts.slice(0, -1).join('/')
    if (parts[0] === 'prompt-templates') {
      // Each prompt-template is a standalone file; group its json with its preview image
      const base = relative.replace(/\.(json|preview\.png|preview\.jpg)$/i, '')
      // Use base path as dir so json + preview.png share same record
      dir = base
    } else if (parts[0] === 'design-templates') dir = parts.slice(0, 2).join('/')
    else if (parts[0] === 'design-systems') dir = parts.slice(0, 2).join('/')
    else if (parts[0] === 'plugins' && parts[1] === '_official') dir = parts.slice(0, 4).join('/')
    if (!dir) continue
    // Prompt-templates are file-based packs; skip directory existence check for them
    if (parts[0] !== 'prompt-templates') {
      const dirPath = path.join(vendorRoot, dir)
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue
    }
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir).push({ file, relative })
  }
  return dirs
}

function buildRecord(relative, entries, indexedAt, fallbackLicenses) {
  const warnings = []
  const files = entries.map((entry) => entry.relative)
  let jsonEntry = entries.find((entry) => /(^|\/)(template|open-design)\.json$/.test(entry.relative))
  // prompt-templates are single-file packs named *.json
  if (!jsonEntry && relative.startsWith('prompt-templates/')) {
    jsonEntry = entries.find((entry) => entry.relative.endsWith('.json'))
  }
  const parsed = jsonEntry ? parseBoundedJson(jsonEntry.file, warnings) : null
  const kind = recordKind(relative, files)
  const category = categoryFor(relative, parsed)
  const digest = crypto.createHash('sha256')
  for (const entry of entries) {
    const stat = fs.statSync(entry.file)
    digest.update(entry.relative)
    digest.update(String(stat.size))
    digest.update(sha256(entry.file))
  }
  const licenses = [...new Set([
    ...files.filter((file) => /(^|\/)(license|notice|.*attribution.*)(\.[^/]*)?$/i.test(file)),
    ...fallbackLicenses,
  ])].slice(0, 32)
  const entryPaths = files.filter((file) => /(^|\/)(index|entry|root|example)\.(html?|tsx?|jsx?|md)$/i.test(file) || /SKILL\.md$/i.test(file)).slice(0, 32)
  const assetPaths = files.slice(0, 240)
  // Contract validation is owned by src/agent/openDesign/pluginContract.ts.
  // Never re-infer contract fields here — catalog, plugin detail and Task-run
  // admission must all read the same PluginContractResult (issue 01).
  const contract = jsonEntry && parsed !== null ? parseOpenDesignPluginManifest(parsed) : null
  const contractView = describeContract(contract)
  if (contractView.reason) warnings.push(contractView.reason)
  const statusOverride = parsed?.status === 'ready' || parsed?.status === 'content-only' ? parsed.status : null
  const status = contractView.executionStatus
    ?? statusOverride
    ?? (kind === 'template' && category === 'prototype' && entries.some((entry) => /example\.html$/i.test(entry.relative)) ? 'ready' : 'content-only')
  const id = relative.replace(/\//g, ':')
  // Preview mapping: prompt-templates carry previewImageUrl and a local .preview.png
  const foundPreview = entries.find((e) => e.relative.endsWith('.preview.png') || e.relative.endsWith('.preview.jpg'))
  const localPreviewRel = foundPreview?.relative
  const previewImage = localPreviewRel || (typeof parsed?.previewImageUrl === 'string' ? String(parsed.previewImageUrl).slice(0, 500) : undefined) || (typeof parsed?.preview === 'string' ? String(parsed.preview).slice(0, 500) : undefined)
  const declaredSurface = parsed?.surface || parsed?.od?.mode
  // Prompt-templates are file-based; sourcePath must be the actual json file for correct template code mapping
  const sourcePathValue = kind === 'prompt' && jsonEntry ? jsonEntry.relative : relative
  return {
    id,
    kind,
    category,
    title: titleFor(id, parsed, relative),
    summary: text(parsed?.summary || parsed?.description || parsed?.description_i18n?.en, `${kind === 'skill' ? 'Skill' : 'Open Design'} vendor content：需由現有 capability runtime 受治理載入。`),
    sourcePath: sourcePathValue,
    assetPaths,
    entryPaths,
    tags: arrayStrings(parsed?.tags || parsed?.od?.tags),
    surface: isSubDesignSurface(declaredSurface) ? declaredSurface : undefined,
    icon: text(parsed?.icon, undefined),
    suggestedObjective: text(
      parsed?.suggestedObjective
        || parsed?.od?.useCase?.query?.['zh-TW']
        || parsed?.od?.useCase?.query?.['zh-CN']
        || parsed?.od?.useCase?.query?.en,
      undefined,
    ),
    executionStatus: status,
    exploreRank: exploreRankOf(relative),
    contractStatus: contractView.contractStatus,
    contractReason: contractView.reason,
    specVersion: contractView.specVersion,
    previewImage: previewImage || undefined,
    parseWarnings: warnings,
    source: 'open-design',
    sourceUrl: SOURCE_URL,
    upstreamCommit: isExploreVendorDrop(relative) ? EXPLORE_COLLECTION_COMMIT : UPSTREAM_COMMIT,
    digest: digest.digest('hex'),
    licensePaths: licenses,
    indexedAt,
  }
}

function buildInventory() {
  if (!fs.existsSync(vendorRoot)) return { version: 1, generatedAt: new Date().toISOString(), upstreamCommit: UPSTREAM_COMMIT, sourceUrl: SOURCE_URL, records: [], warnings: ['vendor directory 不存在。'] }
  const indexedAt = new Date().toISOString()
  const files = walk(vendorRoot)
  const fallbackLicenses = files
    .map((file) => safeRelative(path.relative(vendorRoot, file)))
    .filter((file) => file && !file.includes('/') && /^(license|notice|.*attribution.*)(\.[^/]*)?$/i.test(file))
  const records = []
  for (const [relative, entries] of sourceDirectories(files).entries()) {
    const record = buildRecord(relative, entries, indexedAt, fallbackLicenses)
    records.push(record)
    // A template directory can also carry a SKILL.md. Keep the template and
    // skill as separate content packs so install/enable cannot conflate them.
    if (record.kind === 'template' && entries.some((entry) => /(^|\/)SKILL\.md$/i.test(entry.relative))) {
      const skillAssets = entries.map((entry) => entry.relative).filter((file) => /SKILL\.md$/i.test(file))
      records.push({
        ...record,
        id: `${record.id}:skill`,
        kind: 'skill',
        title: `${record.title} Skill`,
        summary: 'Open Design SKILL.md；只會以 deferred capability runbook 載入，不包含可執行 hook。',
        assetPaths: skillAssets,
        entryPaths: skillAssets,
        executionStatus: 'content-only',
      })
    }
  }
  const warnings = []
  for (const file of files) {
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) warnings.push(`${safeRelative(path.relative(vendorRoot, file))} 超過檔案 metadata scan 上限。`)
    } catch { /* file disappeared during scan */ }
  }
  return { version: 1, generatedAt: indexedAt, upstreamCommit: UPSTREAM_COMMIT, sourceUrl: SOURCE_URL, records, warnings: [...new Set(warnings)].slice(0, 100) }
}

/**
 * Timestamps change on every run, so a naive write dirties the tree each time
 * the indexer runs — and it now runs on `npm run dev` too. Compare on content
 * alone and keep the existing file when nothing real changed.
 */
function sameContent(next: unknown, previousRaw: string | null): boolean {
  if (!previousRaw) return false
  const strip = (value: unknown) => JSON.stringify(value, (key, item) =>
    key === 'generatedAt' || key === 'indexedAt' ? undefined : item)
  try {
    return strip(next) === strip(JSON.parse(previousRaw))
  } catch {
    return false
  }
}

const inventory = buildInventory()
const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null
if (sameContent(inventory, previous)) {
  console.log(`Open Design inventory unchanged: ${path.relative(appRoot, outputPath)}`)
} else {
  fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  console.log(`Open Design inventory written: ${path.relative(appRoot, outputPath)}`)
}
