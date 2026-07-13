import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const vendorRoot = path.join(appRoot, 'public', 'open-design')
const outputPath = path.join(vendorRoot, 'OPEN_DESIGN_INVENTORY.json')
const UPSTREAM_COMMIT = '4567a0d'
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
      if (typeof item === 'string' && item.length > 4000) throw new Error('JSON string exceeds limit')
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
  if (relative.startsWith('design-templates/')) return 'template'
  if (files.some((file) => file.endsWith('/DESIGN.md'))) return 'design-system'
  if (files.some((file) => file.endsWith('/SKILL.md'))) return 'skill'
  return 'media'
}

function categoryFor(relative, parsed) {
  const surface = parsed?.surface || parsed?.od?.surface || parsed?.od?.mode
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

function titleFor(id, parsed) {
  const fallback = (id.split(/[/:]/).at(-1) || id).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  return text(parsed?.title || parsed?.name || parsed?.title_i18n?.en || parsed?.title_i18n?.['zh-CN'], fallback)
}

function sourceDirectories(files) {
  const dirs = new Map()
  for (const file of files) {
    const relative = safeRelative(path.relative(vendorRoot, file))
    if (!relative) continue
    if (relative.endsWith('OPEN_DESIGN_INVENTORY.json')) continue
    const parts = relative.split('/')
    let dir = parts.slice(0, -1).join('/')
    if (parts[0] === 'prompt-templates') dir = parts.slice(0, -1).join('/')
    else if (parts[0] === 'design-templates') dir = parts.slice(0, 2).join('/')
    else if (parts[0] === 'plugins' && parts[1] === '_official') dir = parts.slice(0, 4).join('/')
    if (!dir) continue
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir).push({ file, relative })
  }
  return dirs
}

function buildRecord(relative, entries, indexedAt, fallbackLicenses) {
  const warnings = []
  const files = entries.map((entry) => entry.relative)
  const jsonEntry = entries.find((entry) => /(^|\/)(template|open-design)\.json$/.test(entry.relative))
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
  const status = kind === 'template' && category === 'prototype' && entries.some((entry) => /example\.html$/i.test(entry.relative))
    ? 'ready'
    : 'content-only'
  const id = relative.replace(/\//g, ':')
  return {
    id,
    kind,
    category,
    title: titleFor(id, parsed),
    summary: text(parsed?.summary || parsed?.description || parsed?.description_i18n?.en, `${kind === 'skill' ? 'Skill' : 'Open Design'} vendor content：需由現有 capability runtime 受治理載入。`),
    sourcePath: relative,
    assetPaths,
    entryPaths,
    tags: arrayStrings(parsed?.tags || parsed?.od?.tags),
    surface: ['prototype', 'dashboard', 'design-system', 'deck'].includes(String(parsed?.surface || parsed?.od?.surface)) ? String(parsed?.surface || parsed?.od?.surface) : undefined,
    executionStatus: status,
    parseWarnings: warnings,
    source: 'open-design',
    sourceUrl: SOURCE_URL,
    upstreamCommit: UPSTREAM_COMMIT,
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

fs.writeFileSync(outputPath, `${JSON.stringify(buildInventory(), null, 2)}\n`, 'utf8')
console.log(`Open Design inventory written: ${path.relative(appRoot, outputPath)}`)
