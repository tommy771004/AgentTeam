/**
 * DoD verdict 逐輪記錄（dod-verified-reports 票 01）。
 *
 * loopRunner 每輪 DoD 檢查後 append 一筆快照；報告/計分卡消費。
 * 純函數：不讀 store、不改輸入（missing 快照隔離）。
 */
import type { DodVerdict } from './types'

export function appendDodVerdict(
  list: DodVerdict[] | undefined,
  verdict: Omit<DodVerdict, 'missing'> & { missing: string[] },
): DodVerdict[] {
  const snapshot: DodVerdict = { ...verdict, missing: [...verdict.missing] }
  return [...(list || []), snapshot]
}

/** 最終判定 = 最後一筆（缺省代表從未記錄） */
export function finalDodVerdict(list: DodVerdict[] | undefined): DodVerdict | null {
  return list && list.length ? list[list.length - 1] : null
}

/** 迭代收斂歷程：每輪後剩餘缺口數（供計分卡視覺化） */
export function dodConvergence(list: DodVerdict[] | undefined): number[] {
  return (list || []).map((v) => v.missing.length)
}
