import { canonicalProjectId, type MemoryAccessContext } from '../electron/durableMemoryStore.ts'
import { createPiDurableMemoryBridge } from '../electron/piDurableMemory.ts'
import { setPiMemoryBridge } from '../electron/piPackBridges.ts'
import { createPiHostServer, PI_HOST_PROTOCOL_VERSION, type PiHostMessage } from '../electron/piHostProtocol.ts'
import { settlePiRunLearning } from '../electron/piRunLearningSettlement.ts'
import { SqliteDurableMemoryStore } from '../electron/sqliteDurableMemoryStore.ts'
import { bindPiSessionRun, executePiPackTool, unbindPiSessionRun } from '../electron/piToolHost.ts'

const databasePath = process.argv[2]
if (!databasePath) throw new Error('database path is required')

const store = await SqliteDurableMemoryStore.open(databasePath)
const messages: PiHostMessage[] = []
const server = createPiHostServer((message) => messages.push(message), undefined, undefined, undefined, undefined, store)
const admin = (callId: string): MemoryAccessContext => ({
  origin: 'admin', memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false, callId,
})
const project = canonicalProjectId('/workspace/failure-matrix')
const dreamProject = canonicalProjectId('/workspace/failure-matrix-dream')
const clearProject = canonicalProjectId('/workspace/failure-matrix-clear')
const createdAt = '2026-08-27T00:00:00.000Z'
let nextId = 1

async function send(method: string, params: Record<string, unknown>) {
  const id = nextId++
  await server.handle({ id, method, params })
  const response = messages.find((message): message is Extract<PiHostMessage, { id: string | number }> => 'id' in message && message.id === id)
  if (!response || response.error) throw new Error(response?.error?.message || `missing response for ${method}`)
  return response.result?.memoryStore
}

await send('initialize', { protocolVersion: PI_HOST_PROTOCOL_VERSION, capabilities: ['memory-store-v1'] })

const runtime: MemoryAccessContext = {
  origin: 'runtime', canonicalProject: project, memoryReadEnabled: true, memoryWriteEnabled: true,
  temporary: false, runId: 'matrix-tool-run', sessionId: 'matrix-tool-session', callId: 'matrix-tool-call',
}
setPiMemoryBridge(createPiDurableMemoryBridge(store))
bindPiSessionRun(runtime.sessionId!, { runId: runtime.runId!, memoryAccess: runtime })
const toolResult = await executePiPackTool('memory_set', { key: 'tool-write', text: 'tool acknowledged body' }, {
  sessionId: runtime.sessionId!, runId: runtime.runId!, cwd: project,
}, { callId: runtime.callId! })
if ((toolResult.data as { ok?: boolean } | undefined)?.ok !== true) throw new Error('tool write was not acknowledged')
unbindPiSessionRun(runtime.sessionId!)

for (const mode of ['explicit', 'automatic'] as const) {
  const candidate = {
    mode,
    memory: {
      id: `${mode}-learning`, project, text: `${mode} acknowledged body`, tags: ['turn-memory', mode], createdAt,
    },
    access: {
      runId: `matrix-${mode}-run`, sessionId: `matrix-${mode}-session`, canonicalProject: project,
      memoryReadEnabled: true, memoryWriteEnabled: true, temporary: false,
    },
  }
  const settled = await settlePiRunLearning({
    store,
    candidate,
    outcome: { status: 'success', executionKind: 'loop', ...(mode === 'automatic' ? { dodMet: true } : {}) },
  })
  if (!settled.committed) throw new Error(`${mode} learning was not acknowledged`)
}

const upsert = (access: MemoryAccessContext, scope: Record<string, unknown>, logicalKey: string, text: string, kind = 'memory') =>
  send('memory/v1/upsert', { access, entry: { scope, logicalKey, kind, text, tags: ['matrix'], createdAt } })

await upsert(admin('profile'), { kind: 'global' }, 'profile:user', 'profile acknowledged body', 'profile')
await upsert(admin('admin-edit-1'), { kind: 'project', project }, 'admin-edit', 'admin original body')
await upsert(admin('admin-edit-2'), { kind: 'project', project }, 'admin-edit', 'admin edited body')
await upsert(admin('delete-seed'), { kind: 'project', project }, 'delete-me', 'deleted private body')
await send('memory/v1/delete-entry', { access: admin('delete'), scope: { kind: 'project', project }, logicalKey: 'delete-me' })
await upsert(admin('clear-seed'), { kind: 'project', project: clearProject }, 'clear-me', 'cleared private body')
await send('memory/v1/clear-project', { access: admin('clear'), project: clearProject })

for (const key of ['dream-a', 'dream-b', 'dream-c']) {
  await send('memory/v1/upsert', { access: admin(`seed-${key}`), entry: {
    scope: { kind: 'project', project: dreamProject }, logicalKey: key, kind: 'memory',
    text: 'same dream candidate body', tags: ['auto'], createdAt,
  } })
}
await send('memory/v1/consolidate-dream', {
  access: { origin: 'consolidation', canonicalProject: dreamProject, memoryReadEnabled: false, memoryWriteEnabled: false, temporary: false },
  scope: { kind: 'project', project: dreamProject }, operationId: 'matrix-dream', force: true,
})

const bundle = {
  schema: 'subagents.durable-memory', version: 1, generatedAt: createdAt, revision: 0,
  privacy: { plaintext: true, warning: 'plaintext user data' },
  entries: [{
    id: 'import-source', scope: { kind: 'global' }, logicalKey: 'imported', kind: 'memory',
    text: 'import acknowledged body', tags: ['matrix'], createdAt, updatedAt: createdAt, revision: 1,
    provenance: { origin: 'admin', operation: 'export' },
  }],
}
const preview = await send('memory/v1/import-preview', { access: admin('import-preview'), bundle, mode: 'skip' })
await send('memory/v1/import-apply', {
  access: admin('import-apply'), bundle, mode: 'skip', operationId: 'matrix-import',
  previewId: preview?.preview?.previewId, expectedRevision: preview?.preview?.revision,
})

const revision = await store.revision()
process.stdout.write(`${JSON.stringify({ fixture: 'acknowledged', revision })}\n`)
process.stdin.resume()
await new Promise<void>((resolve) => process.stdin.once('end', resolve))
