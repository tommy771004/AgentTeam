/** Return a credential-free loopback origin suitable for display/telemetry. */
export function safeOpenCodeServerOrigin(raw?: string): string | null {
  const value = (raw || '').trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return null
    return parsed.origin
  } catch {
    return null
  }
}
