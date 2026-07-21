/**
 * Minimal ZIP reader for Office Open XML (docx/xlsx/pptx) without third-party deps.
 * Only extracts listed internal paths; never treats the whole archive as AI payload.
 */

import zlib from 'node:zlib'

type ZipEntry = {
  name: string
  compression: number
  compressed: Buffer
  uncompressedSize: number
}

function readU16(buf: Buffer, o: number) {
  return buf.readUInt16LE(o)
}
function readU32(buf: Buffer, o: number) {
  return buf.readUInt32LE(o)
}

/** Parse local-file records from a ZIP buffer (enough for OOXML packages). */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = []
  let o = 0
  while (o + 30 < buf.length) {
    const sig = readU32(buf, o)
    if (sig !== 0x04034b50) break // local file header
    const compression = readU16(buf, o + 8)
    const compSize = readU32(buf, o + 18)
    const uncompSize = readU32(buf, o + 22)
    const nameLen = readU16(buf, o + 26)
    const extraLen = readU16(buf, o + 28)
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString('utf8')
    const dataStart = o + 30 + nameLen + extraLen
    const compressed = buf.subarray(dataStart, dataStart + compSize)
    entries.push({
      name,
      compression,
      compressed: Buffer.from(compressed),
      uncompressedSize: uncompSize,
    })
    o = dataStart + compSize
  }
  return entries
}

export function inflateZipEntry(entry: ZipEntry): Buffer | null {
  try {
    if (entry.compression === 0) return entry.compressed
    if (entry.compression === 8) {
      return zlib.inflateRawSync(entry.compressed)
    }
    return null
  } catch {
    return null
  }
}

export function readZipText(buf: Buffer, internalPath: string): string | null {
  const entries = listZipEntries(buf)
  const hit = entries.find((e) => e.name === internalPath || e.name.endsWith('/' + internalPath))
  if (!hit) return null
  const raw = inflateZipEntry(hit)
  if (!raw) return null
  return raw.toString('utf8')
}

export function readZipTexts(buf: Buffer, predicate: (name: string) => boolean): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = []
  for (const e of listZipEntries(buf)) {
    if (!predicate(e.name)) continue
    const raw = inflateZipEntry(e)
    if (!raw) continue
    out.push({ name: e.name, text: raw.toString('utf8') })
  }
  return out
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** DOCX → paragraphs with markers */
export function extractDocxStructure(buf: Buffer): { body: string; paragraphs: number } | null {
  const xml = readZipText(buf, 'word/document.xml')
  if (!xml) return null
  const paras = xml.split(/<\/w:p>/).map((p) => stripXmlTags(p + '</w:p>')).filter(Boolean)
  const lines = [`[[format:docx]]`]
  let n = 0
  for (const p of paras) {
    if (!p.trim()) continue
    n++
    lines.push(`[[paragraph:${n}]]`)
    lines.push(p.trim())
  }
  if (!n) return null
  return { body: lines.join('\n'), paragraphs: n }
}

/** Parse workbook.xml sheet names ordered by sheetId / appearance. */
export function parseWorkbookSheetNames(workbookXml: string): string[] {
  const names: string[] = []
  const re = /<sheet\b[^>]*\bname="([^"]+)"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(workbookXml))) {
    names.push(m[1])
  }
  return names
}

