/**
 * Shared pure helpers used by both approvalDecision and toolGuard —
 * avoids circular imports when decide() lives in its own module.
 */

/** Bash commands that can mutate the linked SubDesign workspace. */
export function isSubDesignReadonlyBashCommand(command: string): boolean {
  const value = command.trim()
  if (!value || /[`$()<>]/.test(value)) return false
  if (/\b(?:curl|wget|nc|ssh|scp|sftp|npm|pnpm|yarn|bun|cargo|pip|python(?:3)?|node|ruby|perl|php|make|docker)\b/i.test(value)) return false
  if (/\bgit\s+(?:apply|add|commit|clean|checkout|mv|rm|reset|restore|rebase|merge|cherry-pick|stash|switch|branch\s+(?!--show-current)|tag|push|pull|fetch|clone)\b/i.test(value)) return false
  const commands = value.split(/\s*(?:&&|\|\||;|\|)\s*/).map((part) => part.trim()).filter(Boolean)
  if (!commands.length) return false
  return commands.every((part) => /^(?:pwd|ls|cat|head|tail|grep|rg|find|fd|sort|uniq|wc|echo|printf|which|type|command\s+-v|env|printenv|git\s+(?:status|diff|log|show|branch\s+--show-current|rev-parse|ls-files)|sed\s+(?!.*(?:^|\s)-i\b)|awk)\b/i.test(part))
}

export function isSubDesignWritableBashCommand(command: string): boolean {
  return !isSubDesignReadonlyBashCommand(command)
}

/**
 * ChatGPT「要求核准」範圍：會編輯檔案或使用網路等副作用工具。
 * 唯讀工具（list/read/search memory/codegraph/datetime…）不在此列。
 */
export const SIDE_EFFECT_TOOLS = new Set([
  'bash',
  'monitor',
  'workspace_write',
  'design_artifact_export',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_capture',
  'design_artifact_lint',
  'design_gate_contrast',
  'design_gate_console_error',
  'design_gate_build_success',
  'design_gate_responsive_overflow',
  'design_gate_token_consistency',
  'workspace_download',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
  'http_fetch',
  'web_search',
  'message_send',
  'mcp_call',
  'skill_save',
  'memory_set',
  'memory_append',
  'run_code',
  'delegate_task',
])

/** Side-effect classification (dynamic MCP tools count as network). */
export function isSideEffectTool(tool: string): boolean {
  return SIDE_EFFECT_TOOLS.has(tool) || tool.startsWith('mcp_')
}
