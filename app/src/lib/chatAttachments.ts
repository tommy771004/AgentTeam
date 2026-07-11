/**
 * Chat attachments: paste/upload images + text files for multimodal tasks.
 * Images → OpenAI-style image_url data URLs; text files → prompt appendix.
 * (DOM helpers — do not import this module from Electron/main.)
 */

import type { ChatAttachment, ChatAttachmentKind } from '../agent/types'

export type { ChatAttachment, ChatAttachmentKind }

/** OpenAI chat content part (subset) */
export type MultimodalContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export const MAX_ATTACHMENTS = 4
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_EDGE = 1600
/** Some vision providers reject images below this total pixel count. */
export const MIN_VISION_IMAGE_PIXELS = 512
export const MAX_TEXT_CHARS = 80_000
/** Drop dataUrl when persisting if larger (keep name/meta for UI note) */
export const PERSIST_DATAURL_MAX = 450_000

const TEXT_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'log',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'html',
  'htm',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'sql',
  'graphql',
  'env',
  'gitignore',
  'dockerfile',
  'makefile',
])

function uid() {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isImageMime(mime: string, name = ''): boolean {
  if (mime.startsWith('image/')) return true
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extOf(name))
}

export function isTextLike(mime: string, name = ''): boolean {
  if (mime.startsWith('text/')) return true
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript'
  ) {
    return true
  }
  return TEXT_EXT.has(extOf(name))
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error || new Error('FileReader failed'))
    r.readAsDataURL(file)
  })
}

function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error || new Error('FileReader failed'))
    r.readAsText(file)
  })
}

export function visionImageDimensions(width: number, height: number): {
  width: number
  height: number
} {
  if (width <= 0 || height <= 0 || width * height >= MIN_VISION_IMAGE_PIXELS) {
    return { width, height }
  }
  const scale = Math.sqrt(MIN_VISION_IMAGE_PIXELS / (width * height))
  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale)),
  }
}

async function normalizeImageDataUrl(sourceDataUrl: string, mimeHint: string, name: string): Promise<{
  dataUrl: string
  mimeType: string
  size: number
}> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('無法解碼圖片'))
    el.src = sourceDataUrl
  })

  let { width, height } = img
  const maxEdge = MAX_IMAGE_EDGE
  if (width > maxEdge || height > maxEdge) {
    const scale = maxEdge / Math.max(width, height)
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  const minimum = visionImageDimensions(width, height)
  width = minimum.width
  height = minimum.height

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      dataUrl: sourceDataUrl,
      mimeType: mimeHint || 'image/png',
      size: Math.ceil((sourceDataUrl.length - sourceDataUrl.indexOf(',') - 1) * 0.75),
    }
  }
  ctx.drawImage(img, 0, 0, width, height)

  // Prefer JPEG for photos; keep PNG for transparency-ish names
  const preferPng =
    (mimeHint || '').includes('png') ||
    extOf(name) === 'png' ||
    extOf(name) === 'gif' ||
    extOf(name) === 'webp'
  const mimeType = preferPng ? 'image/png' : 'image/jpeg'
  const dataUrl =
    mimeType === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.84)
  const approxSize = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
  return { dataUrl, mimeType, size: approxSize }
}

/** Downscale large images and upsample tiny images for provider vision limits. */
export async function compressImageFile(file: File | Blob, name: string): Promise<{
  dataUrl: string
  mimeType: string
  size: number
}> {
  const srcUrl = await readAsDataUrl(file)
  return normalizeImageDataUrl(srcUrl, file.type || 'image/png', name)
}

/**
 * Normalize externally-created attachments (Telegram, restored queue, paste)
 * that did not pass through fileToAttachment before reaching a vision provider.
 */
