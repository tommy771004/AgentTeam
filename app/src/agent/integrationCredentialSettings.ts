import { legacyIntegrationCredentials, withoutIntegrationCredentials } from './integrationCredentials.ts'

export const INTEGRATION_SETTINGS_KEY = 'subagents.settings.v1'

/** This ingress is the only renderer code allowed to forward old persisted values. */
export async function migrateLocalIntegrationSettings(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  migrate?: (legacy: Record<string, string>) => Promise<{ ok: boolean; error?: string }>,
): Promise<void> {
  const raw = storage.getItem(INTEGRATION_SETTINGS_KEY)
  if (!raw) return
  let original: unknown
  try { original = JSON.parse(raw) }
  catch { throw new Error('舊設定格式無法讀取，原始資料已保留。') }
  const legacy = legacyIntegrationCredentials(original)
  if (Object.keys(legacy).length) {
    if (!migrate) throw new Error('憑證遷移需要桌面版安全儲存；原始資料已保留。')
    const result = await migrate(legacy)
    if (!result.ok) throw new Error(result.error || '憑證遷移失敗，原始資料已保留。')
  }
  storage.setItem(INTEGRATION_SETTINGS_KEY, JSON.stringify(withoutIntegrationCredentials(original)))
}
