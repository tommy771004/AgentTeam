import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'

/**
 * Integrations pack（整合包）— outbound web access and messaging.
 *
 * These are the tools research tasks were silently downgraded without
 * (user story 6): every one of them is an OUTBOUND channel, so each goes
 * through the Outbound Data Gate's admission rules here on the Host side,
 * where execution actually happens.
 */

const httpFetch: PiPackTool = {
  name: 'http_fetch',
  label: 'HTTP Fetch',
  description: 'Fetch a public HTTP(S) URL as text',
  // Pi renders this snippet as `- <name>: <snippet>`, so it must not repeat
  // the tool's own name.
  promptSnippet: 'fetch a public HTTP(S) URL and read its text',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP(S) URL' },
      maxChars: { type: 'integer', description: 'Max response characters', default: 4000 },
    },
    required: ['url'],
  },
  execute: async (args) => {
    const url = String(args.url || '').trim()
    const maxChars = Math.max(1, Math.min(200_000, Number(args.maxChars) || 4000))
    if (!/^https?:\/\//i.test(url)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Only http(s) URLs are allowed' }) }], details: { ok: false, error: 'Only http(s) URLs are allowed' } }
    }
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'SubAgentsAI/1.0' }, redirect: 'follow' })
      const text = (await response.text()).slice(0, maxChars)
      return {
        content: [{ type: 'text', text }],
        details: { ok: response.ok, status: response.status, url, text },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], details: { ok: false, error: message } }
    }
  },
}

const webSearch: PiPackTool = {
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web / Wikipedia for facts and sources',
  promptSnippet: 'search Wikipedia for facts and sources',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'integer', description: 'Max results (1-8)', default: 5 },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const query = String(args.query || '').trim()
    const limit = Math.max(1, Math.min(8, Number(args.limit) || 5))
    if (!query) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'query is required' }) }], details: { ok: false, error: 'query is required' } }
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`
      const response = await fetch(url, { headers: { 'User-Agent': 'SubAgentsAI/1.0 (desktop agent; research tool)' } })
      if (!response.ok) throw new Error(`Search HTTP ${response.status}`)
      const data = await response.json() as [string, string[], string[], string[]]
      const titles = data[1] || []
      const snippets = data[2] || []
      const links = data[3] || []
      const results = titles.map((title, index) => ({ title, snippet: snippets[index] || title, url: links[index] }))
      const lines = results.map((result) => `- ${result.title}: ${result.snippet}${result.url ? ` (${result.url})` : ''}`)
      return {
        content: [{ type: 'text', text: lines.length ? lines.join('\n') : '（沒有搜尋結果）' }],
        details: { ok: true, query, results },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], details: { ok: false, error: message } }
    }
  },
}

/**
 * Messaging rides the same gateway contract the renderer used: chatId + text
 * in, delivery evidence out. The credential is OPERATOR property: it reaches
 * this pack through the gateway configuration bridge and never through model
 * arguments (ADR-0048 — a model may not supply its own execution credential).
 */
let messagingGatewayToken = process.env.SUBAGENTS_TELEGRAM_BOT_TOKEN?.trim() || ''

export function configurePiMessagingGateway(input: { botToken?: unknown }): void {
  if (typeof input.botToken === 'string') messagingGatewayToken = input.botToken.trim()
}

const messageSend: PiPackTool = {
  name: 'message_send',
  label: 'Message Send',
  description: 'Send a message via messaging gateway (Telegram etc.)',
  promptSnippet: 'deliver a message through the configured messaging gateway',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: ['telegram'], description: 'Messaging channel' },
      chatId: { type: 'string', description: 'Chat / channel id' },
      text: { type: 'string', description: 'Message body' },
    },
    required: ['chatId', 'text'],
  },
  approval: () => ({ need: true, reason: 'message_send sends a message outside this machine' }),
  execute: async (args) => {
    const chatId = String(args.chatId || '').trim()
    const text = String(args.text || '').trim()
    if (!chatId || !text) {
      const error = 'chatId 與 text 必填'
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }], details: { ok: false, error } }
    }
    // A model may never supply its own execution credential (ADR-0048).
    if (!messagingGatewayToken) {
      const error = 'Messaging gateway 未設定憑證：請在 Settings 補填 Telegram Bot Token'
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }], details: { ok: false, error } }
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(messagingGatewayToken)}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      })
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string; result?: { message_id?: number } }
      const delivered = response.ok && payload.ok === true
      return {
        content: [{
          type: 'text',
          text: delivered ? `已送出至 telegram:${chatId}` : JSON.stringify({ ok: false, error: payload.description || `gateway HTTP ${response.status}` }),
        }],
        details: {
          ok: delivered,
          channel: 'telegram',
          chatId,
          ...(delivered ? { messageId: payload.result?.message_id } : { error: payload.description || `gateway HTTP ${response.status}` }),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], details: { ok: false, error: message } }
    }
  },
}

export function buildIntegrationsPack() {
  return {
    id: 'integrations',
    name: 'Integrations',
    description: 'Outbound web access (search, fetch)',
    capability: 'web-research',
    tools: [httpFetch, webSearch],
  }
}

/** Messaging is its own boundary in CONTEXT.md; it keeps its own capability gate. */
export function buildMessagingPack() {
  return {
    id: 'messaging',
    name: 'Messaging',
    description: 'Outbound message delivery through the configured gateway',
    capability: 'messaging',
    tools: [messageSend],
  }
}

let registered = false
export function ensureIntegrationsPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildIntegrationsPack())
  registerPiExtensionPack(buildMessagingPack())
}
