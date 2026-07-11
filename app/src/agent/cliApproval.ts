import type { ApprovalMode } from './types'

export type CliApprovalResolution = {
  mode: ApprovalMode
  permissive: boolean
  note: string
}

/** Shared renderer/main policy; main applies it again before spawning a CLI. */
export function resolveCliApproval(
  kind: string,
  mode: ApprovalMode | undefined,
  unattended: boolean | undefined,
  agentMode: string | undefined,
): CliApprovalResolution {
  const requested = mode || 'auto'
  if (requested === 'full' && unattended) {
    return { mode: 'auto', permissive: false, note: '無人值守任務：完整存取權降級為 CLI 預設核准' }
  }
  if (requested !== 'full') {
    return { mode: requested, permissive: false, note: 'CLI 使用其預設互動核准' }
  }
  if (agentMode === 'plan') {
    return { mode: 'auto', permissive: false, note: 'Plan mode 優先，保留 CLI plan 權限限制' }
  }
  if (kind === 'codex' || kind === 'claude') {
    return { mode: 'full', permissive: true, note: '互動完整存取權：已映射 CLI permissive flag' }
  }
  return { mode: 'auto', permissive: false, note: `${kind} 未宣告穩定 permissive flag，保留 CLI 預設核准` }
}
