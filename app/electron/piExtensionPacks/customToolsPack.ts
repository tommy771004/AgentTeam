import { registerPiExtensionPack, type PiPackTool } from '../piToolHost.ts'
import { requestPiHostService } from '../piHostServices.ts'
import { structuredFailure, structuredOk } from './packResults.ts'

const executeCustomTool: PiPackTool = {
  name: 'custom_tool_execute',
  label: 'Custom Tool Execute',
  description: 'Execute a user-configured custom tool by its registered name',
  promptSnippet: 'run a configured custom tool without exposing its credential references',
  parameters: {
    type: 'object',
    properties: {
      toolName: { type: 'string', description: 'Configured custom tool name' },
      input: { type: 'object', description: 'Values for the configured template inputs' },
    },
    required: ['toolName', 'input'],
  },
  approval: () => ({ need: true, reason: 'custom_tool_execute may run a command or send data outside this machine' }),
  policyMigration: { outbound: true, sideEffect: true },
  execute: async (args, context) => {
    try {
      const result = await requestPiHostService<{ ok: boolean; output: string; data?: unknown }>('custom-tool/execute', {
        toolName: String(args.toolName || ''),
        input: args.input && typeof args.input === 'object' ? args.input : {},
        cwd: context.cwd,
        runId: context.runId,
      })
      return result.ok
        ? structuredOk(result.output, { data: result.data })
        : structuredFailure(result.output || 'Custom tool execution failed', { data: result.data })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return structuredFailure(message)
    }
  },
}

export function buildCustomToolsPack() {
  return {
    id: 'custom-tools',
    name: 'Custom Tools',
    description: 'Reference-only execution of user-configured custom tools',
    capability: 'custom-tools',
    tools: [executeCustomTool],
  }
}

let registered = false
export function ensureCustomToolsPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildCustomToolsPack())
}
