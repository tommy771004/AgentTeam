/**
 * Messaging Gateway — Hermes-inspired edge channel
 * Phase 5: Telegram Bot long-polling (+ generic outbound API)
 */

export type GatewayChannel = 'telegram' | 'webhook' | 'system'

export type GatewayInbound = {
  channel: GatewayChannel
  chatId: string
  text: string
  from?: string
  messageId?: string | number
  receivedAt: string
  raw?: unknown
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
          message?: {
            message_id: number
            text?: string
            chat: { id: number }
            from?: { username?: string; first_name?: string }
          }
        }>
      >(token, 'getUpdates', {
        offset: updateOffset,
        timeout: 25,
        allowed_updates: ['message'],
      })

      for (const u of updates || []) {
        updateOffset = u.update_id + 1
        const msg = u.message
        if (!msg?.text) continue
        const chatId = String(msg.chat.id)
        if (allowedChatIds.size > 0 && !allowedChatIds.has(chatId)) {
          // silently ignore unauthorized chats
          continue
        }
        messageCount += 1
        lastMessageAt = new Date().toISOString()
        const inbound: GatewayInbound = {
          channel: 'telegram',
          chatId,
          text: msg.text,
          from: msg.from?.username || msg.from?.first_name,
          messageId: msg.message_id,
          receivedAt: lastMessageAt,
          raw: u,
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
  if (telegramLoop) {
    // give poll a moment; it will exit on next error/timeout
    await Promise.race([telegramLoop, sleep(500)])
  }
  return getGatewayStatus()
}

export async function gatewaySendMessage(input: {
  channel: GatewayChannel
  chatId: string
  text: string
  token?: string
}): Promise<{ ok: boolean; error?: string }> {
  const text = (input.text || '').slice(0, 4000)
  if (!text) return { ok: false, error: 'empty text' }

  if (input.channel === 'telegram') {
    const token = (input.token || telegramToken).trim()
    if (!token) return { ok: false, error: 'Telegram token missing' }
    try {
      await telegramApi(token, 'sendMessage', {
        chat_id: input.chatId,
        text,
        // keep plain text for reliability
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { ok: false, error: `channel ${input.channel} send not supported` }
}
