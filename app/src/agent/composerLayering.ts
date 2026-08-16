/**
 * Composer new-task flow（ticket 03）— composer 基礎／進階分層的純邏輯。
 *
 * 分層只是「長相」：這裡決定進階區呈現哪些控制、以及某個模型允許哪些推理程度，
 * 完全不碰 run 的預設值或語義（Auto loop、builtin 引擎、既有 depth 預設不變）。
 * 抽成獨立模組是為了讓 UI 與 smoke 共用同一份判定，不各自重寫一次。
 */
import { depthsForModel } from './cliProviders.ts'
import { THINKING_DEPTHS, type ThinkingDepthDef } from './thinking.ts'
import type { CliProviderConfig, LoopType } from './types.ts'

export type LoopChoice = {
  /** null = 自動分類（預設） */
  type: LoopType | null
  label: string
  icon: string
  hint: string
  /**
   * 這個選項不是「釘選這個對話」，而是開建立自動化規則的表單。
   *
   * Time-based / Proactive 的執行只能由 claimed ScheduledJob 或事件證據進入，
   * composer 送不出這兩種 run；把它們做成釘選就是死路（使用者以為設了排程、
   * 其實什麼都不會發生）。所以這兩格點下去是建立規則，不是標記語意。
   */
  createsAutomation?: 'schedule' | 'event'
}

/** 進階區的 Loop Pattern 選項（順序即呈現順序）。 */
export const LOOP_CHOICES: readonly LoopChoice[] = [
  { type: null, label: '自動', icon: 'auto_awesome', hint: '短訊息走回合、複雜目標走目標迴圈' },
  { type: 'Goal-based', label: '目標', icon: 'track_changes', hint: '迭代到驗收標準滿足為止' },
  { type: 'Turn-based', label: '回合', icon: 'forum', hint: '一問一答，不自行迭代' },
  {
    type: 'Time-based',
    label: '定時',
    icon: 'schedule',
    hint: '建立定時任務（到期自動執行）',
    createsAutomation: 'schedule',
  },
  {
    type: 'Proactive',
    label: '事件',
    icon: 'bolt',
    hint: '建立事件規則（條件成立才觸發）',
    createsAutomation: 'event',
  },
] as const

/**
 * 某個模型允許的推理程度。
 *
 * 沒有任何已授權 CLI（或該模型沒有宣告 depth）時回全部——不能因為查不到就把
 * 使用者鎖在單一深度。
 */
export function allowedDepthsFor(
  cliProviders: CliProviderConfig[] | undefined,
  model: string,
  globalModel: string,
): ThinkingDepthDef[] {
  if (!cliProviders?.length) return THINKING_DEPTHS
  const ids = depthsForModel(cliProviders, model.trim() || globalModel)
  const allowed = THINKING_DEPTHS.filter((depth) => ids.includes(depth.id))
  return allowed.length ? allowed : THINKING_DEPTHS
}