export async function normalizeImageAttachmentsForVision(
  attachments: ChatAttachment[] | undefined,
): Promise<ChatAttachment[]> {
  if (!attachments?.length) return []
  const normalized: ChatAttachment[] = []
  for (const attachment of attachments) {
    if (attachment.kind !== 'image' || !attachment.dataUrl) {
      normalized.push(attachment)
      continue
    }
    try {
      const image = await normalizeImageDataUrl(
        attachment.dataUrl,
        attachment.mimeType,
        attachment.name,
      )
      normalized.push({
        ...attachment,
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        size: image.size,
      })
    } catch {
      // Existing behavior: unreadable images remain a path/metadata fallback.
      normalized.push(attachment)
    }
  }
  return normalized
}

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`「${file.name}」超過 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限`)
  }

  if (isImageMime(file.type, file.name)) {
    const compressed = await compressImageFile(file, file.name)
    return {
      id: uid(),
      kind: 'image',
      name: file.name || 'image.png',
      mimeType: compressed.mimeType,
      size: compressed.size,
      dataUrl: compressed.dataUrl,
    }
  }

  if (isTextLike(file.type, file.name)) {
    const text = (await readAsText(file)).slice(0, MAX_TEXT_CHARS)
    return {
      id: uid(),
      kind: 'text',
      name: file.name || 'file.txt',
      mimeType: file.type || 'text/plain',
      size: file.size,
      textContent: text,
    }
  }

  // Binary: keep metadata only (model gets a note)
  return {
    id: uid(),
    kind: 'binary',
    name: file.name || 'file',
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  }
}

export async function filesToAttachments(
  files: FileList | File[] | null | undefined,
  existingCount = 0,
): Promise<{ ok: ChatAttachment[]; errors: string[] }> {
  const list = files ? Array.from(files) : []
  const ok: ChatAttachment[] = []
  const errors: string[] = []
  const room = Math.max(0, MAX_ATTACHMENTS - existingCount)
  if (list.length > room) {
    errors.push(`一次最多 ${MAX_ATTACHMENTS} 個附件（已略過多餘檔案）`)
  }
  for (const file of list.slice(0, room)) {
    try {
      ok.push(await fileToAttachment(file))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { ok, errors }
}

/** Text appendix for objective / non-vision models */
export function attachmentsToTextAppendix(attachments: ChatAttachment[]): string {
  if (!attachments.length) return ''
  const parts: string[] = ['## 使用者附件']
  for (const a of attachments) {
    if (a.kind === 'image') {
      parts.push(`- 圖片：${a.name}（${a.mimeType}，約 ${formatBytes(a.size)}）— 若模型支援 vision 將一併送出`)
    } else if (a.kind === 'text' && a.textContent) {
      parts.push(
        `### 檔案：${a.name}\n\`\`\`\n${a.textContent.slice(0, MAX_TEXT_CHARS)}\n\`\`\``,
      )
    } else {
      parts.push(
        `- 檔案：${a.name}（${a.mimeType}，${formatBytes(a.size)}）— 二進位未內嵌，請使用者改貼路徑或文字內容`,
      )
    }
  }
  return parts.join('\n\n')
}

/** Build OpenAI multimodal user content */
export function buildMultimodalUserContent(
  text: string,
  attachments: ChatAttachment[] | undefined,
): string | MultimodalContentPart[] {
  const images = (attachments || []).filter((a) => a.kind === 'image' && a.dataUrl)
  const pathOnly = (attachments || []).filter(
    (a) => a.kind === 'image' && !a.dataUrl && a.filePath,
  )
  if (!images.length && !pathOnly.length) return text

  let body = text || '請分析附上的圖片。'
  if (pathOnly.length) {
    body +=
      '\n\n' + pathOnly.map((a) => `(image file on disk: ${a.filePath})`).join('\n')
  }
  if (!images.length) return body

  const parts: MultimodalContentPart[] = [{ type: 'text', text: body }]
  for (const img of images) {
    if (!img.dataUrl) continue
    parts.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    })
  }
  return parts
}

export function hasImageAttachments(attachments?: ChatAttachment[]): boolean {
  return Boolean(
    attachments?.some((a) => a.kind === 'image' && (a.dataUrl || a.filePath)),
  )
}

