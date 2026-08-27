import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import {
  codegraphStatus,
  codegraphExplore,
  codegraphCallers,
  codegraphImpact,
} from '../codegraphBridge.ts'
import { jsonOk, structuredFailure } from './packResults.ts'

type CodegraphDependencies = {
  status: typeof codegraphStatus
  explore: typeof codegraphExplore
  callers: typeof codegraphCallers
  impact: typeof codegraphImpact
}

const DEFAULT_DEPENDENCIES: CodegraphDependencies = {
  status: codegraphStatus,
  explore: codegraphExplore,
  callers: codegraphCallers,
  impact: codegraphImpact,
}

const boundedInteger = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

/**
 * CodeGraph uses the same bridge and `<root>/.codegraph` index as the UI.
 * Dependencies are injectable so the Host-facing behavior can be tested
 * without installing or invoking a real CLI in smoke tests.
 */
export function buildCodegraphPack(deps: CodegraphDependencies = DEFAULT_DEPENDENCIES) {
  const exploreTool: PiPackTool = {
    name: 'codegraph_explore',
    label: 'CodeGraph Explore',
    description: 'Explore the code graph around a symbol or file',
    promptSnippet: 'explore the indexed code graph around a symbol',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol / file to explore' },
        limit: { type: 'integer', description: 'Max files', default: 20, minimum: 1, maximum: 40 },
      },
      required: ['query'],
    },
    execute: async (args, ctx) => {
      const status = await deps.status(ctx.cwd)
      if (!status.installed) return structuredFailure('codegraph CLI 未安裝：無法探索程式圖')
      if (!status.indexed) {
        return jsonOk({
          indexed: false,
          note: `此專案尚未建立索引（${status.projectRoot}）；請先執行索引`,
          projectRoot: status.projectRoot,
        })
      }
      const maxFiles = boundedInteger(args.limit, 20, 40)
      const result = await deps.explore(ctx.cwd, String(args.query || ''), { maxFiles })
      return jsonOk({ indexed: true, ...(result as Record<string, unknown>) })
    },
  }

  const statusTool: PiPackTool = {
    name: 'codegraph_status',
    label: 'CodeGraph Status',
    description: 'Report whether this project has an indexed code graph',
    promptSnippet: 'report the state of the project code graph',
    parameters: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      const status = await deps.status(ctx.cwd)
      return jsonOk({
        installed: status.installed,
        indexed: status.indexed,
        version: status.version,
        projectRoot: status.projectRoot,
        ...(status.error ? { note: status.error } : {}),
      })
    },
  }

  const impactTool: PiPackTool = {
    name: 'codegraph_impact',
    label: 'CodeGraph Impact',
    description: 'Report what changes to a symbol would affect',
    promptSnippet: 'assess the blast radius of changing a symbol',
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Symbol path to assess' } },
      required: ['symbol'],
    },
    execute: async (args, ctx) => {
      const status = await deps.status(ctx.cwd)
      if (!status.installed) return structuredFailure('codegraph CLI 未安裝')
      if (!status.indexed) {
        return jsonOk({
          indexed: false,
          note: '此專案尚未建立索引，無法評估影響面',
          projectRoot: status.projectRoot,
        })
      }
      const result = await deps.impact(ctx.cwd, String(args.symbol || ''))
      return jsonOk({ indexed: true, ...(result as Record<string, unknown>) })
    },
  }

  const callersTool: PiPackTool = {
    name: 'codegraph_callers',
    label: 'CodeGraph Callers',
    description: 'List what calls a function in the indexed graph',
    promptSnippet: 'list callers of a function from the code graph',
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Function to inspect' } },
      required: ['symbol'],
    },
    execute: async (args, ctx) => {
      const status = await deps.status(ctx.cwd)
      if (!status.installed) return structuredFailure('codegraph CLI 未安裝')
      if (!status.indexed) {
        return jsonOk({
          indexed: false,
          note: '此專案尚未建立索引，沒有呼叫者資料',
          projectRoot: status.projectRoot,
        })
      }
      const result = await deps.callers(ctx.cwd, String(args.symbol || ''))
      return jsonOk({ indexed: true, ...(result as Record<string, unknown>) })
    },
  }

  return {
    id: 'codegraph-pack',
    name: 'CodeGraph',
    description: 'Structural questions over the app-indexed graph',
    capability: 'codegraph',
    tools: [exploreTool, callersTool, impactTool, statusTool],
  }
}

let registered = false
export function ensureCodegraphPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildCodegraphPack())
}
