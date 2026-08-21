/**
 * Interactive-surface lifecycle states and their wording.
 *
 * Data, not UI: the surface component renders it and the conversation projects
 * it, so each state reaches the user as its own message rather than one
 * undifferentiated spinner (issue 07).
 */
export type SurfaceStatus =
  | 'loading'
  | 'ready'
  | 'submitted'
  | 'invalid'
  | 'expired'
  | 'unavailable'
  | 'error'

export const SURFACE_STATUS_LABELS: Record<SurfaceStatus, string> = {
  loading: '載入中',
  ready: '等待選擇',
  submitted: '已送出',
  invalid: '被拒絕（bridge 驗證失敗）',
  expired: '已逾期',
  unavailable: '不可用，改用原生備援',
  error: '執行失敗，改用原生備援',
}

/** These states hand over to the native fallback. */
export function surfaceFallsBack(status: SurfaceStatus): boolean {
  return status === 'unavailable' || status === 'invalid' || status === 'expired' || status === 'error'
}
