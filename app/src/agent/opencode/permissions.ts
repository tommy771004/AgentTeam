/**
 * OpenCode-inspired permission model: allow | ask | deny
 *
 * Pure map + checks live in toolPermissionMap (shared with approvalDecision).
 */

import type { PermissionPolicy } from '../types.ts'
import { checkToolPermission } from './toolPermissionMap.ts'

export type { PermissionAction, PermissionKey, PermissionPolicy } from './toolPermissionMap.ts'
export {
  toolPermissionKey,
  resolvePermission,
  checkToolPermission,
  checkProjectedToolPermission,
} from './toolPermissionMap.ts'

/** Tools blocked when action is deny */
export function deniedToolsFromPolicy(policy: PermissionPolicy | undefined): string[] {
  if (!policy) return []
  const all = [
    'workspace_write',
    'design_system_create',
    'design_system_update',
    'design_artifact_export',
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
