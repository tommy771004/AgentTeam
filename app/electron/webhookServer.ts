/**
 * Local HTTP webhook receiver for Proactive pattern events.
 * POST /webhook  or  POST /events
 * Optional header: Authorization: Bearer <token>
 */

import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type WebhookPayload = {
  receivedAt: string
  path: string
  source?: string
  subject?: string
  hasAttachment?: boolean
  body?: string
  keyword?: string
  headers: Record<string, string>
  raw: unknown
}

export type WebhookStatus = {
  running: boolean
  port: number
  token: string
  url: string | null
  lastError: string | null
  hitCount: number
}

type Handler = (payload: WebhookPayload) => void

let server: http.Server | null = null
let status: WebhookStatus = {
  running: false,
  port: 8787,
  token: '',
  url: null,
  lastError: null,
  hitCount: 0,
}
let onEvent: Handler | null = null

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(body)
}

function parsePayload(rawText: string, path: string, headers: Record<string, string>): WebhookPayload {
  let raw: unknown = rawText
  try {
    raw = rawText ? JSON.parse(rawText) : {}
  } catch {
    raw = { text: rawText }
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    receivedAt: new Date().toISOString(),
    path,
    source: String(obj.source || obj.event || obj.type || 'webhook.http'),
    subject: obj.subject != null ? String(obj.subject) : undefined,
    hasAttachment:
      obj.hasAttachment != null
        ? Boolean(obj.hasAttachment)
        : obj.attachment != null
          ? Boolean(obj.attachment)
          : undefined,
    body: obj.body != null ? String(obj.body) : obj.text != null ? String(obj.text) : undefined,
    keyword: obj.keyword != null ? String(obj.keyword) : undefined,
    headers,
    raw,
  }
}

export function setWebhookHandler(handler: Handler | null) {
  onEvent = handler
}

export function getWebhookStatus(): WebhookStatus {
  return { ...status }
}

export async function startWebhookServer(opts: {
  port?: number
  token?: string
}): Promise<WebhookStatus> {
  if (server) {
    await stopWebhookServer()
  }

  const port = opts.port && opts.port > 0 ? opts.port : 8787
  const token = opts.token || ''

  server = http.createServer(async (req, res) => {
    const url = req.url || '/'
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      sendJson(res, 204, {})
      return
    }

    if (method === 'GET' && (url === '/' || url === '/health')) {
      sendJson(res, 200, {
        ok: true,
        service: 'SubAgents AI Webhook',
        endpoints: ['POST /webhook', 'POST /events', 'GET /health'],
        hits: status.hitCount,
      })
      return
    }

    if (method === 'POST' && (url.startsWith('/webhook') || url.startsWith('/events'))) {
      // Auth: Bearer token or X-Webhook-Token
      if (token) {
        const auth = req.headers.authorization || ''
        const headerToken = String(req.headers['x-webhook-token'] || '')
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
        if (bearer !== token && headerToken !== token) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' })
          return
        }
      }

      try {
        const text = await readBody(req)
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers[k] = v
          else if (Array.isArray(v)) headers[k] = v.join(',')
        }
        const payload = parsePayload(text, url, headers)
        status.hitCount += 1
        onEvent?.(payload)
        sendJson(res, 202, {
          ok: true,
          accepted: true,
          source: payload.source,
          receivedAt: payload.receivedAt,
        })
      } catch (e) {
        sendJson(res, 400, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return
    }

    sendJson(res, 404, { ok: false, error: 'Not found' })
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', (err) => {
      status.lastError = err.message
      status.running = false
      status.url = null
      server = null
      reject(err)
    })
    server!.listen(port, '127.0.0.1', () => {
      status = {
        running: true,
        port,
        token,
        url: `http://127.0.0.1:${port}/webhook`,
        lastError: null,
        hitCount: status.hitCount,
      }
      resolve()
    })
  })

  return getWebhookStatus()
}

export async function stopWebhookServer(): Promise<WebhookStatus> {
  if (!server) {
    status.running = false
    status.url = null
    return getWebhookStatus()
  }
  const s = server
  server = null
  await new Promise<void>((resolve) => {
    s.close(() => resolve())
  })
  status.running = false
  status.url = null
  return getWebhookStatus()
}
