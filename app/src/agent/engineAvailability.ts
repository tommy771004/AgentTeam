/**
 * Engine availability derivation — first-run honesty（spec 1/6, ticket 02）。
 *
 * 純推導：輸入語言模型設定與 CLI 授權狀態的快照，輸出橫幅顯示判定與
 * 醫生卡三態。不讀 store、不觸 IPC——消費端（橫幅／醫生卡）自己接資料。
 * 文案以 key 對應 zh-TW；i18n spec 落地時改為語言檔 key。
 */
import type { LlmSettings } from './types'

/** 醫生卡三態：未啟用 / 已啟用未通連 / 可用 */
export type LlmCheckState = 'disabled' | 'unverified' | 'ok'

export interface EngineAvailabilityInput {
  llmEnabled: boolean
  /** apiKey 是否已填（非空白） */
  llmCredentialPresent: boolean
  /** 最近一次連線測試結果；null = 尚未測試 */
  llmConnected: boolean | null
  /** 已啟用且已授權的 CLI provider 數 */
  authorizedCliCount: number
}

export interface EngineAvailability {
  llmCheck: LlmCheckState
  /** 任一引擎（內建 LLM 或已授權 CLI）可執行真實任務 */
  anyEngineUsable: boolean
  /** 誠實性橫幅：沒有任何可用引擎時顯示 */
  bannerVisible: boolean
}

export function deriveEngineAvailability(input: EngineAvailabilityInput): EngineAvailability {
  const llmCheck: LlmCheckState = !input.llmEnabled
    ? 'disabled'
    : input.llmCredentialPresent && input.llmConnected === true
      ? 'ok'
      : 'unverified'
  // 對齊引擎語義（engine useLlm：enabled && apiKey 即跑真實 LLM，不要求先測過連線）；
  // 只有連線測試「失敗」才視為不可用。醫生卡的 unverified（尚未測試）不影響可用性。
  const llmUsable = input.llmEnabled && input.llmCredentialPresent && input.llmConnected !== false
  const anyEngineUsable = llmUsable || input.authorizedCliCount > 0
  return { llmCheck, anyEngineUsable, bannerVisible: !anyEngineUsable }
}

/** 便利投影：從 LlmSettings 快照組出輸入（仍為純函數）。 */
export function deriveEngineAvailabilityFromSettings(
  settings: Pick<LlmSettings, 'enabled' | 'apiKey' | 'cliProviders'>,
  llmConnected: boolean | null,
): EngineAvailability {
  return deriveEngineAvailability({
    llmEnabled: settings.enabled,
    llmCredentialPresent: settings.apiKey.trim().length > 0,
    llmConnected,
    authorizedCliCount: settings.cliProviders.filter((p) => p.enabled && p.authorized).length,
  })
}

export const LLM_CHECK_COPY: Record<LlmCheckState, { title: string; hint: string }> = {
  disabled: { title: '語言模型未啟用', hint: '前往設定啟用並填入 API 金鑰，或授權任一外部 CLI' },
  unverified: { title: '語言模型已啟用未通連', hint: '金鑰未填或連線未驗證——請在設定按「測試連線」' },
  ok: { title: '語言模型可用', hint: '連線測試通過，任務將以真實模型執行' },
}

export const ENGINE_BANNER_COPY = {
  title: '目前沒有可用的執行引擎',
  body: '尚未設定語言模型，也未授權任何外部 CLI——送出的任務會以本地模擬策略執行（不會有真實模型輸出）。',
  cta: '前往設定',
} as const
