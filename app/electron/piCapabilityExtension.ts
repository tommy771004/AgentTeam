export type PiCapability = { id: string; description: string; tools: string[]; runbook: string; deferLoading?: boolean }

/**
 * The full capability set the Host owns — the renderer's 14 capability
 * boundaries plus the Pi builtin groups, each mapped to the tools the Host
 * ACTUALLY registers (issue 12). A capability whose tools are not all
 * registered yet lists only what exists, so the catalog never advertises a
 * tool that cannot run.
 */
export const DEFAULT_PI_CAPABILITIES: PiCapability[] = [
  { id: 'core-files', description: 'Read-only project file discovery and inspection.', tools: ['find', 'grep', 'ls', 'read'], runbook: 'Use project-scoped read tools before proposing edits.', deferLoading: true },
  { id: 'workspace-write', description: 'Workspace file edits.', tools: ['edit', 'write'], runbook: 'Review the target and preserve the approved project root.', deferLoading: true },
  { id: 'workspace', description: 'Move, delete, diff, and download project files.', tools: ['workspace_diff', 'workspace_move', 'workspace_delete', 'workspace_mkdir', 'workspace_download'], runbook: 'Mutating workspace tools join the per-file mutation queue and require approval.', deferLoading: true },
  { id: 'shell', description: 'Controlled project shell execution.', tools: ['bash'], runbook: 'Use the policy gate and ask before side effects.', deferLoading: true },
  { id: 'interaction', description: 'Human-in-the-loop questions through the shared HITL path.', tools: ['ask_user'], runbook: 'Ask when the objective is genuinely ambiguous; unattended runs auto-deny.' },
  { id: 'planning', description: 'The plan panel the model drives and the user watches.', tools: ['update_plan'], runbook: 'Publish multi-step plans so the user can follow progress.' },
  { id: 'core-utils', description: 'Time, table parsing, JSON extraction, output paging.', tools: ['datetime_now', 'table_parse', 'json_extract_lite', 'tool_output_read'], runbook: 'Prefer structured parsing over regex guessing.' },
  { id: 'web-research', description: 'Outbound web search and page fetch.', tools: ['web_search', 'http_fetch'], runbook: 'Cite sources; fetch pages before summarizing them.', deferLoading: true },
  { id: 'messaging', description: 'Message delivery through the configured gateway.', tools: ['message_send'], runbook: 'Credentials are operator configuration; never invent one.', deferLoading: true },
  { id: 'memory', description: 'Durable cross-run memory on the Host store.', tools: ['memory_set', 'memory_get', 'memory_append', 'memory_search'], runbook: 'Temporary chats neither read nor write memory.', deferLoading: true },
  { id: 'monitoring', description: 'Background activity summary for this host.', tools: ['monitor'], runbook: 'Report queued vs active work honestly.', deferLoading: true },
  { id: 'delegate', description: 'Sub-agent delegation through child sessions.', tools: ['delegate_task', 'delegate_status'], runbook: 'Children need role, profile, context, and depth; missing pieces fail closed.', deferLoading: true },
  { id: 'codegraph', description: 'Structural questions over the app-indexed code graph.', tools: ['codegraph_explore', 'codegraph_status', 'codegraph_impact', 'codegraph_callers'], runbook: 'An un-indexed project is a status answer, not an error.', deferLoading: true },
  { id: 'mcp-bridge', description: 'Load namespaced native tools from configured MCP servers.', tools: [], runbook: 'Use the native mcp_<source>_<tool> contract. Generic bridge verbs are compatibility-only.', deferLoading: true },
  { id: 'subdesign-workflow', description: 'The brief → direction → build → critique → deliver workflow.', tools: ['design_brief_update', 'design_direction_select', 'design_artifact_register', 'design_artifact_capture', 'design_artifact_patch', 'design_artifact_tweak', 'design_artifact_lint', 'design_critique_note', 'design_critique', 'design_gate_contrast', 'design_gate_console_error', 'design_gate_build_success', 'design_gate_responsive_overflow', 'design_gate_token_consistency', 'design_artifact_export'], runbook: 'Gates fail closed without evidence files; deliver requires a passing critique.', deferLoading: true },
]

/**
 * Capability ids whose tools exist in the renderer catalog but have no Host
 * counterpart. They stay LISTED with their honest state instead of silently
 * disappearing (issue 12): skills moved to Pi resources, design critique is
 * its own workflow, and code mode's verbs live in the framework pack.
 */
export const UNHOSTED_PI_CAPABILITY_IDS = ['skills', 'design-critique'] as const

/** The always-on framework verbs; reserved names across the whole catalog. */
export const PI_FRAMEWORK_CAPABILITY_ID = 'framework-pack' as const

export class PiCapabilityCatalog {
  private readonly active = new Set<string>()
  private readonly activeBySession = new Map<string, Set<string>>()
  private readonly capabilities: PiCapability[]
  constructor(capabilities: PiCapability[]) { this.capabilities = [...capabilities] }
  private activeSet(sessionId?: string): Set<string> {
    if (!sessionId) return this.active
    const current = this.activeBySession.get(sessionId)
    if (current) return current
    const created = new Set<string>()
    this.activeBySession.set(sessionId, created)
    return created
  }
  catalog(sessionId?: string) {
    const active = this.activeSet(sessionId)
    return this.capabilities.map(({ id, description, deferLoading }) => ({ id, description, deferred: deferLoading === true && !active.has(id) }))
  }
  load(id: string, sessionId?: string): PiCapability {
    const capability = this.capabilities.find((candidate) => candidate.id === id)
    if (!capability) throw new Error(`Unknown capability: ${id}`)
    this.activeSet(sessionId).add(id)
    return { ...capability, tools: [...capability.tools] }
  }
  activeTools(sessionId?: string) {
    const active = this.activeSet(sessionId)
    return this.capabilities.filter((capability) => active.has(capability.id)).flatMap((capability) => capability.tools).sort()
  }
  search(query: string, sessionId?: string) {
    return this.capabilities
      .filter((capability) => `${capability.id} ${capability.description} ${capability.tools.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
      .map((capability) => this.load(capability.id, sessionId))
  }
  clear(sessionId: string): void { this.activeBySession.delete(sessionId) }
}
