/**
 * Simulation run marking — first-run honesty（spec 1/6, ticket 05）。
 *
 * 「本 run 會以模擬策略執行」的投射條件（真值表見 smoke-engine-availability）。
 * 語義必須對齊 engine useLlm()：builtin runner 且 LLM 未啟用/未填金鑰，
 * 或 overrides.useLlm === false。外部 CLI runner 一律不標（不走內建模擬路徑）。
 */
export interface SimulationMarkInput {
  runner: string
  llmEnabled: boolean
  llmApiKey: string
  /** engine overrides.useLlm === false 時強制模擬 */
  overrideUseLlm?: boolean | null
}

import { llmCredentialPresent } from './engineAvailability.ts'

export function isSimulationRun(input: SimulationMarkInput): boolean {
  if (input.runner !== 'builtin') return false
  if (input.overrideUseLlm === false) return true
  return !(input.llmEnabled && llmCredentialPresent(input.llmApiKey))
}

export const SIMULATION_NOTE =
  '⚠ 本 run 以本地模擬策略執行（未使用語言模型）——輸出為啟發式模擬結果，不代表真實模型行為。可於設定 → 語言模型啟用，或授權任一外部 CLI。'
