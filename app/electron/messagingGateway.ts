/**
 * Messaging Gateway — Hermes-inspired edge channel
 * Phase 5: Telegram Bot long-polling (+ generic outbound API)
 * Supports text + photo/document attachments (downloaded as data URLs).
 */

export type GatewayChannel = 'telegram' | 'webhook' | 'system'

export type GatewayAttachment = {
  name: string
  mimeType: string
  kind: 'image' | 'text' | 'binary'
  dataUrl?: string
  size?: number
}

export type GatewayInbound = {
  channel: GatewayChannel
  chatId: string
  text: string
  from?: string
  messageId?: string | number
  receivedAt: string
  raw?: unknown
  attachments?: GatewayAttachment[]
}

export type GatewayStatus = {
  telegram: {
    running: boolean
    botUsername: string | null
    lastError: string | null
    updateOffset: number
    messageCount: number
    lastMessageAt: string | null
  }
}

type InboundHandler = (msg: GatewayInbound) => void

let onInbound: InboundHandler | null = null
let telegramAbort = false
let telegramRunning = false
let telegramLoop: Promise<void> | null = null
let telegramToken = ''
let allowedChatIds = new Set<string>()
let updateOffset = 0
let messageCount = 0
let lastMessageAt: string | null = null
let lastError: string | null = null
let botUsername: string | null = null

const MAX_TG_FILE_BYTES = 8 * 1024 * 1024

export function setGatewayInboundHandler(handler: InboundHandler | null) {
  onInbound = handler
}

export function getGatewayStatus(): GatewayStatus {
  return {
    telegram: {
      running: telegramRunning,
      botUsername,
      lastError,
      updateOffset,
      messageCount,
      lastMessageAt,
    },
  }
}

function parseAllowed(ids: string | string[] | undefined): Set<string> {
  if (!ids) return new Set()
  const list = Array.isArray(ids)
    ? ids
    : ids
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
  return new Set(list.map(String))
}

async function telegramApi<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `https://api.telegram.org/bot${token}/${method}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string }
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`)
  }
  return data.result as T
}

type TgPhotoSize = { file_id: string; file_size?: number; width?: number; height?: number }
type TgDocument = {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}
type TgMessage = {
  message_id: number
  text?: string
  caption?: string
  chat: { id: number }
  from?: { username?: string; first_name?: string }
  photo?: TgPhotoSize[]
  document?: TgDocument
}

