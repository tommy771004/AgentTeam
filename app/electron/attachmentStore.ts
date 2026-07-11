/**
 * Persist chat attachments to disk so bubbles / queue / CLI / builtin can share paths.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Mirrors the lowest vision-provider limit currently enforced by Grok. */
export const MIN_VISION_IMAGE_PIXELS = 512

export type PersistableAttachment = {
  id?: string
  name: string
  mimeType?: string
  kind?: 'image' | 'text' | 'binary'
  dataUrl?: string
  textContent?: string
  filePath?: string
  size?: number
}

export type MaterializedAttachment = PersistableAttachment & {
  id: string
  filePath?: string
  size: number
}

function safeFileName(name: string, index: number): string {
  const base = path.basename(name || `file-${index}`).replace(/[<>:"|?*\x00-\x1f]/g, '_')
  const cleaned = base.replace(/^\.+/, '') || `file-${index}`
  return cleaned.slice(0, 120)
}

function extFromMime(mime?: string, kind?: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('png')) return '.png'
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg'
  if (m.includes('webp')) return '.webp'
  if (m.includes('gif')) return '.gif'
  if (m.includes('json')) return '.json'
  if (m.includes('markdown') || m.endsWith('/md')) return '.md'
  if (m.startsWith('text/')) return '.txt'
  if (kind === 'image') return '.png'
  if (kind === 'text') return '.txt'
  return ''
}

export function writeDataUrlToFile(filePath: string, dataUrl: string): number {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('invalid data URL')
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  const buf = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buf)
  return buf.byteLength
}

/** Read dimensions from common image headers without adding a native dependency. */
export function imagePixelCountFromDataUrl(dataUrl: string): number | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return null
  try {
    const buffer = match[2]
      ? Buffer.from(match[3] || '', 'base64')
      : Buffer.from(decodeURIComponent(match[3] || ''), 'utf8')
    if (buffer.length < 10) return null

    // PNG IHDR
    if (buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
      return buffer.readUInt32BE(16) * buffer.readUInt32BE(20)
    }
    // GIF logical screen descriptor
    if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
      return buffer.readUInt16LE(6) * buffer.readUInt16LE(8)
    }
    // WebP extended header (VP8X)
    if (
      buffer.length >= 30 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
      buffer.subarray(12, 16).toString('ascii') === 'VP8X'
    ) {
      const width = 1 + buffer.readUIntLE(24, 3)
      const height = 1 + buffer.readUIntLE(27, 3)
      return width * height
    }
    // JPEG Start Of Frame markers
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }
        const marker = buffer[offset + 1]
        offset += 2
        if (marker === 0xd8 || marker === 0xd9) continue
        if (offset + 2 > buffer.length) break
        const length = buffer.readUInt16BE(offset)
        if (length < 2 || offset + length > buffer.length) break
        if (marker >= 0xc0 && marker <= 0xc3) {
          return buffer.readUInt16BE(offset + 3) * buffer.readUInt16BE(offset + 5)
        }
        offset += length
      }
    }
  } catch {
    return null
  }
  return null
}

export function isVisionImageTooSmall(dataUrl: string): boolean {
  const pixels = imagePixelCountFromDataUrl(dataUrl)
  return pixels != null && pixels < MIN_VISION_IMAGE_PIXELS
}

function resolveBaseDir(projectRoot?: string): string {
  if (projectRoot && path.isAbsolute(projectRoot) && fs.existsSync(projectRoot)) {
    return path.join(projectRoot, '.subagents', 'chat-attachments')
  }
  return path.join(os.tmpdir(), 'subagents-ai', 'chat-attachments')
}

function pruneOld(parent: string) {
  try {
    if (!fs.existsSync(parent)) return
    const now = Date.now()
    const maxAge = 48 * 60 * 60 * 1000
    for (const name of fs.readdirSync(parent)) {
      const p = path.join(parent, name)
      try {
        const st = fs.statSync(p)
        if (st.isDirectory() && now - st.mtimeMs > maxAge) {
          fs.rmSync(p, { recursive: true, force: true })
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Write attachments under .subagents/chat-attachments/<sessionId>/
 * Returns copies with absolute filePath set.
 */
export function materializeAttachments(
  attachments: PersistableAttachment[] | undefined,
  opts?: { projectRoot?: string; sessionId?: string },
): { dir: string | null; items: MaterializedAttachment[] } {
  if (!attachments?.length) return { dir: null, items: [] }

  const sessionId = opts?.sessionId || randomUUID().slice(0, 12)
  const base = resolveBaseDir(opts?.projectRoot)
  pruneOld(base)
  const dir = path.join(base, sessionId)
  fs.mkdirSync(dir, { recursive: true })

  const items: MaterializedAttachment[] = []
  let i = 0
  for (const att of attachments) {
    i += 1
    const id = att.id || `att_${i}`
    // Existing disk paths are reusable only when no fresh payload was provided.
    // A renderer may have re-encoded a tiny image for a provider's vision minimum;
    // retaining the old path here would silently send the original 16×16 file.
    if (att.filePath && fs.existsSync(att.filePath) && !att.dataUrl && att.textContent == null) {
      items.push({
        ...att,
        id,
        size: att.size ?? fs.statSync(att.filePath).size,
        filePath: att.filePath,
      })
      continue
    }

    let name = safeFileName(att.name || `attachment-${i}`, i)
    if (!path.extname(name)) name += extFromMime(att.mimeType, att.kind)
    let filePath = path.join(dir, name)
    if (fs.existsSync(filePath)) {
      const ext = path.extname(name)
      const stem = path.basename(name, ext)
      filePath = path.join(dir, `${stem}-${i}${ext}`)
    }

    try {
      let size = att.size || 0
      if (att.dataUrl?.startsWith('data:')) {
        size = writeDataUrlToFile(filePath, att.dataUrl)
      } else if (typeof att.textContent === 'string') {
        fs.writeFileSync(filePath, att.textContent, 'utf8')
        size = Buffer.byteLength(att.textContent, 'utf8')
      } else {
        items.push({ ...att, id, size: att.size || 0 })
        continue
      }
      items.push({
        ...att,
        id,
        size,
        filePath,
      })
    } catch {
      items.push({ ...att, id, size: att.size || 0 })
    }
  }

  return { dir, items }
}

/** Read a local attachment file back as data URL for vision models */
export function readFileAsDataUrl(filePath: string): { ok: boolean; dataUrl?: string; error?: string } {
  try {
    if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
      return { ok: false, error: 'file not found' }
    }
    const buf = fs.readFileSync(filePath)
    if (buf.byteLength > 12 * 1024 * 1024) {
      return { ok: false, error: 'file too large' }
    }
    const ext = path.extname(filePath).toLowerCase()
    let mime = 'application/octet-stream'
    if (ext === '.png') mime = 'image/png'
    else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg'
    else if (ext === '.gif') mime = 'image/gif'
    else if (ext === '.webp') mime = 'image/webp'
    else if (ext === '.txt' || ext === '.md') mime = 'text/plain'
    else if (ext === '.json') mime = 'application/json'
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    return { ok: true, dataUrl }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
