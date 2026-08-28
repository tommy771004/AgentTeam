/**
 * Capability runtime — progressive disclosure for FC tool loops.
 *
 * Model sees a compact catalog of deferred capabilities + load_capability.
 * Loading activates tools + instructions as one bundle (Pydantic AI 2.0 style).
 */

export type { CapabilityUnlockProvenance } from './types.ts'
import type { LlmSettings } from '../types.ts'
import type { OpenAiToolDef } from '../tools/schemas.ts'
import { TOOL_CATALOG, type ToolName } from '../tools/registry.ts'
import { skillsStore } from '../hermes/skills.ts'
import { customToolsForSettings } from '../tools/customTools.ts'
import {
  BUILTIN_CAPABILITIES,
  LOAD_CAPABILITY_TOOL,
  RUN_CODE_TOOL,
  TOOL_SEARCH_TOOL,
} from './builtins.ts'
import type {
  AgentCapability,
  CapabilityCatalogEntry,
  CapabilityModelSettings,
  CapabilityRuntimeState,
  CapabilityUnlockProvenance,
} from './types.ts'
import { resolveEntitlement, isCapabilityEntitled, type EntitlementSnapshot } from '../entitlement.ts'

export { LOAD_CAPABILITY_TOOL, RUN_CODE_TOOL, TOOL_SEARCH_TOOL }

/** Framework tools always exempt from tool-search hiding / capability gating. */
const FRAMEWORK_TOOLS = new Set([LOAD_CAPABILITY_TOOL, TOOL_SEARCH_TOOL])

export type AssembleOpts = {
  /** Progressive disclosure (default: settings.capabilitiesEnabled !== false) */
  progressive?: boolean
  /** Force-load these deferred ids at start (cron attached skills etc.) */
  preloadIds?: string[]
  webSearchEnabled?: boolean
  includeSkillCaps?: boolean
  includeMcpCaps?: boolean
  /** Omit project-only capabilities when there is no selected workspace project. */
  projectRoot?: string
  /** Tool Search (default: settings.toolSearchEnabled !== false) */
  toolSearchEnabled?: boolean
  /** Hide non-core tool schemas when visible defs exceed this (default: settings.toolSearchThreshold or 24) */
  toolSearchThreshold?: number
  /** CodeMode run_code capability (default: settings.codeModeEnabled !== false) */
  codeModeEnabled?: boolean
  /**
   * Hard-blocked tool names (leaf isolation). Capabilities whose *only* tools
   * are blocked are stripped from the deferred catalog so the model does not
   * burn a turn load_capability → denied.
   */
  blockedTools?: string[]
  /** Restore tool_search unlock set (cross-step / cross-run) */
  preloadUnlockedTools?: string[]
  /** Agent id used to filter per-agent MCP access. */
  agentId?: string
  /**
   * Issue 07 — the one entitlement decision point. Defaults to a bare Free
   * Core snapshot (`resolveEntitlement(undefined)`) when omitted, so callers
   * that never pass one still get correct fail-closed behavior for any
   * capability that declares `requiresEntitlement`.
   */
  entitlement?: EntitlementSnapshot
}

function skillCaps(): AgentCapability[] {
  try {
    return skillsStore.list().map((s) => ({
      id: `skill:${s.meta.name}`,
      description: s.meta.description || `Skill: ${s.meta.name}`,
      instructions: s.body.slice(0, 4000),
      tools: [] as ToolName[],
      deferLoading: true,
      source: 'skill' as const,
      group: 'skills',
    }))
  } catch {
    return []
  }
}

function mcpCaps(settings: LlmSettings, agentId?: string): AgentCapability[] {
  if (!settings.mcpEnabled || !settings.mcpServers?.length) return []
  const allowlist = agentId && Object.prototype.hasOwnProperty.call(settings.mcpAgentServers || {}, agentId)
    ? new Set(settings.mcpAgentServers?.[agentId] || [])
    : null
  return settings.mcpServers
    .filter((server) => server.enabled && (!allowlist || allowlist.has(server.id)))
    .map((s) => ({
      id: `mcp:${s.id}`,
      description: `MCP server「${s.name}」tools (load to expose schemas).`,
      instructions: `You loaded MCP server "${s.name}" (id=${s.id}).
Use the mcp_<${s.id}>_* tools now available. Prefer these over generic mcp_call when present.`,
      tools: [] as ToolName[],
      toolNamePrefixes: [`mcp_${s.id}_`],
      deferLoading: true,
      source: 'mcp' as const,
      group: 'mcp',
    }))
}

