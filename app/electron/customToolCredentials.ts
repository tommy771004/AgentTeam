/** Main-only resolution scope. Neither resolved inputs nor reflected credentials leave main. */
import { resolveSecretPlaceholders } from './secretsVault'
import { runBash } from './shellBridge'

export function createToolCredentialScope() {
  const secrets = new Set<string>()
  const resolve = (value: string): string => value.replace(/{{\s*secret:([A-Za-z0-9_.-]+)\s*}}/g, (placeholder) => {
    const result = resolveSecretPlaceholders(placeholder)
    if (result.missing.length) throw new Error('工具憑證尚未設定，請先在 Settings 或市集授權。')
    secrets.add(result.text)
    return result.text
  })
  const redact = (value: string): string => {
    let safe = value
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      for (const variant of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
        safe = safe.split(variant).join('[REDACTED]')
      }
    }
    return safe
  }
  const redactValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redact(value)
    if (typeof value === 'number' || typeof value === 'boolean') {
      const rendered = String(value)
      return redact(rendered) === rendered ? value : '[REDACTED]'
    }
    if (Array.isArray(value)) return value.map(redactValue)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactValue(item)]))
    return value
  }
  return { resolve, redact, redactValue, hasCredentials: () => secrets.size > 0 }
}

export async function credentialBash(input: { command: string; cwd?: string; timeoutMs?: number; runId?: string }) {
  const scope = createToolCredentialScope()
  try {
    const result = await runBash({ ...input, command: scope.resolve(input.command) })
    if (scope.hasCredentials() && result.outputTruncated) {
      return { ...result, stdout: '', stderr: '憑證工具輸出超過上限，已隱藏以避免密鑰片段洩漏。' }
    }
    return { ...result, stdout: scope.redact(result.stdout), stderr: scope.redact(result.stderr) }
  } catch {
    return { ok: false, code: 1, stdout: '', stderr: '工具執行失敗：請確認憑證與執行設定。' }
  }
}

export async function credentialHttpRequest(input: {
  url: string; method?: string; headers?: Record<string, string>; body?: string; maxChars?: number
}): Promise<{ ok: boolean; text: string; status: number }> {
  const scope = createToolCredentialScope()
  try {
    const url = new URL(scope.resolve(input.url))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs allowed')
    const headers = Object.fromEntries(Object.entries(input.headers || {}).map(([key, value]) => [key, scope.resolve(value)]))
    const body = input.body == null ? undefined : scope.resolve(input.body)
    // Do not forward credentials to a redirected destination.
    const response = await fetch(url, { method: input.method || 'GET', headers, body, redirect: 'error' })
    const text = scope.redact(await response.text()).slice(0, Math.min(Number(input.maxChars) || 50_000, 200_000))
    return { ok: response.ok, text, status: response.status }
  } catch {
    return { ok: false, text: '工具請求失敗：請確認憑證與連線設定。', status: 0 }
  }
}
