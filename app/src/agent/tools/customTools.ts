/** Safe declarative custom-tool helpers. No plugin-provided JavaScript is executed. */

import type { CustomToolDefinition, LlmSettings } from '../types'
import { pluginRegistry } from '../hermes/plugins'
import { getPluginSecret, hasPluginSecret } from '../hermes/pluginSecrets'
import { compileToolPackage, validateToolPackage } from './toolPackage'
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
    // P1-C: governed tool packages — validate + compile; unapproved privileged
    // tools are withheld (read-only surface until user re-approves fingerprint)
    if (plugin.toolPackage) {
      const v = validateToolPackage(plugin.toolPackage)
      if (v.ok && v.manifest) {
        const compiled = compileToolPackage(v.manifest, plugin.id, plugin.packageReview)
        for (const tool of compiled.tools) add(tool, plugin.id)
      }
    }
  }
  return [...byName.values()]
}

/** P1-C: packages awaiting privilege review（供 Settings/市集 UI）. */
export function listPendingToolPackages(): Array<{
  pluginId: string
  packageId: string
  version: string
  fingerprint: string
  withheld: string[]
}> {
  const out: Array<{
    pluginId: string
    packageId: string
    version: string
    fingerprint: string
    withheld: string[]
  }> = []
  for (const plugin of pluginRegistry.list()) {
    if (!plugin.enabled || !plugin.toolPackage) continue
    const v = validateToolPackage(plugin.toolPackage)
    if (!v.ok || !v.manifest) continue
    const compiled = compileToolPackage(v.manifest, plugin.id, plugin.packageReview)
    if (compiled.needsReview && compiled.withheld.length) {
      out.push({
        pluginId: plugin.id,
        packageId: v.manifest.id,
        version: v.manifest.version,
        fingerprint: compiled.fingerprint,
        withheld: compiled.withheld,
      })
    }
  }
  return out
}

/**
 * Keyword pick custom tools for heuristic path (non-FC).
 * Scores against tool name/description/owner + CONNECTOR-style tokens in objective.
 */