function userCaps(settings: LlmSettings): AgentCapability[] {
  const grouped = new Map<string, string[]>()
  const approvals = new Map<string, string[]>()
  for (const tool of customToolsForSettings(settings)) {
    const owner = tool.ownerId || 'settings'
    grouped.set(owner, [...(grouped.get(owner) || []), tool.name])
    if (tool.kind === 'bash_template' || tool.requiresApproval) {
      approvals.set(owner, [...(approvals.get(owner) || []), tool.name])
    }
  }
  return [...grouped].map(([owner, toolNames]) => ({
    id: `user:${owner}`,
    description: `Custom tools from ${owner} (${toolNames.join(', ')}).`,
    instructions: 'Custom tools use declared templates. Never put secret values in arguments; use the configured {{secret:key}} references.',
    toolNames,
    approvalTools: approvals.get(owner) || [],
    deferLoading: true,
    source: 'user' as const,
    group: 'custom',
  }))
}

/** Assemble full capability registry for a run. */
export function assembleCapabilities(
  settings: LlmSettings,
  opts?: AssembleOpts,
): CapabilityRuntimeState {
  const progressive =
    opts?.progressive ?? settings.capabilitiesEnabled !== false

  let all: AgentCapability[] = [...BUILTIN_CAPABILITIES.map((c) => ({ ...c }))]

  // Delegation is a separate opt-in feature. Keep its schemas/runbook out of
  // progressive disclosure when the user has disabled Sub Agent mode.
  if (settings.subAgentsEnabled !== true) {
    all = all.filter((capability) => capability.id !== 'delegate')
  }

  if (opts?.projectRoot === '') {
    all = all.filter((c) => c.id !== 'codegraph')
  }

  // CodeMode capability is opt-out via settings
  const codeMode = opts?.codeModeEnabled ?? settings.codeModeEnabled !== false
  if (!codeMode) all = all.filter((c) => c.id !== 'code-mode')

  // Gate web tools by setting
  if (opts?.webSearchEnabled === false || settings.webSearchEnabled === false) {
    const web = all.find((c) => c.id === 'web-research')
    if (web) web.tools = (web.tools || []).filter((t) => t !== 'web_search')
  }

  if (opts?.includeSkillCaps !== false) {
    all.push(...skillCaps())
  }
  if (opts?.includeMcpCaps !== false) {
    all.push(...mcpCaps(settings, opts?.agentId))
  }
  all.push(...userCaps(settings))

  // Issue 07 — single entitlement boundary: capabilities requiring a paid
  // feature that isn't granted are stripped before anything else sees them.
  // Free Core capabilities (no requiresEntitlement) are never checked here.
  const entitlement = opts?.entitlement ?? resolveEntitlement(undefined)
  all = all.filter((c) => isCapabilityEntitled(entitlement, c.requiresEntitlement))

  // User override: force some deferred caps always-on
  const always = new Set(settings.alwaysOnCapabilities || [])
  for (const c of all) {
    if (always.has(c.id)) c.deferLoading = false
  }

  // Strip tools that are hard-blocked; drop caps that become empty (leaf isolation)
  const blocked = new Set((opts?.blockedTools || []).map(String))
  if (blocked.size) {
    all = all
      .map((c) => {
        if (!c.tools?.length && !c.toolNames?.length && !c.toolNamePrefixes?.length) {
          // instruction-only skill caps stay
          return c
        }
        const tools = (c.tools || []).filter((t) => !blocked.has(t))
        const toolNames = (c.toolNames || []).filter((t) => !blocked.has(t))
        const approvalTools = (c.approvalTools || []).filter((t) => !blocked.has(t))
        return { ...c, tools, toolNames, approvalTools }
      })
      .filter((c) => {
        // Keep instruction-only (skills) and caps that still own something
        const hasTools =
          (c.tools?.length || 0) > 0 ||
          (c.toolNames?.length || 0) > 0 ||
          (c.toolNamePrefixes?.length || 0) > 0
        const instructionOnly = !!c.instructions && !hasTools && c.source === 'skill'
        if (instructionOnly) return true
        if (!hasTools && c.source !== 'skill') return false
        return true
      })
  }

  const loadedIds = new Set<string>()
  const capabilityProvenance = new Map<string, CapabilityUnlockProvenance>()
  // Always-on are "available" without load
  for (const c of all) {
    if (!c.deferLoading) {
      loadedIds.add(c.id)
      capabilityProvenance.set(c.id, 'always-on')
    }
  }
  for (const id of opts?.preloadIds || []) {
    if (all.some((c) => c.id === id)) {
      loadedIds.add(id)
      capabilityProvenance.set(id, 'preloaded')
    }
  }

  // Progressive off → everything loaded
  if (!progressive) {
    for (const c of all) {
      loadedIds.add(c.id)
      capabilityProvenance.set(c.id, 'progressive-off')
    }
  }

  const toolSearchActive =
    progressive && (opts?.toolSearchEnabled ?? settings.toolSearchEnabled !== false)
  const threshold = Math.max(
    4,
    opts?.toolSearchThreshold ?? settings.toolSearchThreshold ?? 24,
  )

  const unlocked = new Set<string>()
  const toolProvenance = new Map<string, CapabilityUnlockProvenance>()
  for (const t of opts?.preloadUnlockedTools || []) {
    if (t?.trim()) {
      unlocked.add(t.trim())
      toolProvenance.set(t.trim(), 'restored')
    }
  }

  return {
    all,
    loadedIds,
    progressive,
    toolSearch: { active: toolSearchActive, threshold, unlocked },
    provenance: { capabilities: capabilityProvenance, tools: toolProvenance },
  }
}

