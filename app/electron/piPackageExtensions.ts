import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { resolvePiPackageExtensionResources } from './piPackageDomain.ts'
import { piCodingAgentModule } from './piVendor.ts'
import type { PiExtensionPack, PiPackTool, PiToolResult } from './piToolHost.ts'
import type { PiPackageToolProvenance } from './piToolContract.ts'

export type PiPackageExtensionAdmission = {
  source: string
  name: string
  version: string
  enabled: boolean
  trusted: boolean
}

type NativeToolDefinition = {
  name: string
  label?: string
  description?: string
  parameters?: unknown
  execute: (...args: unknown[]) => Promise<unknown>
}

type LoadedExtension = {
  tools: Map<string, { definition: NativeToolDefinition }>
}

type LoadExtensionsResult = {
  extensions: LoadedExtension[]
  errors: Array<{ path: string; error: string }>
}

type PiExtensionApi = {
  discoverAndLoadExtensions(paths: string[], cwd: string, agentDir: string): Promise<LoadExtensionsResult>
}

function textResult(value: unknown): PiToolResult {
  const result = value && typeof value === 'object' ? value as { content?: unknown; details?: unknown } : {}
  const content = Array.isArray(result.content)
    ? result.content.map((part) => {
      const candidate = part && typeof part === 'object' ? part as { type?: unknown; text?: unknown } : {}
      return { type: 'text' as const, text: typeof candidate.text === 'string' ? candidate.text : '[Non-text package tool output omitted]' }
    })
    : [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }]
  return { content, ...(result.details !== undefined ? { details: result.details } : {}) }
}

/** Load only explicitly trusted package extension resources and adapt their tools to the shared Host policy seam. */
export async function buildTrustedPiPackageExtensionPacks(input: {
  agentDir: string | undefined
  admissions: readonly PiPackageExtensionAdmission[]
  reservedToolNames: ReadonlySet<string>
}): Promise<{ packs: PiExtensionPack[]; diagnostics: Array<{ path: string; message: string }> }> {
  if (!input.agentDir || input.admissions.length === 0) return { packs: [], diagnostics: [] }
  const resolved = await resolvePiPackageExtensionResources(input.agentDir)
  const admitted = new Map(input.admissions
    .filter((entry) => entry.enabled && entry.trusted)
    .map((entry) => [entry.source, entry]))
  const pi = piCodingAgentModule as unknown as PiExtensionApi
  if (typeof pi.discoverAndLoadExtensions !== 'function') {
    return { packs: [], diagnostics: [{ path: '', message: 'Pi package extension loading is unavailable' }] }
  }

  const packs: PiExtensionPack[] = []
  const diagnostics = [...resolved.diagnostics]
  const claimedNames = new Set(input.reservedToolNames)
  const syntheticRoot = join(input.agentDir, '.agentstudio-package-extension-loader')
  for (const resource of resolved.resources) {
    const admission = admitted.get(resource.source)
    if (!admission || admission.name !== resource.packageName || admission.version !== resource.version) continue
    const loaded = await pi.discoverAndLoadExtensions([resource.path], syntheticRoot, syntheticRoot)
    diagnostics.push(...loaded.errors.map((entry) => ({ path: entry.path, message: entry.error })))
    const provenance: PiPackageToolProvenance = Object.freeze({
      packageName: resource.packageName,
      packageVersion: resource.version,
      packageSource: resource.source,
      resourceOrigin: 'package',
    })
    const tools: PiPackTool[] = []
    for (const extension of loaded.extensions) {
      for (const registered of extension.tools.values()) {
        const definition = registered.definition
        if (!definition.name) continue
        if (claimedNames.has(definition.name)) {
          diagnostics.push({ path: resource.path, message: `Package tool collision: ${definition.name}` })
          continue
        }
        claimedNames.add(definition.name)
        tools.push({
          name: definition.name,
          label: definition.label || definition.name,
          description: definition.description || `Tool from ${resource.packageName}`,
          promptSnippet: definition.description || `Trusted package tool ${definition.name}`,
          parameters: definition.parameters && typeof definition.parameters === 'object'
            ? definition.parameters as Record<string, unknown>
            : {},
          packageProvenance: provenance,
          approval: () => ({ need: true, reason: `Trusted package tool ${definition.name} requires approval` }),
          policyMigration: {
            sideEffect: true,
            outbound: true,
            approvalRequired: `Trusted package tool ${definition.name} requires approval`,
          },
          execute: async (args, ctx) => {
            const controller = new AbortController()
            const extensionContext = Object.freeze({
              cwd: ctx.cwd,
              mode: 'print',
              hasUI: false,
              signal: controller.signal,
              isIdle: () => false,
              isProjectTrusted: () => false,
              hasPendingMessages: () => false,
              abort: () => controller.abort(),
            })
            return textResult(await definition.execute(
              ctx.callId || `${ctx.runId || 'turn'}:${definition.name}`,
              args,
              controller.signal,
              undefined,
              extensionContext,
            ))
          },
        })
      }
    }
    if (tools.length > 0) {
      packs.push({
        id: `pi-package-${createHash('sha256').update(resource.source).digest('hex').slice(0, 12)}`,
        name: resource.packageName,
        description: `Trusted tools from ${resource.packageName}@${resource.version}`,
        alwaysActive: true,
        tools,
      })
    }
  }
  return { packs, diagnostics: diagnostics.slice(0, 32) }
}
