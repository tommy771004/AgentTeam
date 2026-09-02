/** Safe declarative custom-tool helpers. No plugin-provided JavaScript is executed. */

import type { CustomToolDefinition, LlmSettings } from '../types.ts'
import { pluginRegistry } from '../hermes/plugins.ts'
import { hasToolCredential } from '../hermes/pluginSecrets.ts'
import { compileToolPackage, validateToolPackage } from './toolPackage.ts'

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
    // Governed tool packages: validate and compile; unapproved privileged
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

/** Packages awaiting privilege review（供 Settings/市集 UI）. */
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

function interpolate(
  value: string | undefined,
  input: Record<string, unknown>,
  missingSecrets?: string[],
  opts?: {
    /**
     * Keep {{secret:key}} placeholders; main resolves them from the
     * vault (tools:httpRequest / mcp spawn). Availability still checked here.
     */
    deferSecrets?: boolean
  },
) {
  return (value || '').replace(TOKEN, (_all, secretPrefix: string | undefined, key: string) => {
    if (secretPrefix) {
      if (opts?.deferSecrets) {
        if (!hasToolCredential(key)) missingSecrets?.push(key)
        return `{{secret:${key}}}`
      }
      missingSecrets?.push(key)
      return ''
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

export async function executeCustomTool(
  tool: ResolvedCustomTool,
  input: Record<string, unknown>,
  _settings: LlmSettings,
  context?: { runId?: string; projectRoot?: string },
): Promise<{ ok: boolean; output: string; data?: unknown }> {
  const missingSecrets: string[] = []
  if (tool.kind === 'bash_template') {
    const command = interpolate(tool.template.command, input, missingSecrets, { deferSecrets: Boolean(window.subagents?.shell?.bash) })
    if (missingSecrets.length) {
      return {
        ok: false,
        output: `缺少授權密鑰：${[...new Set(missingSecrets)].join(', ')}。請先在市集完成 connector 授權。`,
      }
    }
    if (!command.trim()) return { ok: false, output: 'bash template resolved to an empty command' }
    const r = await window.subagents?.shell?.bash({
      command,
      cwd: context?.projectRoot,
      timeoutMs: 60_000,
      runId: context?.runId,
    })
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
  const url = interpolate(tool.template.url, input, missingSecrets, { deferSecrets })
  const headers = Object.fromEntries(
    Object.entries(tool.template.headers || {}).map(([k, v]) => [
      k,
      interpolate(v, input, missingSecrets, { deferSecrets }),
    ]),
  )
  const method = tool.template.method || 'GET'
  const body = tool.template.body
    ? interpolate(tool.template.body, input, missingSecrets, { deferSecrets })
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