export function isCapabilityActive(
  state: CapabilityRuntimeState,
  cap: AgentCapability,
): boolean {
  if (!state.progressive) return true
  if (!cap.deferLoading) return true
  return state.loadedIds.has(cap.id)
}

export function listCatalog(state: CapabilityRuntimeState): CapabilityCatalogEntry[] {
  return state.all.map((c) => ({
    id: c.id,
    description: c.description,
    loaded: isCapabilityActive(state, c),
    deferLoading: !!c.deferLoading,
    source: c.source,
    toolCount:
      (c.tools?.length || 0) +
      (c.toolNames?.length || 0) +
      (c.toolNamePrefixes?.length ? 1 : 0),
  }))
}

export type CapabilityInspection = {
  capabilities: Array<CapabilityCatalogEntry & { provenance: CapabilityUnlockProvenance }>
  unlockedTools: Array<{ name: string; provenance: CapabilityUnlockProvenance }>
}

/** UI/audit projection: expose how the current run obtained each capability. */
export function inspectCapabilityState(state: CapabilityRuntimeState): CapabilityInspection {
  const capabilities = listCatalog(state).map((entry) => ({
    ...entry,
    provenance: state.provenance.capabilities.get(entry.id) ||
      (!state.progressive
        ? ('progressive-off' as const)
        : !entry.deferLoading
          ? ('always-on' as const)
          : ('preloaded' as const)),
  }))
  const unlockedTools = [...state.toolSearch.unlocked].sort().map((name) => ({
    name,
    provenance: state.provenance.tools.get(name) || 'preloaded',
  }))
  return { capabilities, unlockedTools }
}

/** Catalog text for system / user prompt (deferred only). */
export function formatDeferredCatalog(state: CapabilityRuntimeState): string {
  if (!state.progressive) return ''
  const deferred = state.all.filter((c) => c.deferLoading && !state.loadedIds.has(c.id))
  if (!deferred.length) return ''
  const lines = deferred.map((c) => `- ${c.id}: ${c.description}`)
  return [
    'The following capabilities are deferred and can be loaded using the `load_capability` tool:',
    ...lines,
    '',
    'Load a capability before using its tools or following its runbook. Loading activates tools + instructions together.',
  ].join('\n')
}

