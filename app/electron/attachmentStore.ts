/**
 * Persist chat attachments to disk so bubbles / queue / CLI / builtin can share paths.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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
    // Already on disk and still exists
    if (att.filePath && fs.existsSync(att.filePath)) {
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
