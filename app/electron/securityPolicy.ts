/**
 * Issue 06 — runtime boundary policy（純函式，main.ts / vite build / smoke 共用）。
 * 決策集中在這裡：CSP、外開 URL、導覽 allowlist、權限請求、secrets 明文落地。
 * 不 import electron，讓 smoke-security.mts 可直接以 node 驗證。
 */

/**
 * 打包 renderer 的 CSP（build 時注入 dist/index.html 的 meta）。
 * inlineScriptHashes：vite build 產出的 file: module-loader 內聯 shim 以
 * 'sha256-…' hash 放行（見 vite.config fileProtocolModulePlugin），不開 unsafe-inline。
 */
export function buildRendererCsp(opts?: { inlineScriptHashes?: string[] }): string {
  const scriptSrc = ["'self'", ...(opts?.inlineScriptHashes || [])].join(' ')
  return [
    // 預設鎖 'self'；下面逐項放寬到最小需求
    "default-src 'self'",
    // 只允許 app bundle 內的 script + 具名 hash 的內聯 shim — 阻擋遠端載入與注入（含 eval）
    `script-src ${scriptSrc}`,
    // Tailwind / React 內聯樣式 + Google Fonts stylesheet（index.html 現況）
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com data:',
    // 附件預覽 / favicon / 產生的圖
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    // 使用者自訂 LLM 端點 / 本機 Ollama / MCP HTTP / webhook 測試 → 無法列舉主機，
    // 以 scheme 級允許；script-src 'self' 已擋住程式碼注入面
    'connect-src https: http: ws: wss:',
    // CodeMode 於 Blob Web Worker 執行模型撰寫的 JS
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ')
}

/** shell.openExternal 僅允許的 scheme（file:/javascript:/自訂 scheme 一律拒絕）。 */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export function isSafeExternalUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * will-navigate allowlist：dev server 同源，或打包後 app 自己的 index.html。
 * appIndexFileUrl 給定時 file: 只允許該頁（擋掉導向任意本機 HTML 後
 * 帶著 preload 權能載入的路徑）；未給定（純瀏覽器模式）才退回允許 file:。
 */
export function isAllowedNavigationUrl(
  url: string,
  opts: { devServerUrl?: string; appIndexFileUrl?: string },
): boolean {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  if (target.protocol === 'file:') {
    if (!opts.appIndexFileUrl) return true
    try {
      const allowed = new URL(opts.appIndexFileUrl)
      // Windows 路徑大小寫不敏感；hash（#/route）不影響比對
      return target.pathname.toLowerCase() === allowed.pathname.toLowerCase()
    } catch {
      return false
    }
  }
  if (opts.devServerUrl) {
    try {
      return target.origin === new URL(opts.devServerUrl).origin
    } catch {
      return false
    }
  }
  return false
}

/** setPermissionRequestHandler：deny-by-default 白名單。 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications', 'fullscreen'])

export function decidePermissionRequest(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission)
}

export type SecretPersistenceDecision =
  | { mode: 'encrypted' }
  | { mode: 'plaintext' }
  | { mode: 'refuse'; code: 'PLAINTEXT_REQUIRED'; reason: string }

/**
 * secrets 落地決策：OS 鑰匙圈不可用時預設「拒絕」，只有呼叫端帶明確同意
 * （使用者確認過的 allowPlaintext）才允許明文檔案；可加密時永遠加密。
 */
export function decideSecretPersistence(input: {
  encryptionAvailable: boolean
  allowPlaintext?: boolean
}): SecretPersistenceDecision {
  if (input.encryptionAvailable) return { mode: 'encrypted' }
  if (input.allowPlaintext) return { mode: 'plaintext' }
  return {
    mode: 'refuse',
    code: 'PLAINTEXT_REQUIRED',
    reason:
      'OS 安全儲存（keychain / DPAPI / libsecret）不可用；未經明確同意不落地明文憑證',
  }
}