/** Always-on capability instructions (merged into system prompt). */
export function formatAlwaysOnInstructions(state: CapabilityRuntimeState): string {
  const parts = state.all
    .filter((c) => isCapabilityActive(state, c) && c.instructions?.trim())
    // Prefer not to dump huge skill bodies into always-on
    .filter((c) => !c.deferLoading || state.loadedIds.has(c.id))
    .map((c) => `### Capability: ${c.id}\n${c.instructions!.trim()}`)
  return parts.join('\n\n')
}

export function activeToolNames(state: CapabilityRuntimeState): Set<string> {
  const names = new Set<string>()
  for (const c of state.all) {
    if (!isCapabilityActive(state, c)) continue
    for (const t of c.tools || []) names.add(t)
    for (const t of c.toolNames || []) names.add(t)
  }
  if (state.progressive && state.all.some((c) => c.deferLoading && !state.loadedIds.has(c.id))) {
    names.add(LOAD_CAPABILITY_TOOL)
  }
  return names
}

/** Whether a tool name is allowed under current loaded set. */
export function isToolAllowedByCapabilities(
  state: CapabilityRuntimeState,
  toolName: string,
): boolean {
  if (toolName === LOAD_CAPABILITY_TOOL) {
    return state.progressive && state.all.some((c) => c.deferLoading)
  }
  if (toolName === TOOL_SEARCH_TOOL) return state.toolSearch.active
  if (!state.progressive) return true

  // Tool belongs to some capability?
  const owners = state.all.filter((c) => capabilityOwnsTool(c, toolName))
  if (owners.length === 0) {
    // Unknown tools (future): allow if not gated
    return true
  }
  return owners.some((c) => isCapabilityActive(state, c))
}

export function capabilityOwnsTool(cap: AgentCapability, toolName: string): boolean {
  if (cap.tools?.includes(toolName as ToolName)) return true
  if (cap.toolNames?.includes(toolName)) return true
  if (cap.toolNamePrefixes?.some((p) => toolName.startsWith(p))) return true
  return false
}

export function filterToolDefs(
  state: CapabilityRuntimeState,
  defs: OpenAiToolDef[],
): OpenAiToolDef[] {
  if (!state.progressive) return defs
  return defs.filter((d) => isToolAllowedByCapabilities(state, d.function.name))
}

export type LoadCapabilityResult =
  | { ok: true; id: string; instructions: string; newlyLoaded: boolean; tools: string[] }
  | { ok: false; error: string }

/** Activate a deferred capability; returns instructions for tool result. */
export function loadCapability(
  state: CapabilityRuntimeState,
  id: string,
  pool?: OpenAiToolDef[],
): LoadCapabilityResult {
  const key = id.trim()
  if (!key) return { ok: false, error: 'load_capability requires id' }
  const cap = state.all.find((c) => c.id === key)
  if (!cap) {
    const known = state.all.map((c) => c.id).join(', ')
    return {
      ok: false,
      error: `Unknown capability id «${key}». Known: ${known || '(none)'}`,
    }
  }
  const newlyLoaded = !state.loadedIds.has(cap.id)
  state.loadedIds.add(cap.id)
  state.provenance.capabilities.set(cap.id, 'load_capability')
  const tools = [
    ...(cap.tools || []),
    ...(cap.toolNames || []),
    ...(cap.toolNamePrefixes || []).map((p) => `${p}*`),
  ]
  let searchNote = ''
  if (state.toolSearch.active) {
    // Explicit tools are revealed; large prefix bundles (MCP) stay searchable
    for (const t of cap.tools || []) {
      state.toolSearch.unlocked.add(t)
      state.provenance.tools.set(t, 'load_capability')
    }
    for (const t of cap.toolNames || []) {
      state.toolSearch.unlocked.add(t)
      state.provenance.tools.set(t, 'load_capability')
    }
    if (cap.toolNamePrefixes?.length && pool) {
      const prefixDefs = pool.filter((d) =>
        cap.toolNamePrefixes!.some((p) => d.function.name.startsWith(p)),
      )
      if (prefixDefs.length <= 8) {
        for (const d of prefixDefs) {
          state.toolSearch.unlocked.add(d.function.name)
          state.provenance.tools.set(d.function.name, 'load_capability')
        }
      } else {
        searchNote = `\n\nThis capability exposes ${prefixDefs.length} tools. Their schemas stay hidden — use tool_search with a keyword to reveal the ones you need.`
      }
    }
  }
  const instructions =
    (cap.instructions?.trim() ||
      `(Capability «${cap.id}» loaded. Tools: ${tools.join(', ') || 'none'})`) + searchNote
  return {
    ok: true,
    id: cap.id,
    instructions: newlyLoaded
      ? instructions
      : `Capability «${cap.id}» already loaded.\n\n${instructions}`,
    newlyLoaded,
    tools,
  }
}

