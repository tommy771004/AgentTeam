import {
  canonicalProjectId, DurableMemoryStoreError,
  type DurableMemoryStore, type DurableMemoryEntry, type MemoryAccessContext, type MemoryEntryDraft, type MemoryScope,
} from './durableMemoryStore.ts'
import type { PiMemory } from './piMemory.ts'
import type { PiMemoryBridgeAccess, PiMemoryWriteReceipt } from './piPackBridges.ts'
import { piSessionRunBinding, type PiToolContext } from './piToolHost.ts'

export type PiMemoryChange = {
  operation: 'upsert' | 'append' | 'delete' | 'clear'
  revision: number
  changed: number
  scope: MemoryScope | { kind: 'all' }
  logicalKey: string
  write?: PiMemoryWriteReceipt
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

function piMemoryDraft(memory: PiMemory): MemoryEntryDraft {
  const scope = memory.project ? { kind: 'project' as const, project: canonicalProjectId(memory.project) } : { kind: 'global' as const }
  const kind = scope.kind === 'global' && memory.id === 'profile:user' ? 'profile'
    : scope.kind === 'global' && memory.id === 'memory:document' ? 'document' : 'memory'
  return { scope, logicalKey: memory.id, kind, text: memory.text, tags: memory.tags, createdAt: memory.createdAt } as MemoryEntryDraft
}

function runtimeAccess(ctx: PiToolContext): MemoryAccessContext {
  const binding = piSessionRunBinding(ctx.sessionId)
  const access = binding?.memoryAccess
  if (!ctx.runId || binding?.runId !== ctx.runId || !access
    || access.origin !== 'runtime' || !access.canonicalProject
    || access.runId !== ctx.runId || access.sessionId !== ctx.sessionId) {
    throw new DurableMemoryStoreError('forbidden', '記憶工具需要有效任務與凍結的記憶權限。')
  }
  return { ...access, ...(ctx.callId ? { callId: ctx.callId } : {}) }
}

function memoryWriteReceipt(
  operation: PiMemoryWriteReceipt['operation'],
  entry: DurableMemoryEntry,
  access: MemoryAccessContext,
): PiMemoryWriteReceipt {
  if (entry.scope.kind !== 'project' || !access.runId || !access.sessionId || !access.callId) {
    throw new DurableMemoryStoreError('invalid_input', '記憶寫入缺少 project/run/session/call identity。')
  }
  return {
    operation,
    id: entry.id,
    logicalKey: entry.logicalKey,
    scope: 'project',
    revision: entry.revision,
    runId: access.runId,
    sessionId: access.sessionId,
    callId: access.callId,
  }
}

async function commitRuntimeMemory(
  store: DurableMemoryStore,
  access: MemoryAccessContext,
  operation: PiMemoryWriteReceipt['operation'],
  draft: MemoryEntryDraft,
  publish?: PublishChange,
): Promise<PiMemoryWriteReceipt> {
  const before = await store.revision()
  const entry = operation === 'append'
    ? await store.append({ access, ...draft })
    : await store.upsert({ access, ...draft })
  const write = memoryWriteReceipt(operation, entry, access)
  if (entry.revision > before) {
    publish?.({
      operation: operation === 'append' ? 'append' : 'upsert',
      revision: entry.revision,
      changed: 1,
      scope: entry.scope,
      logicalKey: entry.logicalKey,
      write,
    })
  }
  return write
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
    set: async (input, ctx) => {
      const access = runtimeAccess(ctx)
      return commitRuntimeMemory(store, access, 'set', {
        scope: { kind: 'project', project: access.canonicalProject! },
        logicalKey: input.key,
        kind: 'memory',
        text: input.text,
        tags: input.tags,
        createdAt: piSessionRunBinding(ctx.sessionId)!.memoryCreatedAt!,
      }, publish)
    },
    append: async (input, ctx) => {
      const access = runtimeAccess(ctx)
      if (!access.runId || !access.callId) {
        throw new DurableMemoryStoreError('invalid_input', '記憶寫入缺少 run/call identity。')
      }
      return commitRuntimeMemory(store, access, 'append', {
        scope: { kind: 'project', project: access.canonicalProject! },
        logicalKey: `mem-${access.runId}-${access.callId}`,
        kind: 'memory',
        text: input.text,
        tags: input.tags,
        createdAt: piSessionRunBinding(ctx.sessionId)!.memoryCreatedAt!,
      }, publish)
    },
  }
}
