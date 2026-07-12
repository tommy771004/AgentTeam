/**
 * Intent → capability preload (v2): builtins + matched skills + enabled plugins/MCP.
 * Prioritizes secret-backed packs when credentials exist.
 */

import type { LlmSettings } from './types'
import { assembleCapabilities, capabilityOwnsTool } from './capabilities'
import { selectToolsForStep } from './tools/registry'
import { skillsStore } from './hermes/skills'
import { pluginRegistry } from './hermes/plugins'
import { CONNECTOR_INTENT_KEYWORDS } from './hermes/connectorTools'
import { catalogItem } from './hermes/pluginCatalog'
import { hasPluginSecret } from './hermes/pluginSecrets'

function scoreHay(hay: string, objective: string): number {
  const lower = objective.toLowerCase()
  let score = 0
  for (const w of hay.toLowerCase().split(/[\s,|/]+/)) {
    if (w.length < 3) continue
    if (lower.includes(w)) score += w.length > 5 ? 2 : 1
  }
  // Chinese has no reliable whitespace boundary. Score at most once per CJK
  // sequence to avoid a long description overpowering every other signal.
  const cjkSequences = hay.match(/[一-鿿]{2,}/g) || []
  for (const sequence of cjkSequences) {
    for (let index = 0; index + 2 <= sequence.length; index++) {
      if (objective.includes(sequence.slice(index, index + 2))) {
        score += 2
        break
      }
    }
  }
  return score
}

/**
 * Build ordered preload capability ids for a user objective.
 * Caps total length; always de-duped. Prioritizes higher scores first.
 */
export function buildIntentPreloadIds(
  objective: string,
  settings: LlmSettings,
  projectRoot?: string | null,
  opts?: { max?: number },
): string[] {
  const max = opts?.max ?? 8
  const text = objective.trim()
  const lower = text.toLowerCase()
  const scored: Array<{ id: string; score: number }> = []
  const seen = new Set<string>()
  const push = (id: string, score: number) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    scored.push({ id, score })
  }

  // 1) Builtin keyword router → owning capabilities
  const intentTools = selectToolsForStep(text, text, '', {
    webSearchEnabled: settings.webSearchEnabled !== false,
  }).filter((tool) => settings.subAgentsEnabled === true || !tool.startsWith('delegate_'))
  const assembled = assembleCapabilities(settings, {
    includeMcpCaps: settings.mcpEnabled,
    projectRoot: projectRoot || undefined,
  })
  for (const cap of assembled.all) {
    if (cap.id === 'core-utils') continue
    if (intentTools.some((tool) => capabilityOwnsTool(cap, tool))) push(cap.id, 10)
  }

  // 2) Matched skills → skill:<name>
  for (const skill of skillsStore.matchForObjective(text).slice(0, 3)) {
    push(`skill:${skill.meta.name}`, 8)
  }

  // 3) Enabled plugins (custom tools + MCP packs)
  for (const plugin of pluginRegistry.list()) {
    if (!plugin.enabled) continue
    const item = catalogItem(plugin.id)
    const tags = item?.tags || []
    const keywords = CONNECTOR_INTENT_KEYWORDS[plugin.id] || []
    const hay = [plugin.id, plugin.name, plugin.description, ...tags, ...keywords].join(' ')
    const base = scoreHay(hay, text)
    const kwHit = keywords.some((k) => lower.includes(k.toLowerCase()))
    if (base <= 0 && !kwHit) continue
    const score = base + (kwHit ? 6 : 0)

    if (plugin.customTools?.length) {
      // Prefer packs that already have credentials
      const secretBoost = hasPluginSecret(plugin.id) ? 5 : 0
      push(`user:${plugin.id}`, score + 4 + secretBoost)
    }
    for (const server of plugin.mcpServers || []) {
      if (server.enabled === false) continue
      const owner = server.secretPluginId || server.pluginId || plugin.id
      const secretBoost = hasPluginSecret(owner) ? 8 : 0
      // Secret-backed MCP ranks higher when authorized so FC sees authenticated tools first
      push(`mcp:${server.id}`, score + 3 + secretBoost)
    }
    const secretOwner = item?.npm?.secretPluginId || item?.dependsOnPluginId
    if (secretOwner) {
      const ownerEnabled = pluginRegistry.list().some((p) => p.id === secretOwner && p.enabled)
      if (ownerEnabled) {
        push(`user:${secretOwner}`, score + (hasPluginSecret(secretOwner) ? 6 : 2))
      }
    }
  }

  // 4) Settings MCP list (may include synced servers)
  if (settings.mcpEnabled) {
    for (const server of settings.mcpServers || []) {
      if (!server.enabled) continue
      const hay = `${server.id} ${server.name} ${server.pluginId || ''} ${server.secretPluginId || ''} mcp filesystem`
      const score = scoreHay(hay, text)
      if (score > 0 || (projectRoot && /file|檔|目錄|workspace|專案/.test(lower))) {
        const owner = server.secretPluginId || server.pluginId || ''
        const secretBoost = owner && hasPluginSecret(owner) ? 6 : 0
        push(`mcp:${server.id}`, Math.max(score, 2) + secretBoost)
      }
    }
  }

  // 5) Project context
  if (projectRoot) {
    push('codegraph', 5)
    push('workspace', 5)
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.id)
}