/** OpenAI tool def for the framework load_capability tool. */
export function loadCapabilityToolDef(state: CapabilityRuntimeState): OpenAiToolDef | null {
  if (!state.progressive) return null
  const deferred = state.all.filter((c) => c.deferLoading)
  if (!deferred.length) return null
  return {
    type: 'function',
    function: {
      name: LOAD_CAPABILITY_TOOL,
      description:
        'Load a deferred capability by id. Activates its tools and returns its runbook/instructions. Call before using tools owned by that capability.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: `Capability id. Available deferred: ${deferred.map((c) => c.id).join(', ')}`,
          },
        },
        required: ['id'],
      },
    },
  }
}

export function summarizeCapabilityState(state: CapabilityRuntimeState): string {
  const loaded = [...state.loadedIds]
  const deferred = state.all.filter((c) => c.deferLoading).length
  const ts = state.toolSearch.active
    ? ` toolSearch=on(threshold=${state.toolSearch.threshold})`
    : ''
  return state.progressive
    ? `capabilities progressive=on deferred=${deferred} loaded=[${loaded.join(', ')}]${ts}`
    : `capabilities progressive=off (all ${state.all.length} active)`
}

// ── Tool Search (Pydantic AI v2 「工具太多先藏起來，關鍵字檢索」) ──

/** Whether hiding kicks in for the current visible def count. */
export function toolSearchHidingActive(
  state: CapabilityRuntimeState,
  visibleDefs: OpenAiToolDef[],
): boolean {
  if (!state.toolSearch.active) return false
  const nonFramework = visibleDefs.filter((d) => !FRAMEWORK_TOOLS.has(d.function.name))
  return nonFramework.length > state.toolSearch.threshold
}

/**
 * Apply tool-search visibility on capability-filtered defs.
 * Over threshold → keep framework tools + always-on capability tools + unlocked.
 */
export function applyToolSearchVisibility(
  state: CapabilityRuntimeState,
  defs: OpenAiToolDef[],
): { defs: OpenAiToolDef[]; hiddenCount: number } {
  if (!toolSearchHidingActive(state, defs)) return { defs, hiddenCount: 0 }
  const kept = defs.filter((d) => {
    const name = d.function.name
    if (FRAMEWORK_TOOLS.has(name)) return true
    if (state.toolSearch.unlocked.has(name)) return true
    // Tools of always-on (non-deferred) capabilities stay visible
    return state.all.some((c) => !c.deferLoading && capabilityOwnsTool(c, name))
  })
  return { defs: kept, hiddenCount: defs.length - kept.length }
}

export interface ToolSearchResult {
  ok: boolean
  output: string
  unlocked: string[]
  /** Capability ids auto-loaded because a matched tool belonged to them */
  autoLoadedCapabilities: string[]
}

/**
 * Keyword retrieval over the full tool pool. Matches unlock schemas;
 * tools owned by an unloaded capability auto-load it (bundle instructions included).
 */
