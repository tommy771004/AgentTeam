/**
 * Composer new-task flow（ticket 06）— 送出前的 DoD 預覽。
 *
 * DoD（Definition of Done）是 Goal-based run 的驗收標準：迴圈會一直迭代到它滿足
 * 為止。過去它在建立時完全看不見，只在結束後以「還剩 N 個 gaps」出現——價值全在
 * 事後。這裡把同一份 auto-parse 結果提前到送出前，讓人先看見、能改。
 *
 * 這個模組是純的，而且刻意只讀 parser 既有的判定：預覽不會改變分類、步驟或迭代
 * 次數，使用者若不編輯，行為與沒有這張卡時完全相同。
 */
import { parseUserRequest } from './parser.ts'
import type { LoopType } from './types.ts'

export type DodPreview = {
  /** auto-parse 出來的驗收標準 */
  definitionOfDone: string
  loopType: LoopType
  /** 一句話說明這張卡為什麼出現 */
  reason: string
}

const AUTO_REASON = 'Auto 判定為 Goal-based：複雜目標會迭代到這條驗收標準滿足為止。'
const PINNED_REASON = '這個對話已釘為目標迴圈：執行會迭代到這條驗收標準滿足為止。'

/**
 * 送出前預覽這次任務的 DoD。
 *
 * @param pinnedLoopType 使用者釘選的 loop（null = 交給 auto 分類）
 * @returns Goal-based 才回傳；其餘（含空輸入、Turn-based 輕量對話）回 null，
 *          輕量互動不該被一張驗收標準卡打斷。
 */
export function previewDod(
  objective: string,
  pinnedLoopType: LoopType | null,
): DodPreview | null {
  const text = objective.trim()
  if (!text) return null
  // 排程／事件由自動化規則觸發，composer 送不出這兩種 run，沒有預覽的意義。
  if (pinnedLoopType && pinnedLoopType !== 'Goal-based') return null

  let parsed
  try {
    parsed = parseUserRequest(text, pinnedLoopType || undefined)
  } catch {
    return null
  }
  if (parsed.config.loopType !== 'Goal-based') return null

  return {
    definitionOfDone: parsed.config.definitionOfDone,
    loopType: parsed.config.loopType,
    reason: pinnedLoopType === 'Goal-based' ? PINNED_REASON : AUTO_REASON,
  }
}

/**
 * 使用者編輯過的 DoD 才需要隨 ingress snapshot 送出。
 * 沒改（或改回原樣、或清空）就回 undefined —— 缺省時行為完全不變。
 */
export function resolveUserDefinitionOfDone(
  edited: string | undefined,
  preview: DodPreview | null,
): string | undefined {
  const text = edited?.trim()
  if (!text) return undefined
  if (!preview) return undefined
  if (text === preview.definitionOfDone.trim()) return undefined
  return text
}
