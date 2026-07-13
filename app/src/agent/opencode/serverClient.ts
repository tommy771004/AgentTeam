/** Renderer-safe facade for the OpenCode localhost adapter. */

export type OpenCodeServerStatus = {
  ok: boolean
  baseUrl: string
  version?: string
  error?: string
}

export async function inspectOpenCodeServer(url?: string): Promise<OpenCodeServerStatus> {
  if (!window.subagents?.opencodeServer?.health) {
    return { ok: false, baseUrl: url || '', error: 'OpenCode server 僅支援 Electron' }
  }
  return window.subagents.opencodeServer.health(url)
}

export async function startOpenCodeServer(cwd?: string, port?: number) {
  if (!window.subagents?.opencodeServer?.start) {
    return { ok: false, baseUrl: '', error: 'OpenCode server 僅支援 Electron' }
  }
  return window.subagents.opencodeServer.start({ cwd, port })
}

export async function stopOpenCodeServer() {
  return window.subagents?.opencodeServer?.stop?.() || { ok: false, killed: 0 }
}

export async function getOpenCodeSessionDiff(url: string, sessionId: string) {
  return window.subagents?.opencodeServer?.diff?.(url, sessionId)
}

/** Preview first; the actual revert is always gated by the existing HITL guard. */
export async function revertOpenCodeMessage(
  url: string,
  sessionId: string,
  messageId: string,
  partId?: string,
) {
  const preview = await getOpenCodeSessionDiff(url, sessionId)
  if (!window.subagents?.opencodeServer?.revert) {
    return { ok: false, preview, error: 'OpenCode revert 僅支援 Electron' }
  }
  const { useSettingsStore } = await import('../../store/settingsStore')
  const { authorizeTool } = await import('../tools/toolGuard')
  const auth = await authorizeTool({
    tool: 'workspace_write',
    input: { provider: 'opencode', sessionId, messageId, preview },
    settings: useSettingsStore.getState().settings,
    sideEffect: true,
  })
  if (!auth.allowed) return { ok: false, preview, error: auth.output }
  const result = await window.subagents.opencodeServer.revert(url, sessionId, messageId, partId)
  return { ok: true, preview, result }
}

export async function getOpenCodeSessionTodo(url: string, sessionId: string) {
  return window.subagents?.opencodeServer?.todo?.(url, sessionId)
}

export async function getOpenCodeSessionChildren(url: string, sessionId: string) {
  return window.subagents?.opencodeServer?.children?.(url, sessionId)
}

/** Create a server-side fork; the caller attaches the returned session to a local Thread. */
export async function forkOpenCodeSession(
  url: string,
  sessionId: string,
  messageId?: string,
) {
  return window.subagents?.opencodeServer?.fork?.(url, sessionId, messageId)
}

export async function getOpenCodeLspStatus(url: string) {
  return window.subagents?.opencodeServer?.lsp?.(url)
}

export async function getOpenCodeFormatterStatus(url: string) {
  return window.subagents?.opencodeServer?.formatter?.(url)
}

export async function getOpenCodeMcpStatus(url: string) {
  return window.subagents?.opencodeServer?.mcp?.(url)
}

export async function getOpenCodeProviderCatalog(url: string) {
  return window.subagents?.opencodeServer?.providers?.(url)
}

export async function getOpenCodeExperimentalToolIds(url: string) {
  return window.subagents?.opencodeServer?.experimentalToolIds?.(url)
}

/** Main-process IPC envelope helper; plain test fixtures can pass raw payloads. */
export function unwrapOpenCodeServerValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return 'value' in record ? record.value : value
}
