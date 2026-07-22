import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const vendorCandidates = [
  process.env.SUBAGENTS_PI_VENDOR_DIR,
  join(process.cwd(), 'vendor/pi'),
  join(process.cwd(), '../vendor/pi'),
].filter((candidate): candidate is string => Boolean(candidate))
const vendorDir = vendorCandidates.find((candidate) => existsSync(join(candidate, 'packages/coding-agent/dist/index.js'))) || vendorCandidates[0]
if (!vendorDir) throw new Error('Vendored Pi Core directory is not configured')
const piCodingAgent = await import(/* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/index.js')).href)
const piConfig = await import(/* @vite-ignore */ pathToFileURL(join(vendorDir, 'packages/coding-agent/dist/config.js')).href)

const TOOL_FACTORIES = {
  bash: piCodingAgent.createBashToolDefinition,
  edit: piCodingAgent.createEditToolDefinition,
  find: piCodingAgent.createFindToolDefinition,
  grep: piCodingAgent.createGrepToolDefinition,
  ls: piCodingAgent.createLsToolDefinition,
  read: piCodingAgent.createReadToolDefinition,
  write: piCodingAgent.createWriteToolDefinition,
}

export type PiBuiltinToolName = keyof typeof TOOL_FACTORIES

export function piCoreRuntimeStatus() {
  return {
    loaded: Object.values(TOOL_FACTORIES).every((factory) => typeof factory === 'function'),
    package: piConfig.PACKAGE_NAME,
    version: piConfig.VERSION,
    builtinTools: Object.keys(TOOL_FACTORIES).sort(),
  }
}

export async function executePiRead(cwd: string, args: { path: string; offset?: number; limit?: number }) {
  return executePiTool('read', cwd, args)
}

export async function executePiTool(toolName: PiBuiltinToolName, cwd: string, args: Record<string, unknown>) {
  const factory = TOOL_FACTORIES[toolName]
  if (typeof factory !== 'function') throw new Error(`Pi builtin tool is unavailable: ${toolName}`)
  const tool = factory(cwd)
  return tool.execute(`pi-host-${toolName}`, args, undefined, undefined, undefined)
}
