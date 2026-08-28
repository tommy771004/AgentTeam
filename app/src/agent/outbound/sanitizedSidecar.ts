/**
 * Sanitized Sidecars for PDF / Office — AI never receives original binary.
 * Supports: synthetic UTF-8 marker fixtures + OOXML zip extract + PDF string harvest.
 * Opaque/unparseable → unavailable (never binary fallthrough).
 */

import path from 'node:path'
import type { ProviderSecurityProfile } from './policyMerge.ts'
import { sanitizeTextWithProfile } from './textSanitize.ts'
import {
  extractDocxStructure,
  extractPdfStructure,
  extractPptxStructure,
  extractXlsxStructure,
} from './officeZipExtract.ts'

export type SidecarFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx'

export type SidecarLocator = {
  source: string
  page?: number
  block?: number
  sheet?: string
  cell?: string
  slide?: number
  paragraph?: number
}

export type NonTextClass =
  | { kind: 'sidecar-candidate'; format: SidecarFormat }
  | { kind: 'image' }
  | { kind: 'unavailable'; reason: string }

export function classifyNonTextForAi(relPath: string): NonTextClass {
  const ext = path.extname(relPath).toLowerCase()
  if (ext === '.pdf') return { kind: 'sidecar-candidate', format: 'pdf' }
  if (ext === '.docx') return { kind: 'sidecar-candidate', format: 'docx' }
  if (ext === '.xlsx') return { kind: 'sidecar-candidate', format: 'xlsx' }
  if (ext === '.pptx') return { kind: 'sidecar-candidate', format: 'pptx' }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.heic'].includes(ext)) {
    return { kind: 'image' }
  }
  if (ext === '.zip' || ext === '.sqlite' || ext === '.db') {
    return { kind: 'unavailable', reason: `${ext} format unavailable until dedicated adapter exists` }
  }
  return { kind: 'unavailable', reason: 'unknown or untrusted non-text format' }
}

export type SanitizedSidecarOk = {
  ok: true
  kind: 'sidecar'
  format: SidecarFormat
  relPath: string
  markdown: string
  locators: SidecarLocator[]
  originalImmutable: true
  evidence: {
    filename: string
    format: SidecarFormat
    locatorSummary: Array<{ page?: number; sheet?: string; cell?: string; slide?: number }>
  }
}

export type SanitizedSidecarFail = {
  ok: false
  kind: 'unavailable'
  relPath: string
  reason: string
  evidence: { filename: string }
}

export type SanitizedSidecarResult = SanitizedSidecarOk | SanitizedSidecarFail

function tryUtf8(bytes: Uint8Array): string | null {
  try {
    const text = Buffer.from(bytes).toString('utf8')
    // Reject if too many replacement chars / nulls (likely binary)
    if (text.includes(String.fromCharCode(0))) return null
    const nonPrintable = [...text].filter((character) => {
      const code = character.codePointAt(0) || 0
      return code !== 9 && code !== 10 && code !== 13 && !(code >= 32 && code <= 126) && !(code >= 0x4e00 && code <= 0x9fff)
    }).length
    if (nonPrintable > text.length * 0.3 && text.length > 32) return null
    return text
  } catch {
    return null
  }
}

