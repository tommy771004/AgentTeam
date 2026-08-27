import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { piMemoryBridge } from '../piPackBridges.ts'
import { memoryDecayFactor, memoryStalenessNote } from '../../src/agent/hermes/memory.ts'
import { DurableMemoryStoreError, type MemoryStoreErrorCode } from '../durableMemoryStore.ts'
import { structuredFailure, structuredOk } from './packResults.ts'

/**
 * Memory pack（記憶包）— the model-facing half of ONE memory store.
 *
 * The store these tools read and write is the Host's DurableMemoryStore: the
 * same memories `memory/recall` answers from and the same ones a turn recalls
 * before it starts. There is no second copy (issue 06): writing in this turn
 * is recalling in the next.
 *
 * Decay parity with the renderer era is preserved by importing the SAME
 * decay functions: automatic memories fade on a 7-day half-life, hand-written
 * and curated memories do not decay, and stale automatic memories carry an
 * explicit verification note instead of silent rot.
 */

const memorySet: PiPackTool = {
  name: 'memory_set',
  label: 'Memory Set',
  description: 'Write a durable memory so later runs can recall it',
  promptSnippet: 'store a durable memory for future runs',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Short stable key, e.g. user-pref-language' },
      text: { type: 'string', description: 'What to remember' },
    },
    required: ['key', 'text'],
  },
  execute: async (args, ctx) => {
    if (ctx.temporaryChat) return memoryFailure('temporary chat 不寫入記憶', 'forbidden')
    const key = String(args.key || '').trim()
    const text = String(args.text || '').trim()
    if (!key || !text) return memoryFailure('key 與 text 必填', 'invalid_input')
    try {
      const memoryWrite = await piMemoryBridge().set({ key, text, tags: ['curated', `session:${ctx.sessionId}`] }, ctx)
      return structuredOk(`已記住 ${key}`, { id: key, memoryWrite })
    } catch (error) {
      return memoryStoreFailure(error)
    }
  },
}

const memoryGet: PiPackTool = {
  name: 'memory_get',
  label: 'Memory Get',
  description: 'Read one stored memory by id',
  promptSnippet: 'read one stored memory by id',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Memory id' } },
    required: ['id'],
  },
  execute: async (args, ctx) => {
    try {
      const found = await piMemoryBridge().get(String(args.id || '').trim(), ctx)
      if (!found) return memoryFailure(`找不到記憶：${String(args.id || '')}`, 'not_found')
      return structuredOk(found.text, found)
    } catch (error) {
      return memoryStoreFailure(error)
    }
  },
}

const memoryAppend: PiPackTool = {
  name: 'memory_append',
  label: 'Memory Append',
  description: 'Add one more memory entry without overwriting existing ones',
  promptSnippet: 'append one more memory entry',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What to remember' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags; auto/flush entries decay' },
    },
    required: ['text'],
  },
  execute: async (args, ctx) => {
    if (ctx.temporaryChat) return memoryFailure('temporary chat 不寫入記憶', 'forbidden')
    const text = String(args.text || '').trim()
    if (!text) return memoryFailure('text 必填', 'invalid_input')
    const rawTags = Array.isArray(args.tags) ? args.tags : []
    const tags = ['auto', ...rawTags.map((tag) => String(tag)).filter(Boolean), `session:${ctx.sessionId}`]
    if (!ctx.runId || !ctx.callId) return memoryFailure('記憶寫入缺少 run/call identity', 'invalid_input')
    try {
      const memoryWrite = await piMemoryBridge().append({ text, tags }, ctx)
      return structuredOk(`已附加記憶 ${memoryWrite.logicalKey}`, { id: memoryWrite.logicalKey, memoryWrite })
    } catch (error) {
      return memoryStoreFailure(error)
    }
  },
}

const memorySearch: PiPackTool = {
  name: 'memory_search',
  label: 'Memory Search',
  description: 'Recall stored memories relevant to a query',
  promptSnippet: 'recall stored memories by query',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query terms' },
      limit: { type: 'integer', description: 'Max hits (1-10)', default: 5 },
    },
    required: ['query'],
  },
  execute: async (args, ctx) => {
    const query = String(args.query || '').trim()
    if (!query) return memoryFailure('query 必填', 'invalid_input')
    const nowMs = Date.now()
    let hits
    try {
      hits = await piMemoryBridge().search(query, Math.max(1, Math.min(10, Number(args.limit) || 5)), ctx)
    } catch (error) {
      return memoryStoreFailure(error)
    }
    // Staleness rides WITH the hit, so old automatic memories announce
    // themselves instead of reading as current fact.
    const lines = hits.map((hit) => `- [${hit.id}] ${hit.text}${memoryStalenessNote(hit, nowMs)}`)
    return {
      content: [{ type: 'text', text: lines.length ? lines.join('\n') : '（沒有符合的記憶）' }],
      details: { ok: true, results: hits.map((hit) => ({ ...hit, decayFactor: memoryDecayFactor(hit, nowMs), stalenessNote: memoryStalenessNote(hit, nowMs) })) },
    }
  },
}

function memoryFailure(error: string, code: MemoryStoreErrorCode) {
  return structuredFailure(error, { code })
}

function memoryStoreFailure(error: unknown) {
  if (error instanceof DurableMemoryStoreError) return memoryFailure(error.message, error.code)
  return memoryFailure(error instanceof Error ? error.message : 'Durable memory tool failed', 'unavailable')
}



export function buildMemoryPack() {
  return {
    id: 'memory-pack',
    name: 'Memory',
    description: 'Durable cross-run memory backed by the Host memory extension',
    capability: 'memory',
    tools: [memorySet, memoryGet, memoryAppend, memorySearch],
  }
}

let registered = false
export function ensureMemoryPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildMemoryPack())
}
