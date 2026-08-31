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
    if (input.method === 'extensions/install' || input.method === 'extensions/update' || input.method === 'extensions/reload') return handleInstall(input)
    if (input.method === 'extensions/set-enabled') return handleSetEnabled(input)
    if (input.method === 'extensions/uninstall') return handleUninstall(input)
    return [errorResponse(input.id, `Unknown extension method: ${input.method}`)]
  } catch (error) {
    return [errorResponse(input.id, error instanceof Error ? error.message : 'Invalid Pi extension')]
  }
}

function handleInstall(input: Parameters<typeof handlePiHostExtensionDomain>[0]): PiHostMessage[] {
  const requestedId = extensionIdFrom(input)
  if (input.params?.kind === 'package' || input.registry.list().some((extension) => extension.id === requestedId && extension.kind === 'package')) {
    return [errorResponse(input.id, 'Package extensions use the Pi package trust path')]
  }
  const installing = input.method === 'extensions/install'
  const extension = installing ? input.registry.install(input.params || {}) : input.registry.update(input.params || {})
  if (extension.kind === 'mcp') reloadPiMcp(extension.id)
  return publish(input, installing ? 'installed' : 'updated', extension, { extension })
}

function extensionIdFrom(input: Parameters<typeof handlePiHostExtensionDomain>[0]): string {
  return typeof input.params?.id === 'string' ? input.params.id : ''
}

function handleSetEnabled(input: Parameters<typeof handlePiHostExtensionDomain>[0]): PiHostMessage[] {
  const extensionId = extensionIdFrom(input)
  if (!extensionId) return [errorResponse(input.id, 'id is required')]
  if (typeof input.params?.enabled !== 'boolean') return [errorResponse(input.id, 'id and enabled are required')]
  const extension = input.registry.setEnabled(extensionId, input.params.enabled)
  if (extension.kind === 'mcp') reloadPiMcp(extension.id)
  return publish(input, extension.enabled ? 'enabled' : 'disabled', extension, { extension })
}

function handleUninstall(input: Parameters<typeof handlePiHostExtensionDomain>[0]): PiHostMessage[] {
  const extensionId = extensionIdFrom(input)
  if (!extensionId) return [errorResponse(input.id, 'id is required')]
  const extension = input.registry.list().find((candidate) => candidate.id === extensionId)
  if (!extension) return [errorResponse(input.id, `Unknown Pi extension: ${extensionId}`)]
  if (extension.kind === 'package') return [errorResponse(input.id, 'Package extensions use the Pi package trust path')]
  input.registry.uninstall(extensionId)
  if (extension.kind === 'mcp') stopPiMcp(extensionId)
  return publish(input, 'uninstalled', extension, { removed: true })
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
