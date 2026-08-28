import type {
  PermissionAction,
  PermissionKey,
  PermissionPolicy,
  PermissionProjection,
} from './types.ts'

export function toolPermissionKey(toolName: string): PermissionKey {
  if (toolName.startsWith('mcp_') || toolName === 'mcp_list_tools' || toolName === 'mcp_call') return 'mcp'
  if (['workspace_write', 'design_artifact_export', 'skill_save', 'bash'].includes(toolName)) return 'edit'
  if (['web_search', 'http_fetch'].includes(toolName)) return 'web'
  if (toolName.startsWith('memory_')) return 'memory'
  if (toolName.startsWith('skill_')) return 'skill'
  if (toolName.startsWith('delegate_')) return 'delegate'
  if (toolName === 'message_send') return 'task'
  return 'read'
}

export function checkToolPermission(
  policy: PermissionPolicy | undefined,
  toolName: string,
): PermissionAction {
  return policy?.[toolPermissionKey(toolName)] ?? 'allow'
}

function matchGlob(pattern: string, text: string): boolean {
  if (pattern === '*') return true
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  try {
    const expression = new RegExp(body)
    return new RegExp(`^${body}$`).test(text) || expression.test(text)
  } catch {
    return text.includes(pattern.replace(/\*/g, ''))
  }
}

function resolvePatternPermission(
  rules: Record<string, PermissionAction>,
  value: string,
  fallback: PermissionAction,
): PermissionAction {
  let result = fallback
  for (const [pattern, action] of Object.entries(rules)) {
    if (matchGlob(pattern, value)) result = action
  }
  return result
}

export function checkProjectedToolPermission(
  projection: PermissionProjection | undefined,
  toolName: string,
  input: Record<string, unknown> = {},
): PermissionAction | undefined {
  if (!projection) return undefined
  const key = toolPermissionKey(toolName)
  const command = String(input.command ?? input.cmd ?? '').trim()
  let result: PermissionAction | undefined
  for (const [pattern, rule] of Object.entries(projection.rules)) {
    const targets = pattern === 'bash' ? ['bash', key, toolName] : [pattern]
    if (!targets.some((target) => target === key || target === toolName || matchGlob(target, toolName))) continue
    if (typeof rule === 'string') result = rule
    else result = resolvePatternPermission(rule, pattern === 'bash' ? command : toolName, result || 'allow')
  }
  return result
}
