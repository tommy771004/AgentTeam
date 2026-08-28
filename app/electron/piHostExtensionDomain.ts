import { reloadPiMcp, stopPiMcp } from './piMcpClient.ts'
import type { PiExtension, PiExtensionRegistry } from './piExtensionRegistry.ts'
import type { PiHostEvent, PiHostMessage } from './piHostProtocol.ts'

function errorResponse(id: string | number, message: string): PiHostMessage {
  return { id, error: { code: 'invalid_request', message } }
}

export function handlePiHostExtensionDomain(input: {
  method: string
  params?: Record<string, unknown>
  id: string | number
  registry: PiExtensionRegistry
  emit?: (message: PiHostMessage) => void
  commit: (extensions: PiExtension[]) => void
}): PiHostMessage[] | undefined {
  if (!input.method.startsWith('extensions/')) return undefined
  if (input.method === 'extensions/list') return [{ id: input.id, result: { extensions: input.registry.list() } }]
  try {
    if (input.method === 'extensions/install' || input.method === 'extensions/update' || input.method === 'extensions/reload') {
      const extension = input.method === 'extensions/install'
        ? input.registry.install(input.params || {})
        : input.registry.update(input.params || {})
      if (extension.kind === 'mcp') reloadPiMcp(extension.id)
      return publish(input, input.method === 'extensions/install' ? 'installed' : 'updated', extension, { extension })
    }
    const extensionId = typeof input.params?.id === 'string' ? input.params.id : ''
    if (!extensionId) return [errorResponse(input.id, 'id is required')]
    if (input.method === 'extensions/set-enabled') {
      if (typeof input.params?.enabled !== 'boolean') return [errorResponse(input.id, 'id and enabled are required')]
      const extension = input.registry.setEnabled(extensionId, input.params.enabled)
      if (extension.kind === 'mcp') reloadPiMcp(extension.id)
      return publish(input, extension.enabled ? 'enabled' : 'disabled', extension, { extension })
    }
    if (input.method === 'extensions/uninstall') {
      const extension = input.registry.list().find((candidate) => candidate.id === extensionId)
      if (!extension) return [errorResponse(input.id, `Unknown Pi extension: ${extensionId}`)]
      input.registry.uninstall(extensionId)
      if (extension.kind === 'mcp') stopPiMcp(extensionId)
      return publish(input, 'uninstalled', extension, { removed: true })
    }
    return [errorResponse(input.id, `Unknown extension method: ${input.method}`)]
  } catch (error) {
    return [errorResponse(input.id, error instanceof Error ? error.message : 'Invalid Pi extension')]
  }
}

function publish(
  input: Parameters<typeof handlePiHostExtensionDomain>[0],
  action: 'installed' | 'updated' | 'enabled' | 'disabled' | 'uninstalled',
  extension: PiExtension,
  result: { extension: PiExtension } | { removed: true },
): PiHostMessage[] {
  const event: PiHostEvent = { event: 'host/extension', payload: { action, extension } }
  input.emit?.(event)
  input.commit(input.registry.list())
  return [...(input.emit ? [] : [event]), { id: input.id, result }]
}
