import { registerPiExtensionPack, piPackSessionHandle, type PiPackTool } from '../piToolHost.ts'
import { jsonOk, structuredFailure } from './packResults.ts'

/**
 * Framework pack（框架保留工具）— progressive disclosure's model-facing verbs.
 *
 * `load_capability`, `tool_search`, and `run_code` are RESERVED names
 * (issue 12): they exist here and nowhere else. load_capability reveals a
 * deferred capability's schemas mid-run through the session's own active-tool
 * control; tool_search finds tools past the threshold; run_code nests tool
 * calls through Code Mode, which re-enters this same gate per call.
 */

type CapabilityBridgeAccess = {
  catalog: (sessionId?: string) => Array<{ id: string; description: string; deferred: boolean }>
  load: (id: string, sessionId?: string) => { id: string; tools: string[] } | undefined
  search: (query: string, sessionId?: string) => Array<{ name: string; pack?: string; description: string; schemaDigest: string; active: boolean }>
}

let capabilityBridge: CapabilityBridgeAccess | undefined

/** The protocol installs this over its capability catalog instance. */
export function setPiCapabilityBridge(access: CapabilityBridgeAccess): void {
  capabilityBridge = access
}

const loadCapability: PiPackTool = {
  name: 'load_capability',
  label: 'Load Capability',
  description: 'Activate a deferred capability so its tools become callable now',
  promptSnippet: 'activate a deferred capability and reveal its tools',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Capability id from the catalog' } },
    required: ['id'],
  },
  execute: async (args, ctx) => {
    const id = String(args.id || '').trim()
    if (!capabilityBridge) return structuredFailure('capability catalog 在此 Host 無法使用')
    try {
      const loaded = capabilityBridge.load(id, ctx.sessionId)
      if (!loaded) {
        // Honest refusal: an unknown id never pretends to be loaded.
        return structuredFailure(`未知的 capability：${id}`)
      }
      const handle = piPackSessionHandle(ctx.sessionId)
      if (handle) {
        if (!handle.setActiveTools([...new Set([...handle.getActiveTools(), ...loaded.tools])])) {
          return structuredFailure('Pi session could not activate capability tools')
        }
        handle.refreshContract?.()
      }
      return jsonOk({ capabilityId: loaded.id, activatedTools: loaded.tools })
    } catch (error) {
      return structuredFailure(error instanceof Error ? error.message : 'capability load failed')
    }
  },
}

const toolSearch: PiPackTool = {
  name: 'tool_search',
  label: 'Tool Search',
  description: 'Find tools by keyword across the whole catalog',
  promptSnippet: 'search the tool catalog by keyword',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keyword to match against names and descriptions' },
    },
    required: ['query'],
  },
  execute: async (args, ctx) => {
    const query = String(args.query || '').trim().toLowerCase()
    if (!query) return structuredFailure('query 必填')
    const matches = capabilityBridge?.search(query, ctx.sessionId) || []
    return jsonOk({ matches })
  },
}

const runCode: PiPackTool = {
  name: 'run_code',
  label: 'Run Code',
  description: 'Run JavaScript that can call tools via tools.<name>(args)',
  promptSnippet: 'run sandboxed code that orchestrates tool calls',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript body; use await tools.<name>({...})' },
      timeoutMs: { type: 'integer', description: 'Execution budget in ms' },
      maxToolCalls: { type: 'integer', description: 'Max nested tool calls' },
    },
    required: ['code'],
  },
  approval: () => ({ need: true, reason: 'run_code 以程式方式批次呼叫工具' }),
  execute: async (args, ctx) => {
    // The protocol installs the executor bridge; nesting re-enters the SAME
    // approval decision per call there.
    const executor = piCodeModeExecutor()
    if (!executor) return structuredFailure('code mode 在此 Host 無法使用')
    const result = await executor({
      code: String(args.code || ''),
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      runId: ctx.runId,
    })
    return result.ok
      ? jsonOk({ settlement: result.settlement, toolCallCount: result.toolCallCount, output: result.content.slice(0, 20_000) })
      : structuredFailure(result.content)
  },
}

type PiCodeModeRequest = { code: string; sessionId: string; cwd: string; runId?: string }
type PiCodeModeResult =
  | { ok: true; settlement: string; content: string; toolCallCount: number }
  | { ok: false; content: string }

let codeModeExecutor: ((request: PiCodeModeRequest) => Promise<PiCodeModeResult>) | undefined

export function setPiCodeModeExecutor(executor: (request: PiCodeModeRequest) => Promise<PiCodeModeResult>): void {
  codeModeExecutor = executor
}

function piCodeModeExecutor() {
  return codeModeExecutor
}



export function buildFrameworkPack() {
  return {
    id: 'framework-pack',
    name: 'Framework',
    description: 'Reserved framework verbs: capability loading, tool search, code mode',
    capability: 'code-mode',
    alwaysActive: true,
    tools: [loadCapability, toolSearch, runCode],
  }
}

let registered = false
export function ensureFrameworkPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildFrameworkPack())
}
