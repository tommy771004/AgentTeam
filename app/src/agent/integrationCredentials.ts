/** Migration-only legacy keys; runtime consumers use the stable main-owned references. */
export const INTEGRATION_CREDENTIALS = [
  { kind: 'telegram', field: 'telegramBotToken', ref: 'credential:telegram:primary' },
  { kind: 'webhook', field: 'webhookToken', ref: 'credential:webhook:primary' },
] as const

export function withoutIntegrationCredentials<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const safe = { ...value } as Record<string, unknown>
  for (const { field } of INTEGRATION_CREDENTIALS) delete safe[field]
  return safe as T
}

export function legacyIntegrationCredentials(value: unknown): Record<string, string> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(INTEGRATION_CREDENTIALS.flatMap(({ field }) => {
    const raw = source[field]
    return typeof raw === 'string' && raw.trim() && raw !== '***REDACTED***' ? [[field, raw]] : []
  }))
}