function extractWithMarkers(
  text: string,
  format: SidecarFormat,
  relPath: string,
): { body: string; locators: SidecarLocator[] } {
  const locators: SidecarLocator[] = []
  const lines = text.split(/\r?\n/)
  const out: string[] = [`# Sidecar · ${path.basename(relPath)}`, `format: ${format}`, '']
  let page = 0
  let sheet = ''
  let slide = 0
  let block = 0

  for (const line of lines) {
    const pageM = line.match(/^\[\[page:(\d+)\]\]$/i)
    if (pageM) {
      page = Number(pageM[1])
      block = 0
      out.push(`## Page ${page}`)
      locators.push({ source: relPath, page })
      continue
    }
    const sheetM = line.match(/^\[\[sheet:([^\]]+)\]\]$/i)
    if (sheetM) {
      sheet = sheetM[1].trim()
      out.push(`## Sheet ${sheet}`)
      locators.push({ source: relPath, sheet })
      continue
    }
    const cellM = line.match(/^\[\[cell:([A-Z]+\d+)\]\]\s*(.*)$/i)
    if (cellM) {
      const cell = cellM[1].toUpperCase()
      const content = cellM[2] || ''
      out.push(`- ${cell}: ${content}`)
      locators.push({ source: relPath, sheet: sheet || undefined, cell })
      continue
    }
    const slideM = line.match(/^\[\[slide:(\d+)\]\]$/i)
    if (slideM) {
      slide = Number(slideM[1])
      out.push(`## Slide ${slide}`)
      locators.push({ source: relPath, slide })
      continue
    }
    const paraM = line.match(/^\[\[paragraph:(\d+)\]\]$/i)
    if (paraM) {
      block = Number(paraM[1])
      locators.push({ source: relPath, paragraph: block })
      continue
    }
    if (/^\[\[format:/i.test(line)) continue
    if (/^%%PDF/i.test(line) || line.startsWith('%')) continue
    if (!line.trim()) continue
    block++
    out.push(line)
    if (format === 'pdf' && page > 0) {
      locators.push({ source: relPath, page, block })
    } else if (format === 'docx') {
      locators.push({ source: relPath, paragraph: block })
    }
  }

  return { body: out.join('\n'), locators }
}

function extractBinaryStructure(
  format: SidecarFormat,
  bytes: Buffer,
): string | null {
  if (format === 'docx') return extractDocxStructure(bytes)?.body ?? null
  if (format === 'xlsx') return extractXlsxStructure(bytes)?.body ?? null
  if (format === 'pptx') return extractPptxStructure(bytes)?.body ?? null
  if (format === 'pdf') return extractPdfStructure(bytes)?.body ?? null
  return null
}

export function buildSanitizedSidecar(opts: {
  relPath: string
  bytes: Uint8Array | Buffer
  profile: ProviderSecurityProfile
}): SanitizedSidecarResult {
  const filename = path.basename(opts.relPath)
  const cls = classifyNonTextForAi(opts.relPath)

  if (cls.kind === 'image') {
    return {
      ok: false,
      kind: 'unavailable',
      relPath: opts.relPath,
      reason: 'Images are whole-file exclusions by default (no vision/OCR to external AI).',
      evidence: { filename },
    }
  }
  if (cls.kind === 'unavailable') {
    return {
      ok: false,
      kind: 'unavailable',
      relPath: opts.relPath,
      reason: cls.reason,
      evidence: { filename },
    }
  }

  const buf = Buffer.from(opts.bytes)
  let structured: string | null = null

  // 1) Synthetic UTF-8 fixtures with explicit markers
  const text = tryUtf8(opts.bytes)
  if (text && /\[\[(page|sheet|cell|slide|paragraph):/i.test(text)) {
    structured = text
  }

  // 2) Real OOXML / PDF heuristics (never fall back to original binary)
  if (!structured) {
    structured = extractBinaryStructure(cls.format, buf)
  }

  if (!structured) {
    return {
      ok: false,
      kind: 'unavailable',
      relPath: opts.relPath,
      reason:
        'Document extract unavailable (parser could not produce safe structure; original binary withheld).',
      evidence: { filename },
    }
  }

  const { body, locators } = extractWithMarkers(structured, cls.format, opts.relPath)
  const sanitized = sanitizeTextWithProfile(body, opts.profile, { source: opts.relPath })

  return {
    ok: true,
    kind: 'sidecar',
    format: cls.format,
    relPath: opts.relPath,
    markdown: sanitized.text,
    locators,
    originalImmutable: true,
    evidence: {
      filename,
      format: cls.format,
      locatorSummary: locators.map((l) => ({
        page: l.page,
        sheet: l.sheet,
        cell: l.cell,
        slide: l.slide,
      })),
    },
  }
}

/** Sidecars are derivative artifacts — never write back over original non-text. */
export function isSidecarWritebackAllowed(_r: SanitizedSidecarOk): false {
  return false
}
