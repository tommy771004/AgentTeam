/**
 * ChatGPT-style「動作應如何核准？」三段模式定義。
 * 決策邏輯在 tools/approvalDecision.ts `decide()` / `decideApprovalNeed`;此處僅 UI 用資料。
 */
import type { ApprovalMode } from './types.ts'

export const APPROVAL_MODE_DEFS: Array<{
  id: ApprovalMode
  icon: string
  title: string
  desc: string
}> = [
  {
    id: 'always',
    icon: 'front_hand',
    title: '要求核准',
    desc: '一律先詢問是否要編輯外部檔案及使用網際網路',
  },
  {
    id: 'auto',
    icon: 'shield',
    title: '代我核准',
    desc: '僅對偵測為可能不安全的操作要求核准',
  },
  {
    id: 'full',
    icon: 'warning',
    title: '完整存取權',
    desc: '可無限制存取網際網路和您電腦上的任何檔案',
  },
]

export function approvalModeDef(mode: ApprovalMode | undefined) {
  return APPROVAL_MODE_DEFS.find((d) => d.id === (mode || 'auto')) || APPROVAL_MODE_DEFS[1]
}
