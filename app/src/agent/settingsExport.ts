/**
 * Issue 06 — 設定匯出遮罩（pure，settingsStore.exportBundle 與 smoke 共用）。
 * 以 key pattern 遞迴掃描：新增的祕密欄位（*ApiKey / *Token / *Secret / *Password /
 * *Credential）不需要改這裡就會被遮罩，避免手寫欄位清單 drift。
 */

export const REDACTED = '***REDACTED***'

/** key 名稱看起來像祕密 → 字串值遮罩（含自訂 HTTP 工具 header 憑證） */
const SECRET_KEY_PATTERN = /(apikey|api_key|token|secret|password|credential|authorization|cookie)/i
/** 例外：名字帶 token 但非祕密的 metadata 欄位 */
const SAFE_KEY_PATTERN = /^(tokenType|tokenHint|maxTokens|toolSearchThreshold)$/i

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) && !SAFE_KEY_PATTERN.test(key)
}

function redactValue(value: unknown, keyPath: string, key: string, out: string[]): unknown {
  if (typeof value === 'string') {
    if (value.length > 0 && isSecretKey(key)) {
      out.push(keyPath)
      return REDACTED
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => redactValue(item, `${keyPath}[${i}]`, key, out))
  }
  if (value && typeof value === 'object') {
    const secretContainer = isSecretKey(key)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        // 祕密容器（如 customToolSecrets）內的字串值全部遮罩，無論子 key 名稱
        if (secretContainer && typeof v === 'string' && v.length > 0) {
          out.push(`${keyPath}.${k}`)
          return [k, REDACTED]
        }
        return [k, redactValue(v, keyPath ? `${keyPath}.${k}` : k, k, out)]
      }),
    )
  }
  return value
}

/** 回傳遮罩後的設定與被遮罩的欄位路徑（供 UI 顯示 / 稽核）。 */
export function redactSettingsForExport<T extends Record<string, unknown>>(
  settings: T,
): { settings: T; redactedFields: string[] } {
  const redactedFields: string[] = []
  const out = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      redactValue(value, key, key, redactedFields),
    ]),
  ) as T
  // redactedFields 只留頂層路徑第一段的去重清單順序穩定
  return { settings: out, redactedFields: [...new Set(redactedFields.map((p) => p.split(/[.[]/)[0]))] }
}

/** 匯出前向使用者說明內容敏感性（明確同意用）。 */
export function bundleSensitivityNotice(): string {
  return (
    'API 金鑰與各類 token / secret 會自動遮罩（匯入後需重新輸入）。' +
    '但匯出檔仍包含：排程與事件定義（可能含提示詞、URL、路徑）、' +
    'Hermes 技能、Host canonical 記憶（plaintext user data，未加密，可能含過往任務的敏感內容）、' +
    '以及模型端點設定。' +
      '請確認要匯出並自行妥善保管此檔案。'
  )
}