export function defaultGoalForAttachments(attachments: ChatAttachment[]): string {
  const hasImg = attachments.some((a) => a.kind === 'image')
  const hasText = attachments.some((a) => a.kind === 'text')
  if (hasImg && hasText) return '請分析我附上的圖片與檔案內容。'
  if (hasImg) return '請分析我附上的圖片。'
  if (hasText) return '請根據我附上的檔案內容協助處理。'
  return '請處理我附上的檔案。'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Shrink for localStorage — prefer filePath; drop huge dataUrls */
export function sanitizeAttachmentsForStorage(
  attachments: ChatAttachment[] | undefined,
): ChatAttachment[] | undefined {
  if (!attachments?.length) return undefined
  return attachments.map((a) => {
    let dataUrl = a.dataUrl
    // If on disk, drop large dataUrl to save quota (reload via filePath)
    if (a.filePath && dataUrl && dataUrl.length > 80_000) {
      dataUrl = undefined
    } else if (dataUrl && dataUrl.length > PERSIST_DATAURL_MAX) {
      dataUrl = undefined
    }
    let textContent = a.textContent
    if (textContent && textContent.length > 12_000) {
      textContent = textContent.slice(0, 12_000) + '\n…(截斷)'
    }
    return { ...a, dataUrl, textContent }
  })
}

/** Write attachments to disk (Electron); no-op in browser */
export async function materializeAttachmentsOnDisk(
  attachments: ChatAttachment[] | undefined,
  opts?: { projectRoot?: string; sessionId?: string },
): Promise<ChatAttachment[]> {
  if (!attachments?.length) return []
  const api = window.subagents?.attachments?.materialize
  if (!api) return attachments
  try {
    const r = await api({
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        kind: a.kind,
        dataUrl: a.dataUrl,
        textContent: a.textContent,
        filePath: a.filePath,
        size: a.size,
      })),
      projectRoot: opts?.projectRoot,
      sessionId: opts?.sessionId,
    })
    if (!r?.ok || !r.items?.length) return attachments
    return r.items.map((item, i) => {
      const prev = attachments[i] || attachments.find((x) => x.id === item.id)
      return {
        id: item.id || prev?.id || `att_${i}`,
        kind: (item.kind || prev?.kind || 'binary') as ChatAttachment['kind'],
        name: item.name || prev?.name || 'file',
        mimeType: item.mimeType || prev?.mimeType || 'application/octet-stream',
        size: item.size ?? prev?.size ?? 0,
        dataUrl: item.dataUrl || prev?.dataUrl,
        textContent: item.textContent ?? prev?.textContent,
        filePath: item.filePath || prev?.filePath,
      }
    })
  } catch {
    return attachments
  }
}

/** Restore dataUrl from filePath for vision / preview */
export async function hydrateAttachmentsFromDisk(
  attachments: ChatAttachment[] | undefined,
): Promise<ChatAttachment[]> {
  if (!attachments?.length) return []
  const read = window.subagents?.attachments?.readDataUrl
  if (!read) return attachments
  const out: ChatAttachment[] = []
  for (const a of attachments) {
    if (a.dataUrl || !a.filePath || a.kind !== 'image') {
      out.push(a)
      continue
    }
    try {
      const r = await read(a.filePath)
      if (r.ok && r.dataUrl) {
        const [normalized] = await normalizeImageAttachmentsForVision([
          { ...a, dataUrl: r.dataUrl },
        ])
        out.push(normalized)
      } else {
        out.push(a)
      }
    } catch {
      out.push(a)
    }
  }
  return out
}

/** Appendix mentioning on-disk paths (heuristic / no-vision fallback) */
export function attachmentsPathAppendix(attachments: ChatAttachment[]): string {
  const paths = attachments.filter((a) => a.filePath)
  if (!paths.length) return ''
  return [
    '## 附件本機路徑',
    ...paths.map((a) => `- [${a.kind}] ${a.filePath}`),
  ].join('\n')
}

export function contentPartsToPlainText(
  content: string | null | MultimodalContentPart[] | undefined,
): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return content
    .map((p) => {
      if (p.type === 'text') return p.text
      if (p.type === 'image_url') return '[image]'
      return ''
    })
    .join('\n')
}