export function searchTools(
  state: CapabilityRuntimeState,
  pool: OpenAiToolDef[],
  query: string,
  limit = 6,
): ToolSearchResult {
  const q = query.trim().toLowerCase()
  if (!q) {
    return { ok: false, output: 'tool_search requires a non-empty query.', unlocked: [], autoLoadedCapabilities: [] }
  }
  const terms = q.split(/[\s,/]+/).filter(Boolean)
  const scored = pool
    .filter((d) => !FRAMEWORK_TOOLS.has(d.function.name))
    .map((d) => {
      const name = d.function.name.toLowerCase()
      const desc = d.function.description.toLowerCase()
      const keywords =
        TOOL_CATALOG.find((t) => t.name === d.function.name)?.keywords.join(' ').toLowerCase() ||
        ''
      let score = 0
      for (const t of terms) {
        if (name === t) score += 6
        else if (name.includes(t)) score += 4
        if (desc.includes(t)) score += 2
        if (keywords.includes(t)) score += 2
      }
      return { d, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 12)))

  if (!scored.length) {
    return {
      ok: true,
      output: `No tools matched «${query}». Try broader keywords, or list capabilities via the deferred catalog.`,
      unlocked: [],
      autoLoadedCapabilities: [],
    }
  }

  const unlocked: string[] = []
  const autoLoaded: string[] = []
  const lines: string[] = []
  for (const { d } of scored) {
    const name = d.function.name
    state.toolSearch.unlocked.add(name)
    state.provenance.tools.set(name, 'tool_search')
    unlocked.push(name)
    const owners = state.all.filter((c) => capabilityOwnsTool(c, name))
    const inactiveOwner = owners.find((c) => !isCapabilityActive(state, c))
    if (inactiveOwner && !autoLoaded.includes(inactiveOwner.id)) {
      state.loadedIds.add(inactiveOwner.id)
      state.provenance.capabilities.set(inactiveOwner.id, 'tool_search')
      autoLoaded.push(inactiveOwner.id)
    }
    lines.push(`- ${name}: ${d.function.description.slice(0, 140)}`)
  }
  const capNotes = autoLoaded
    .map((id) => {
      const cap = state.all.find((c) => c.id === id)
      return cap?.instructions
        ? `\n### Capability «${id}» auto-loaded — runbook\n${cap.instructions.trim().slice(0, 1500)}`
        : `\n(Capability «${id}» auto-loaded.)`
    })
    .join('\n')
  return {
    ok: true,
    output: [
      `Tools matching «${query}» are now available:`,
      ...lines,
      capNotes,
    ]
      .filter(Boolean)
      .join('\n'),
    unlocked,
    autoLoadedCapabilities: autoLoaded,
  }
}

/** OpenAI tool def for tool_search (only when hiding is in effect). */
export function toolSearchToolDef(
  state: CapabilityRuntimeState,
  hiddenCount: number,
): OpenAiToolDef | null {
  if (!state.toolSearch.active || hiddenCount <= 0) return null
  return {
    type: 'function',
    function: {
      name: TOOL_SEARCH_TOOL,
      description: `Search ${hiddenCount} hidden tools by keyword and reveal their schemas. Use when a needed tool is not in your current list.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords, e.g. "fetch url", "memory", "git"' },
          limit: { type: 'integer', description: 'Max matches to reveal (1-12)', default: 6 },
        },
        required: ['query'],
      },
    },
  }
}

// ── Capability-bundled model settings + human approval ──

/** Merged model settings from active capabilities (later definitions win). */
export function activeModelSettings(state: CapabilityRuntimeState): CapabilityModelSettings {
  const merged: CapabilityModelSettings = {}
  for (const c of state.all) {
    if (!c.modelSettings) continue
    if (!isCapabilityActive(state, c)) continue
    // Deferred caps only contribute once explicitly loaded
    if (c.deferLoading && !state.loadedIds.has(c.id)) continue
    Object.assign(merged, c.modelSettings)
  }
  return merged
}

/** True when any active capability declares this tool approval-required. */
export function approvalRequiredFor(
  state: CapabilityRuntimeState,
  toolName: string,
): boolean {
  return state.all.some(
    (c) => isCapabilityActive(state, c) && c.approvalTools?.includes(toolName),
  )
}
