export const PLAN_FILE_PREFIX = '.scratch/'

const PLAN_FILE_TOOLS = new Set(['write', 'edit', 'workspace_write', 'workspace_mkdir'])
const PLAN_CONTROL_TOOLS = new Set(['update_plan', 'complete_plan', 'record_continuation_items', 'ask_user'])
const PLAN_DENY_TOOLS = new Set([
  'bash',
  'workspace_delete',
  'workspace_move',
  'workspace_download',
  'message_send',
  'mcp_call',
  'delegate_task',
  'skill_save',
  'design_artifact_export',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_capture',
  'content_publish',
])

export function isPlanFilePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  return normalized.startsWith(PLAN_FILE_PREFIX) && !normalized.split('/').includes('..')
}

/** Canonical Plan policy shared by the browser fallback and Pi Host. */
export function planModeToolDecision(
  tool: string,
  input: Record<string, unknown>,
  sideEffectHint = false,
): { allowed: boolean; reason?: string } {
  if (PLAN_CONTROL_TOOLS.has(tool)) return { allowed: true }
  if (PLAN_FILE_TOOLS.has(tool)) {
    const path = String(input.path || input.file || input.filePath || '')
    if (isPlanFilePath(path)) return { allowed: true }
    return {
      allowed: false,
      reason: `Plan mode:只有 ${PLAN_FILE_PREFIX} 下的計畫文件可寫,「${path.slice(0, 80)}」被拒。Plan Gate 通過後才能實作。`,
    }
  }
  if (PLAN_DENY_TOOLS.has(tool) || tool.startsWith('mcp_') || sideEffectHint) {
    return {
      allowed: false,
      reason: `Plan mode:${tool} 屬副作用工具,規劃階段不可執行。Plan Gate 通過後才能實作。`,
    }
  }
  return { allowed: true }
}
