/** UI 中文文案與狀態映射 */

export const LOOP_TYPE_ZH: Record<string, string> = {
  'Turn-based': '回合制',
  'Goal-based': '目標導向',
  'Time-based': '定時觸發',
  Proactive: '主動觸發',
}

export const STATUS_ZH: Record<string, string> = {
  idle: '閒置',
  parsing: '解析中',
  running: '執行中',
  awaiting_user: '等待使用者',
  success: '成功',
  failed: '失敗',
  halted: '已中止',
  interrupted: '執行中斷',
  manual_intervention: '人工介入',
  warning: '警告',
}

export function loopTypeZh(t: string) {
  return LOOP_TYPE_ZH[t] || t
}

export function statusZh(s: string) {
  return STATUS_ZH[s] || s
}
