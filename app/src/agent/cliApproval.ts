import type { ApprovalMode } from './types.ts'

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
    return { mode: 'auto', permissive: false, note: '無人值守任務：完整存取權降級為代我核准' }
  }
  if (requested !== 'full') {
    return {
      mode: requested,
      permissive: false,
      note: requested === 'always'
        ? 'CLI 使用要求核准模式；無法完成核准交握時會安全停止'
        : 'CLI 使用供應商的自動核准模式，不放寬 sandbox',
    }
  }
  if (agentMode === 'plan') {
    return { mode: 'auto', permissive: false, note: 'Plan mode 優先，保留 CLI plan 權限限制' }
  }
  if (kind === 'codex' || kind === 'claude' || kind === 'grok' || kind === 'cursor') {
    const notes: Record<string, string> = {
      grok: '互動完整存取權：已映射 Grok --always-approve',
      codex: '互動完整存取權：已映射 Codex --dangerously-bypass-approvals-and-sandbox',
      claude: '互動完整存取權：已映射 Claude --dangerously-skip-permissions',
      cursor: '互動完整存取權：已映射 Cursor -p --force',
    }
    return {
      mode: 'full',
      permissive: true,
      note: notes[kind] || '互動完整存取權：已映射 CLI permissive flag',
    }
  }
  return { mode: 'auto', permissive: false, note: `${kind} 未宣告穩定完整存取旗標，降級為代我核准` }
}
