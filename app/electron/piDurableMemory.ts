import {
  canonicalProjectId, DurableMemoryStoreError,
  type DurableMemoryStore, type DurableMemoryEntry, type MemoryAccessContext, type MemoryEntryDraft, type MemoryScope,
} from './durableMemoryStore.ts'
import { isPiMemory, type PiMemory } from './piMemoryExtension.ts'
import type { PiMemoryBridgeAccess } from './piPackBridges.ts'
import { piSessionRunBinding, type PiToolContext } from './piToolHost.ts'

// Only the parent management protocol uses this context. Packs never receive it.
const managementAccess: MemoryAccessContext = {
  origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false,
}

export type PiMemoryChange = {
  operation: 'upsert' | 'delete' | 'clear'
  revision: number
  changed: number
  scope: MemoryScope | { kind: 'all' }
  logicalKey: string
}
type PublishChange = (change: PiMemoryChange) => void

export async function writePiMemory(
  store: DurableMemoryStore, access: MemoryAccessContext, memory: PiMemory, publish?: PublishChange,
): Promise<PiMemory> {
  const before = await store.revision()
  const entry = await store.upsert({ access, ...piMemoryDraft(memory) })
  if (entry.revision > before) publish?.({ operation: 'upsert', revision: entry.revision, changed: 1, scope: entry.scope, logicalKey: entry.logicalKey })
  return piMemoryProjection(entry)
}

export function piMemoryProjection(entry: DurableMemoryEntry): PiMemory {
  return {
    id: entry.logicalKey,
    ...(entry.scope.kind === 'project' ? { project: entry.scope.project } : {}),
    text: entry.text, tags: [...entry.tags], createdAt: entry.createdAt,
  }
}

export function piMemoryDraft(memory: PiMemory): MemoryEntryDraft {
  const scope = memory.project ? { kind: 'project' as const, project: canonicalProjectId(memory.project) } : { kind: 'global' as const }
  const kind = scope.kind === 'global' && memory.id === 'profile:user' ? 'profile'
    : scope.kind === 'global' && memory.id === 'memory:document' ? 'document' : 'memory'
  return { scope, logicalKey: memory.id, kind, text: memory.text, tags: memory.tags, createdAt: memory.createdAt } as MemoryEntryDraft
}

/** Transitional parent-only projection; JSON is never read or written here. */
export async function listPiMemories(store: DurableMemoryStore): Promise<PiMemory[]> {
  return (await store.exportBundle({ access: managementAccess })).entries.map(piMemoryProjection)
}

export async function handleLegacyMemory(
  store: DurableMemoryStore, method: string, params: Record<string, unknown>, publish?: PublishChange,
): Promise<PiMemory[]> {
  if (method === 'memory/add') {
    if (!isPiMemory(params.memory)) throw new DurableMemoryStoreError('invalid_input', 'memory must include id, text, tags, and createdAt')
    await writePiMemory(store, managementAccess, params.memory, publish)
  } else if (method === 'memory/delete') {
    const matches = (await listPiMemories(store)).filter((memory) => memory.id === params.id)
    if (typeof params.id !== 'string' || !params.id) throw new DurableMemoryStoreError('invalid_input', 'memory id is required')
    if (matches.length > 1) throw new DurableMemoryStoreError('invalid_input', '同 key 存在多個 scope；請使用 scoped memory/v1/delete。')
    if (matches[0]) {
      const scope = piMemoryDraft(matches[0]).scope
      const result = await store.delete({ access: managementAccess, scope, logicalKey: matches[0].id })
      if (result.changed) publish?.({ operation: 'delete', ...result, scope, logicalKey: matches[0].id })
    }
  } else if (method === 'memory/clear') {
    const result = await store.clear({ access: managementAccess, scope: { kind: 'all' } })
    if (result.changed) publish?.({ operation: 'clear', ...result, scope: { kind: 'all' }, logicalKey: '' })
  } else if (method === 'memory/recall') {
    const access: MemoryAccessContext = typeof params.project === 'string' && params.project
      ? { origin: 'runtime', canonicalProject: canonicalProjectId(params.project), memoryReadEnabled: true, memoryWriteEnabled: false, temporary: false }
      : managementAccess
    return (await store.recall({ access, query: String(params.query || ''), limit: typeof params.limit === 'number' ? params.limit : undefined })).items.map(piMemoryProjection)
  }
  return listPiMemories(store)
}

function runtimeAccess(ctx: PiToolContext): MemoryAccessContext {
  const binding = piSessionRunBinding(ctx.sessionId)
  if (!ctx.runId || binding?.runId !== ctx.runId || !binding.memoryAccess) {
    throw new DurableMemoryStoreError('forbidden', '記憶工具需要有效任務與凍結的記憶權限。')
  }
  return { ...binding.memoryAccess, ...(ctx.callId ? { callId: ctx.callId } : {}) }
}

export function createPiDurableMemoryBridge(store: DurableMemoryStore, publish?: PublishChange): PiMemoryBridgeAccess {
  return {
    search: async (query, limit, ctx) => (await store.recall({ access: runtimeAccess(ctx), query, limit })).items.map(piMemoryProjection),
    get: async (id, ctx) => {
      const access = runtimeAccess(ctx)
      // Project-specific value wins over a global value with the same key.
      const project = access.canonicalProject
        ? await store.get({ access, scope: { kind: 'project', project: access.canonicalProject }, logicalKey: id }) : undefined
      const found = project || await store.get({ access, scope: { kind: 'global' }, logicalKey: id })
      return found ? piMemoryProjection(found) : undefined
    },
    add: async (memory, ctx) => {
      const access = runtimeAccess(ctx)
      return writePiMemory(store, access, {
        ...memory, project: access.canonicalProject,
        createdAt: piSessionRunBinding(ctx.sessionId)!.memoryCreatedAt!,
      }, publish)
    },
  }
}
