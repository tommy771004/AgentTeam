/**
 * Agent-level (framework) tools — intercepted before gated Tool Invocation.
 * Hermes-aligned: framework tools never share the gated authorize→execute tail
 * with ordinary tools (though post-auth agents still run authorizeTool first,
 * bit-for-bit with historical toolLoop order).
 *
 * Pre-authorize: plan, tool_search, load_capability
 * Post-authorize: run_code, delegate_*
 *
 * Names are string constants (avoid importing capabilities/builtins → heavy graph).
 */

/** Full agent-level name set (Hermes-style intercept vocabulary). */
export const AGENT_LEVEL_TOOL_NAMES = [
  'enter_plan_mode',
  'exit_plan_mode',
  'tool_search',
  'load_capability',
  'run_code',
  'delegate_task',
  'delegate_status',
] as const

export type AgentLevelToolName = (typeof AGENT_LEVEL_TOOL_NAMES)[number]

const AGENT_LEVEL_SET = new Set<string>(AGENT_LEVEL_TOOL_NAMES)

/** Tools handled before capability gate + authorize (no Approval Decision). */
export const PRE_AUTH_AGENT_LEVEL_TOOLS = new Set<string>([
  'enter_plan_mode',
  'exit_plan_mode',
  'tool_search',
  'load_capability',
])

/** Tools handled after authorize but not via invokeGatedTool. */
export const POST_AUTH_AGENT_LEVEL_TOOLS = new Set<string>([
  'run_code',
  'delegate_task',
  'delegate_status',
])

export function isAgentLevelTool(name: string): boolean {
  return AGENT_LEVEL_SET.has(name)
}

export function isPreAuthAgentLevelTool(name: string): boolean {
  return PRE_AUTH_AGENT_LEVEL_TOOLS.has(name)
}

export function isPostAuthAgentLevelTool(name: string): boolean {
  return POST_AUTH_AGENT_LEVEL_TOOLS.has(name)
}
