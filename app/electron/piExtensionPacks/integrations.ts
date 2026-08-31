import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { requestPiHostService } from '../piHostServices.ts'
import type { SideEffectEvidence } from '../../src/agent/evidence/sideEffectEvidence.ts'

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
  policyMigration: { outbound: true },
  execute: async (args) => {
    const url = String(args.url || '').trim()
    const maxChars = Math.max(1, Math.min(200_000, Number(args.maxChars) || 4000))
    if (!/^https?:\/\//i.test(url)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Only http(s) URLs are allowed' }) }], details: { ok: false, error: 'Only http(s) URLs are allowed' } }
    }
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'SubAgentsAI/1.0' }, redirect: 'follow' })
      const text = (await response.text()).slice(0, maxChars)
      // One envelope for every outcome. The success path used to hand back the
      // RAW body while both failure paths returned `{ok:…}`, so the same tool
      // answered in two shapes and a caller could not tell an empty 404 body
      // from a tool that returned nothing. `details` already carried the
      // structured facts; the model-visible content now says the same thing.
      const payload = { ok: response.ok, status: response.status, url, text }
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        details: payload,
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
  policyMigration: { outbound: true },
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
 * in, delivery evidence out. The credential never enters this process:
 * the main-process vault resolves it through the Host service bridge.
 */
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
  policyMigration: { outbound: true, sideEffect: true },
  execute: async (args, context) => {
    const chatId = String(args.chatId || '').trim()
    const text = String(args.text || '').trim()
    if (!chatId || !text) {
      const error = 'chatId 與 text 必填'
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }], details: { ok: false, error } }
    }
    // A model may never supply its own execution credential (ADR-0048).
    try {
      const result = await requestPiHostService<{ ok: boolean; error?: string; evidence?: SideEffectEvidence }>('messaging/send', { chatId, text, runId: context.runId })
      const delivered = result.ok === true
      return {
        content: [{
          type: 'text',
          text: delivered ? `已送出至 telegram:${chatId}` : JSON.stringify({ ok: false, error: result.error || 'Messaging gateway delivery failed' }),
        }],
        details: {
          ok: delivered,
          channel: 'telegram',
          chatId,
          ...(delivered ? { evidence: result.evidence } : { error: result.error || 'Messaging gateway delivery failed' }),
        },
      }
    } catch {
      const message = 'Messaging gateway 不可用，請確認桌面版憑證與連線'
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
