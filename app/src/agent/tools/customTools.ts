/** Safe declarative custom-tool helpers. No plugin-provided JavaScript is executed. */

import type { CustomToolDefinition, LlmSettings } from '../types'
import { pluginRegistry } from '../hermes/plugins'
import type { OpenAiToolDef } from './schemas'

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const TOKEN = /{{\s*(secret:)?([A-Za-z0-9_.-]+)\s*}}/g

export type ResolvedCustomTool = CustomToolDefinition & { ownerId: string }

export function customToolsForSettings(settings: LlmSettings): ResolvedCustomTool[] {
  const byName = new Map<string, ResolvedCustomTool>()
  const add = (raw: CustomToolDefinition, ownerId: string) => {
    const name = raw?.name?.trim()
    if (!name || !NAME.test(name) || !raw.description?.trim()) return
    if (raw.kind === 'http_template' && !/^(https?:\/\/|{{)/i.test(raw.template?.url || '')) return
    if (raw.kind === 'bash_template' && !raw.template?.command?.trim()) return
    // Settings intentionally win over plugins so a user can disable/replace an edge tool.
    if (!byName.has(name)) byName.set(name, { ...raw, name, ownerId: raw.ownerId || ownerId })
  }
  for (const tool of settings.customTools || []) add(tool, tool.ownerId || 'settings')
  for (const plugin of pluginRegistry.list()) {
    if (!plugin.enabled) continue
    for (const tool of plugin.customTools || []) add(tool, plugin.id)
  }
  return [...byName.values()]
}

export function customToolDefs(tools: ResolvedCustomTool[]): OpenAiToolDef[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, p] of Object.entries(tool.params || {})) {
      if (!NAME.test(name)) continue
      properties[name] = { type: p.type || 'string', description: p.description || name }
      if (p.required) required.push(name)
    }
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: `[Custom:${tool.ownerId}] ${tool.description}`,
        parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
      },
    }
  })
}

function interpolate(value: string | undefined, input: Record<string, unknown>, settings: LlmSettings) {
  return (value || '').replace(TOKEN, (_all, secretPrefix: string | undefined, key: string) => {
    const value = secretPrefix ? settings.customToolSecrets?.[key] : input[key]
    return value == null ? '' : String(value)
  })
}

export function isCustomToolApprovalRequired(tool: ResolvedCustomTool) {
  return tool.kind === 'bash_template' || tool.requiresApproval === true
}

export async function executeCustomTool(
  tool: ResolvedCustomTool,
  input: Record<string, unknown>,
  settings: LlmSettings,
): Promise<{ ok: boolean; output: string; data?: unknown }> {
  if (tool.kind === 'bash_template') {
    const command = interpolate(tool.template.command, input, settings)
    if (!command.trim()) return { ok: false, output: 'bash template resolved to an empty command' }
    const r = await window.subagents?.shell?.bash({ command, timeoutMs: 60_000 })
    if (!r) return { ok: false, output: 'bash_template requires Electron' }
    return {
      ok: r.ok,
      output: [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, `exit=${r.code}`]
        .filter(Boolean).join('\n') || '(empty)',
      data: r,
    }
  }

  const url = interpolate(tool.template.url, input, settings)
  const headers = Object.fromEntries(
    Object.entries(tool.template.headers || {}).map(([k, v]) => [k, interpolate(v, input, settings)]),
  )
  const method = tool.template.method || 'GET'
  const body = tool.template.body ? interpolate(tool.template.body, input, settings) : undefined
  const r = await window.subagents?.tools?.httpRequest?.({ url, method, headers, body, maxChars: 50_000 })
  if (r) return { ok: r.ok, output: r.text, data: r }
  try {
    const res = await fetch(url, { method, headers, body })
    const text = (await res.text()).slice(0, 50_000)
    return { ok: res.ok, output: text || `HTTP ${res.status}`, data: { status: res.status } }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}
