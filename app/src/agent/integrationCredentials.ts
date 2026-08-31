/** Migration-only legacy keys; runtime consumers use the stable main-owned references. */
export const INTEGRATION_CREDENTIALS = [
  { kind: 'telegram', field: 'telegramBotToken', ref: 'credential:telegram:primary' },
  { kind: 'webhook', field: 'webhookToken', ref: 'credential:webhook:primary' },
] as const

export const LEGACY_CREDENTIAL_FIELDS = [...INTEGRATION_CREDENTIALS.map(({ field }) => field), 'customToolSecrets', 'encryptedCustomToolSecrets']

export function withoutIntegrationCredentials<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const safe = { ...value } as Record<string, unknown>
  for (const field of LEGACY_CREDENTIAL_FIELDS) delete safe[field]
  return safe as T
}

export function legacyIntegrationCredentials(value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(LEGACY_CREDENTIAL_FIELDS.flatMap((field): [string, unknown][] => {
    const raw = source[field]
    if (field === 'customToolSecrets' && raw && typeof raw === 'object') return [[field, raw]]
    return typeof raw === 'string' && raw.trim() && raw !== '***REDACTED***' ? [[field, raw]] : []
  }))
}
