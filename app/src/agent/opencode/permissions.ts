/**
 * OpenCode-inspired permission model: allow | ask | deny
 */

import type { PermissionAction, PermissionKey, PermissionPolicy } from '../types'

export type { PermissionAction, PermissionKey, PermissionPolicy }

/** Map tool name → permission key */
export function toolPermissionKey(toolName: string): PermissionKey {
  if (toolName.startsWith('mcp_') || toolName === 'mcp_list_tools' || toolName === 'mcp_call') {
    return 'mcp'
  }
  switch (toolName) {
    case 'workspace_write':
    case 'skill_save':
    case 'bash':
      return 'edit'
    case 'workspace_read':
    case 'workspace_list':
    case 'datetime_now':
    case 'json_extract_lite':
      return 'read'
    case 'web_search':
    case 'http_fetch':
      return 'web'
    case 'memory_get':
    case 'memory_set':
    case 'memory_append':
    case 'memory_search':
      return 'memory'
    case 'skill_list':
    case 'skill_load':
      return 'skill'
    case 'delegate_task':
    case 'delegate_status':
      return 'delegate'
    case 'message_send':
      return 'task'
    case 'update_plan':
    case 'ask_user':
      // UI-only coordination tools do not mutate the workspace and remain
      // available in Plan mode even when task/delegate actions are denied.
      return 'read'
    case 'workspace_diff':
      return 'read'
    default:
      return 'read'
  }
}

export function resolvePermission(
  policy: PermissionPolicy | undefined,
  key: PermissionKey,
  fallback: PermissionAction = 'allow',
): PermissionAction {
  if (!policy) return fallback
  return policy[key] ?? fallback
}

export function checkToolPermission(
  policy: PermissionPolicy | undefined,
  toolName: string,
): PermissionAction {
  return resolvePermission(policy, toolPermissionKey(toolName), 'allow')
}

/** Tools blocked when action is deny */
export function deniedToolsFromPolicy(policy: PermissionPolicy | undefined): string[] {
  if (!policy) return []
  const all = [
    'workspace_write',
    'skill_save',
    'bash',
    'web_search',
    'http_fetch',
    'memory_set',
    'memory_append',
    'skill_load',
    'skill_list',
    'mcp_call',
    'mcp_list_tools',
    'delegate_task',
    'message_send',
  ]
  return all.filter((t) => checkToolPermission(policy, t) === 'deny')
}
