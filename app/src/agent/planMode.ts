/**
 * Plan mode(G8,grok-build plan-mode 語意):規劃/實作分離。
 *
 * Active 時只有 plan 檔(`.scratch/` 下,對齊 issue-tracker 慣例)可寫;
 * 其他寫入/副作用工具一律拒絕 —— 在 approvalMode 之前強制執行,
 * 連「完整存取權」也擋(與 grok 相同)。比 grok 更嚴的一點:bash 在
 * plan mode 也一律拒絕(grok 不檢查 shell 重導向,我們直接不放行)。
 *
 * 狀態以 runId 為 key(跨 step 存續,run 結束由 coordinator 清除);
 * unattended run 禁用(無人可審計畫)。純邏輯部分供 smoke 鏡射。
 */

export const PLAN_FILE_PREFIX = '.scratch/'

export const ENTER_PLAN_MODE_TOOL = 'enter_plan_mode'
export const EXIT_PLAN_MODE_TOOL = 'exit_plan_mode'

const activeRuns = new Set<string>()

export function setPlanMode(runId: string, on: boolean): void {
  if (!runId) return
  if (on) activeRuns.add(runId)
  else activeRuns.delete(runId)
}

export function isPlanModeActive(runId?: string): boolean {
  return Boolean(runId && activeRuns.has(runId))
}

export function clearPlanMode(runId?: string): void {
  if (runId) activeRuns.delete(runId)
}

/** 測試隔離用。 */
export function resetPlanMode(): void {
  activeRuns.clear()
}

/** plan mode 下無條件拒絕的工具(寫入/副作用/不可檢查)。 */
const PLAN_DENY_TOOLS = new Set([
  'bash',
  'workspace_delete',
  'workspace_move',
  'workspace_download',
  'message_send',
  'mcp_call',
  'delegate_task',
  'skill_save',
  'design_system_create',
  'design_system_update',
  'design_artifact_export',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_capture',
  'content_publish',
])

function isPlanFilePath(p: string): boolean {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  return norm.startsWith(PLAN_FILE_PREFIX) && !norm.includes('..')
}

/**
 * Plan mode 工具決策(純函式,smoke 鏡射):
 * - workspace_write / workspace_mkdir:僅 `.scratch/` 下放行
 * - PLAN_DENY_TOOLS、動態 MCP 工具、其他副作用工具:拒絕
 * - 唯讀工具(read/list/search/http_fetch/ask_user/framework 工具):放行
 */
export function planModeToolDecision(
  tool: string,
  input: Record<string, unknown>,
  sideEffectHint = false,
): { allowed: boolean; reason?: string } {
  if (tool === 'workspace_write' || tool === 'workspace_mkdir') {
    const p = String(input.path || '')
    if (isPlanFilePath(p)) return { allowed: true }
    return {
      allowed: false,
      reason: `Plan mode:只有 ${PLAN_FILE_PREFIX} 下的計畫文件可寫,「${p.slice(0, 80)}」被拒。先 exit_plan_mode 取得核准再實作。`,
    }
  }
  if (PLAN_DENY_TOOLS.has(tool) || tool.startsWith('mcp_') || sideEffectHint) {
    return {
      allowed: false,
      reason: `Plan mode:${tool} 屬副作用工具,規劃階段不可執行。完成計畫後呼叫 exit_plan_mode 請使用者核准。`,
    }
  }
  return { allowed: true }
}