/** XLSX → sheet/cell markers via workbook names + sharedStrings + sheet XML. */
export function extractXlsxStructure(buf: Buffer): { body: string; cells: number } | null {
  const shared = readZipText(buf, 'xl/sharedStrings.xml')
  const strings: string[] = []
  if (shared) {
    const re = /<si>([\s\S]*?)<\/si>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(shared))) {
      const t = stripXmlTags(m[1])
      strings.push(t)
    }
  }
  const workbook = readZipText(buf, 'xl/workbook.xml')
  const sheetNames = workbook ? parseWorkbookSheetNames(workbook) : []
  const sheets = readZipTexts(buf, (n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  // Stable order: sheet1, sheet2, …
  sheets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (!sheets.length) return null
  const lines = [`[[format:xlsx]]`]
  let cells = 0
  let sheetIdx = 0
  for (const sh of sheets) {
    const sheetName = sheetNames[sheetIdx] || `Sheet${sheetIdx + 1}`
    sheetIdx++
    lines.push(`[[sheet:${sheetName}]]`)
    const cellRe = /<c r="([A-Z]+)(\d+)"[^>]*(t="s")?[^>]*>(?:<v>([^<]*)<\/v>)?/g
    let m: RegExpExecArray | null
    while ((m = cellRe.exec(sh.text))) {
      const col = m[1]
      const row = m[2]
      const isShared = Boolean(m[3])
      const v = m[4] || ''
      let text = v
      if (isShared) {
        const i = Number(v)
        text = Number.isFinite(i) ? strings[i] || v : v
      }
      if (!String(text).trim()) continue
      cells++
      lines.push(`[[cell:${col}${row}]] ${text}`)
    }
  }
  if (!cells) return null
  return { body: lines.join('\n'), cells }
}

/** PPTX → slide text */
export function extractPptxStructure(buf: Buffer): { body: string; slides: number } | null {
  const slides = readZipTexts(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  if (!slides.length) return null
  const lines = [`[[format:pptx]]`]
  let i = 0
  for (const s of slides) {
    i++
    lines.push(`[[slide:${i}]]`)
    const text = stripXmlTags(s.text)
    if (text) lines.push(text)
  }
  return { body: lines.join('\n'), slides: i }
}

/**
 * PDF: extract printable strings from content streams (heuristic, not a full PDF parser).
 * Safe failure → null (caller marks unavailable; never returns original binary).
 */
export function extractPdfStructure(buf: Buffer): { body: string; pages: number } | null {
  // If it's our synthetic UTF-8 fixture with markers, caller handles separately
  const asUtf = buf.toString('utf8')
  if (/\[\[page:\d+\]\]/i.test(asUtf) && !asUtf.includes('\u0000')) {
    return null // let marker path handle
  }
  if (buf.subarray(0, 5).toString('utf8') !== '%PDF-') {
    // might still be valid if BOM etc.
    if (!buf.includes(Buffer.from('%PDF'))) return null
  }
  const raw = buf.toString('latin1')
  // Split by page objects heuristically
  const pageChunks = raw.split(/\/Type\s*\/Page[^s]/)
  const lines = [`[[format:pdf]]`]
  let pages = 0
  const extractStrings = (chunk: string): string[] => {
    const out: string[] = []
    // (Hello World) Tj
    const re = /\((?:\\.|[^\\)])*\)\s*Tj/g
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk))) {
      const inner = m[0].replace(/\)\s*Tj$/, '').slice(1)
      const decoded = inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
      if (decoded.trim()) out.push(decoded)
    }
    // <HEX> Tj
    const hexRe = /<([0-9A-Fa-f]+)>\s*Tj/g
    while ((m = hexRe.exec(chunk))) {
      const hex = m[1]
      if (hex.length % 2) continue
      let s = ''
      for (let i = 0; i < hex.length; i += 2) {
        s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
      }
      if (s.trim()) out.push(s)
    }
    return out
  }
  for (let i = 1; i < pageChunks.length; i++) {
    const texts = extractStrings(pageChunks[i])
    if (!texts.length) continue
    pages++
    lines.push(`[[page:${pages}]]`)
    lines.push(...texts)
  }
  // Fallback: whole-file string harvest as one page
  if (!pages) {
    const texts = extractStrings(raw)
    if (!texts.length) return null
    pages = 1
    lines.push(`[[page:1]]`)
    lines.push(...texts.slice(0, 500))
  }
  return { body: lines.join('\n'), pages }
}