async function downloadTelegramFile(
  token: string,
  fileId: string,
  nameHint: string,
  mimeHint?: string,
): Promise<GatewayAttachment | null> {
  try {
    const meta = await telegramApi<{ file_path?: string; file_size?: number }>(
      token,
      'getFile',
      { file_id: fileId },
    )
    if (!meta.file_path) return null
    if (meta.file_size && meta.file_size > MAX_TG_FILE_BYTES) {
      return {
        name: nameHint,
        mimeType: mimeHint || 'application/octet-stream',
        kind: 'binary',
        size: meta.file_size,
      }
    }
    const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.file_path}`
    const res = await fetch(fileUrl)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_TG_FILE_BYTES) {
      return {
        name: nameHint,
        mimeType: mimeHint || 'application/octet-stream',
        kind: 'binary',
        size: buf.byteLength,
      }
    }
    let mime = mimeHint || res.headers.get('content-type') || ''
    if (!mime) {
      const ext = nameHint.split('.').pop()?.toLowerCase() || ''
      if (ext === 'png') mime = 'image/png'
      else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg'
      else if (ext === 'gif') mime = 'image/gif'
      else if (ext === 'webp') mime = 'image/webp'
      else mime = 'application/octet-stream'
    }
    const b64 = buf.toString('base64')
    const isImage = mime.startsWith('image/')
    return {
      name: nameHint,
      mimeType: mime,
      kind: isImage ? 'image' : 'binary',
      dataUrl: `data:${mime};base64,${b64}`,
      size: buf.byteLength,
    }
  } catch {
    return null
  }
}

async function extractAttachments(
  token: string,
  msg: TgMessage,
): Promise<GatewayAttachment[]> {
  const out: GatewayAttachment[] = []
  if (msg.photo?.length) {
    // largest photo last
    const best = msg.photo[msg.photo.length - 1]
    const att = await downloadTelegramFile(
      token,
      best.file_id,
      `tg-photo-${msg.message_id}.jpg`,
      'image/jpeg',
    )
    if (att) out.push(att)
  }
  if (msg.document?.file_id) {
    const d = msg.document
    const att = await downloadTelegramFile(
      token,
      d.file_id,
      d.file_name || `tg-doc-${msg.message_id}`,
      d.mime_type,
    )
    if (att) out.push(att)
  }
  return out
}

async function pollLoop(token: string) {
  // resolve bot username once
  try {
    const me = await telegramApi<{ username?: string }>(token, 'getMe')
    botUsername = me.username || null
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
  }

  while (!telegramAbort) {
    try {
      const updates = await telegramApi<
        Array<{
          update_id: number
          message?: TgMessage
        }>
      >(token, 'getUpdates', {
        offset: updateOffset,
        timeout: 25,
        allowed_updates: ['message'],
      })

      for (const u of updates || []) {
        updateOffset = u.update_id + 1
        const msg = u.message
        if (!msg) continue
        const text = (msg.text || msg.caption || '').trim()
        const hasMedia = Boolean(msg.photo?.length || msg.document)
        if (!text && !hasMedia) continue

        const chatId = String(msg.chat.id)
        if (allowedChatIds.size > 0 && !allowedChatIds.has(chatId)) {
          // silently ignore unauthorized chats
          continue
        }
        messageCount += 1
        lastMessageAt = new Date().toISOString()
        const attachments = hasMedia ? await extractAttachments(token, msg) : []
        const inbound: GatewayInbound = {
          channel: 'telegram',
          chatId,
          text: text || (attachments.length ? '請分析我附上的圖片或檔案。' : ''),
          from: msg.from?.username || msg.from?.first_name,
          messageId: msg.message_id,
          receivedAt: lastMessageAt,
          raw: u,
          attachments: attachments.length ? attachments : undefined,
        }
        onInbound?.(inbound)
      }
      lastError = null
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      // back off on errors
      await sleep(3000)
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function startTelegramGateway(opts: {
  token: string
  allowedChatIds?: string | string[]
}): Promise<GatewayStatus> {
  const token = (opts.token || '').trim()
  if (!token) {
    lastError = '缺少 Telegram Bot Token'
    return getGatewayStatus()
  }
  if (telegramRunning) {
    // restart with new config
    await stopTelegramGateway()
  }
  telegramToken = token
  allowedChatIds = parseAllowed(opts.allowedChatIds)
  telegramAbort = false
  telegramRunning = true
  lastError = null
  telegramLoop = pollLoop(token).finally(() => {
    telegramRunning = false
    telegramLoop = null
  })
  return getGatewayStatus()
}

export async function stopTelegramGateway(): Promise<GatewayStatus> {
  telegramAbort = true
  // wake long-poll by setting abort; next iteration exits
  // also try a short getUpdates with timeout 0 to not leave hanging forever
  telegramRunning = false
  if (telegramToken) {
    try {
      await telegramApi(telegramToken, 'getUpdates', { offset: updateOffset, timeout: 0 })
    } catch {
      /* ignore */
    }
  }
  if (telegramLoop) {
    try {
      await Promise.race([telegramLoop, sleep(2000)])
    } catch {
      /* ignore */
    }
  }
  telegramToken = ''
  return getGatewayStatus()
}

export async function gatewaySendMessage(input: {
  channel: GatewayChannel
  chatId: string
  text: string
  token?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (input.channel !== 'telegram') {
    return { ok: false, error: 'only telegram outbound supported' }
  }
  const token = (input.token || telegramToken || '').trim()
  if (!token) return { ok: false, error: 'missing telegram token' }
  try {
    await telegramApi(token, 'sendMessage', {
      chat_id: input.chatId,
      text: (input.text || '').slice(0, 4000),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