export function selectCustomToolsForStep(
  stepDescription: string,
  objective: string,
  settings: LlmSettings,
  opts?: { max?: number; blockedTools?: string[] },
): ResolvedCustomTool[] {
  const max = opts?.max ?? 4
  const blocked = new Set(opts?.blockedTools || [])
  const hay = `${objective}\n${stepDescription}`.toLowerCase()
  const scored: Array<{ tool: ResolvedCustomTool; score: number }> = []
  for (const tool of customToolsForSettings(settings)) {
    if (blocked.has(tool.name)) continue
    const bag = `${tool.name} ${tool.description} ${tool.ownerId}`.toLowerCase()
    let score = 0
    for (const w of bag.split(/[\s:_\-/|]+/)) {
      if (w.length < 3) continue
      if (hay.includes(w)) score += w.length > 6 ? 3 : 1
    }
    // Boost well-known product tokens
    for (const token of [
      'github',
      'notion',
      'linear',
      'figma',
      'dropbox',
      'clickup',
      'asana',
      'calendar',
      'sheet',
      'postgres',
      'brave',
      'homeassistant',
      'home assistant',
      'hass',
      'ha_',
      '智能家居',
      '智慧家庭',
    ]) {
      if (hay.includes(token) && bag.includes(token.replace(/\s/g, ''))) score += 4
      if (hay.includes(token) && bag.includes(token)) score += 4
    }
    if (score > 0) scored.push({ tool, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.tool)
}

/** Best-effort args for heuristic custom-tool runs */
export function buildCustomToolInput(
  tool: ResolvedCustomTool,
  objective: string,
  stepDescription: string,
): Record<string, unknown> {
  const hay = `${objective}\n${stepDescription}`
  const out: Record<string, unknown> = {}
  const repo = hay.match(/\b([\w.-]+)\/([\w.-]+)\b/)
  const url = hay.match(/https?:\/\/[^\s)\]"'<>]+/i)
  const uuid = hay.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  )
  for (const [name, p] of Object.entries(tool.params || {})) {
    if (name === 'owner' && repo) out.owner = repo[1]
    else if (name === 'repo' && repo) out.repo = repo[2]
    else if ((name === 'url' || name === 'page_url') && url) out[name] = url[0]
    else if ((name === 'page_id' || name === 'file_key') && uuid) out[name] = uuid[0]
    else if (name === 'query' || name === 'q') {
      out[name] = stepDescription.slice(0, 240) || objective.slice(0, 240)
    } else if (name === 'state') out.state = 'open'
    else if (name === 'calendarId') out.calendarId = 'primary'
    else if (name === 'timeMin') out.timeMin = new Date().toISOString()
    else if (name === 'path') out.path = ''
    else if (name === 'range') out.range = 'Sheet1!A1:D20'
    else if (name === 'base_url') {
      const m = hay.match(/https?:\/\/[\w.-]+(?::\d+)?/i)
      out.base_url = m?.[0] || 'http://homeassistant.local:8123'
    } else if (name === 'entity_id') {
      const m = hay.match(
        /\b(?:light|switch|climate|sensor|binary_sensor|media_player|cover|lock|scene|script|fan|input_boolean)\.[\w.]+\b/i,
      )
      out.entity_id = m?.[0] || ''
    } else if (name === 'domain') {
      if (/關燈|關.*燈|turn.?off.*light|light.?off/i.test(hay)) out.domain = 'light'
      else if (/開燈|開.*燈|turn.?on.*light|light.?on/i.test(hay)) out.domain = 'light'
      else if (/插座|switch/i.test(hay)) out.domain = 'switch'
      else if (/空調|冷氣|climate/i.test(hay)) out.domain = 'climate'
      else if (/場景|scene/i.test(hay)) out.domain = 'scene'
      else if (p.required) out.domain = ''
    } else if (name === 'service') {
      if (/關|off|關閉/i.test(hay) && !/開關/.test(hay)) out.service = 'turn_off'
      else if (/開|on|開啟/i.test(hay)) out.service = 'turn_on'
      else if (/toggle|切換/i.test(hay)) out.service = 'toggle'
      else if (p.required) out.service = ''
    } else if (p.required) out[name] = ''
  }
  return out
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

/** Renderer-visible availability check (never returns vault tokens on Electron). */
function secretAvailable(key: string, settings: LlmSettings): boolean {
  const fromSettings = settings.customToolSecrets?.[key]
  if (fromSettings != null && String(fromSettings).length > 0) return true
  return hasPluginSecret(key) || hasPluginSecret(`${key}-connector`)
}

function resolveSecret(key: string, settings: LlmSettings): string {
  // 1) Settings customToolSecrets  2) pluginSecrets (browser fallback only —
  //    on Electron raw plugin tokens live in the main vault)
  const fromSettings = settings.customToolSecrets?.[key]
  if (fromSettings != null && String(fromSettings).length > 0) return String(fromSettings)
  const fromPlugin = getPluginSecret(key)?.token
  if (fromPlugin) return fromPlugin
  // Also allow ownerId-less aliases without -connector suffix
  const alt = getPluginSecret(`${key}-connector`)?.token
  return alt || ''
}

function interpolate(
  value: string | undefined,
  input: Record<string, unknown>,
  settings: LlmSettings,
  missingSecrets?: string[],
  opts?: {
    /**
     * P1-A: keep {{secret:key}} placeholders — main resolves them from the
     * vault (tools:httpRequest / mcp spawn). Availability still checked here.
     */
    deferSecrets?: boolean
  },
) {
  return (value || '').replace(TOKEN, (_all, secretPrefix: string | undefined, key: string) => {
    if (secretPrefix) {
      if (opts?.deferSecrets) {
        if (!secretAvailable(key, settings)) missingSecrets?.push(key)
        return `{{secret:${key}}}`
      }
      const secret = resolveSecret(key, settings)
      if (!secret) missingSecrets?.push(key)
      return secret
    }
    const v = input[key]
    // Sensible defaults for optional GitHub state etc.
    if ((v == null || v === '') && key === 'state') return 'open'
    if ((v == null || v === '') && key === 'path') return ''
    if ((v == null || v === '') && key === 'base_url') {
      return 'http://homeassistant.local:8123'
    }
    return v == null ? '' : String(v)
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
  const missingSecrets: string[] = []
  if (tool.kind === 'bash_template') {
    const command = interpolate(tool.template.command, input, settings, missingSecrets)
    if (missingSecrets.length) {
      return {
        ok: false,
        output: `缺少授權密鑰：${[...new Set(missingSecrets)].join(', ')}。請先在市集完成 connector 授權。`,
      }
    }
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

  // HTTP path: on Electron, leave {{secret:*}} placeholders — the main process
  // resolves them from the vault so raw tokens never enter the renderer.
  const deferSecrets = Boolean(window.subagents?.tools?.httpRequest)
  const url = interpolate(tool.template.url, input, settings, missingSecrets, { deferSecrets })
  const headers = Object.fromEntries(
    Object.entries(tool.template.headers || {}).map(([k, v]) => [
      k,
      interpolate(v, input, settings, missingSecrets, { deferSecrets }),
    ]),
  )
  const method = tool.template.method || 'GET'
  const body = tool.template.body
    ? interpolate(tool.template.body, input, settings, missingSecrets, { deferSecrets })
    : undefined
  if (missingSecrets.length) {
    return {
      ok: false,
      output: `缺少授權密鑰：${[...new Set(missingSecrets)].join(', ')}。請先在市集完成 connector 授權（例如 GitHub / Notion）。`,
    }
  }
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
