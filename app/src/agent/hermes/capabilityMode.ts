/**
 * Delegate capability mode(G9,grok `spawn_subagent.capability_mode` 語意):
 * 對子代理工具做粗粒度篩選,疊加在角色 blockedTools 之上(只會更嚴)。
 *
 * | mode       | Read | Write | Execute |
 * |------------|------|-------|---------|
 * | read-only  |  ✓   |  ✗    |  ✗      |
 * | read-write |  ✓   |  ✓    |  ✗      |
 * | execute    |  ✓   |  ✗    |  ✓      |
 * | all        |  ✓   |  ✓    |  ✓      |
 *
 * 純邏輯;smoke 直接 import 驗證。動態 MCP 工具名稱無法窮舉,
 * 由 toolGuard 的 mcp 判定與 leaf 的 includeMcpTools=false 另行把關。
 */

export type DelegateCapabilityMode = 'read-only' | 'read-write' | 'execute' | 'all'

/** 會改動 workspace / 記憶 / 外部狀態的工具。 */
const WRITE_TOOLS = [
  'workspace_write',
  'workspace_download',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
  'memory_set',
  'memory_append',
  'skill_save',
  'message_send',
  'design_brief_update',
  'design_direction_select',
  'design_artifact_register',
  'design_artifact_patch',
  'design_artifact_tweak',
  'design_artifact_capture',
  'design_artifact_export',
]

/** 執行任意程式/外呼的工具。 */
const EXECUTE_TOOLS = ['bash', 'run_code', 'mcp_call']

export function parseCapabilityMode(raw: unknown): DelegateCapabilityMode | undefined {
  const s = String(raw || '').trim().toLowerCase().replace(/_/g, '-')
  if (s === 'read-only' || s === 'readonly') return 'read-only'
  if (s === 'read-write' || s === 'readwrite') return 'read-write'
  if (s === 'execute') return 'execute'
  if (s === 'all') return 'all'
  return undefined
}

/** mode → 需要封鎖的工具名(疊加在既有 blockedTools 上)。 */
export function blockedToolsForCapabilityMode(
  mode: DelegateCapabilityMode | undefined,
): string[] {
  switch (mode) {
    case 'read-only':
      return [...WRITE_TOOLS, ...EXECUTE_TOOLS]
    case 'read-write':
      return [...EXECUTE_TOOLS]
    case 'execute':
      return [...WRITE_TOOLS]
    case 'all':
    default:
      return []
  }
}
