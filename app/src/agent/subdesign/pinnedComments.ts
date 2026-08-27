/**
 * Element-pinned comments：使用者在 sandboxed 預覽上「指著說」的回饋。
 * Host 端唯讀 script 產生 selector + 文字，payload 在此 fail-closed 驗證後，
 * 編譯成單次 runTask 迭代的結構化輸入。iframe 內容不可信——這裡是信任邊界。
 */
export type SubDesignPinnedComment = {
  /** Host 端計算的 CSS-ish selector 路徑（唯讀 script 產生，非頁面提供）。 */
  selector: string
  /** 使用者留言。 */
  text: string
  /** 點點擊座標（預覽座標系），供 UI 標記與 scope 提示。 */
  region?: { x: number; y: number; w?: number; h?: number }
}

const MAX_PINS = 12
const SELECTOR_PATTERN = /^[a-zA-Z][a-zA-Z0-9.#>:\-.\s[\]='"]{0,600}$/

export type PinnedCommentParseResult =
  | { ok: true; pins: SubDesignPinnedComment[] }
  | { ok: false; errors: string[] }

export function parsePinnedCommentPayload(payload: unknown): PinnedCommentParseResult {
  const errors: string[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['pinned comment payload 必須是 object。'] }
  }
  const raw = payload as Record<string, unknown>
  if (!Array.isArray(raw.pins)) return { ok: false, errors: ['pins 必須是陣列。'] }
  if (raw.pins.length === 0) return { ok: false, errors: ['至少需要一個 pin。'] }
  if (raw.pins.length > MAX_PINS) return { ok: false, errors: [`pin 數量上限為 ${MAX_PINS}。`] }
  const pins: SubDesignPinnedComment[] = []
  raw.pins.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`pin[${index}] 必須是 object。`)
      return
    }
    const record = item as Record<string, unknown>
    const selector = String(record.selector || '').trim().replaceAll('\\', '/')
    const text = String(record.text || '').trim().slice(0, 1000)
    if (!selector || !SELECTOR_PATTERN.test(selector)) {
      errors.push(`pin[${index}].selector 不合法。`)
      return
    }
    if (!text) {
      errors.push(`pin[${index}].text 不可為空。`)
      return
    }
    let region: SubDesignPinnedComment['region']
    if (record.region && typeof record.region === 'object') {
      const rawRegion = record.region as Record<string, unknown>
      const x = Number(rawRegion.x)
      const y = Number(rawRegion.y)
      if (Number.isFinite(x) && Number.isFinite(y)) {
        region = { x: Math.round(x), y: Math.round(y) }
      }
    }
    pins.push({ selector, text, ...(region ? { region } : {}) })
  })
  if (errors.length || !pins.length) return { ok: false, errors: errors.length ? errors : ['沒有有效的 pin。'] }
  return { ok: true, pins }
}

/**
 * 把 pins 編譯成 agent 可執行的結構化 context。明確告訴 agent：
 * 只修正 pin 指到的元素，不做全域改寫。
 */
export function buildPinnedCommentContext(
  artifact: { id: string; title?: string; revision: number },
  pins: SubDesignPinnedComment[],
  scopeId?: string,
): string {
  const lines = [
    '## 使用者指定的 scoped 修正（element-pinned comments）',
    `artifact：${artifact.id}（revision ${artifact.revision}${artifact.title ? ` · ${artifact.title}` : ''}）`,
    ...(scopeId ? [`Host patch scope：${scopeId}（呼叫 design_artifact_patch 時必須原樣傳入 scopeId）`] : []),
    '請只修改下列 pin 對應的元素與其直接樣式；不要重排、重構或改動其他區域。',
    '',
    ...pins.map((pin, index) => {
      const region = pin.region ? `（座標 ${pin.region.x},${pin.region.y}）` : ''
      return `${index + 1}. selector：\`${pin.selector}\`${region}\n   使用者回饋：${pin.text}`
    }),
    '',
    '請以 design_artifact_patch 套用 exact replacements；Host 會驗證 scope 並遞增 revision。完成後說明每個 pin 的修正內容。',
  ]
  return lines.join('\n')
}

/** 稽核記錄：回答「這裡為什麼變了」。 */
export type SubDesignPinnedCommentAuditRecord = {
  id: string
  artifactId: string
  revision: number
  briefId?: string
  runId?: string
  createdAt: string
  pins: SubDesignPinnedComment[]
}
