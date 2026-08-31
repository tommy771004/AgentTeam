import { useEffect, useState } from 'react'
import type { CredentialVaultMetadata } from '../../electron/credentialVaultAuthority'

/** Secret input is an ephemeral write intent, never a settings value or a readback. */
export function IntegrationCredentialField({ kind, disabled, onChanged }: {
  kind: 'telegram' | 'webhook'
  disabled?: boolean
  onChanged: (configured: boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [metadata, setMetadata] = useState<CredentialVaultMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const ref = `credential:${kind}:primary` as const

  useEffect(() => {
    let cancelled = false
    setReady(false)
    const intent = window.subagents?.credentials?.intent
    if (!intent) { setError('憑證儲存僅支援桌面版'); return }
    void intent({ action: 'list' }).then((result) => {
      if (cancelled) return
      if (!result.ok) { setError(result.error); return }
      setMetadata(result.metadata.find((item) => item.ref === ref) || null)
      setError(result.availability.reason || null)
      setReady(result.availability.secureStorageAvailable)
    }).catch(() => { if (!cancelled) setError('無法讀取憑證狀態，請重試') })
    return () => { cancelled = true }
  }, [ref, disabled, refreshRevision])

  const submit = async (clear: boolean) => {
    const intent = window.subagents?.credentials?.intent
    if (!intent) return
    setBusy(true)
    setError(null)
    const secret = draft
    setDraft('')
    try {
      const result = await intent(clear
        ? { action: 'clear', ref }
        : metadata
          ? { action: 'rotate', ref, secret }
          : { action: 'store', kind, ownerId: 'primary', secret })
      if (!result.ok) { setError(result.error); return }
      setMetadata(result.metadata.find((item) => item.ref === ref) || null)
      await onChanged(result.metadata.some((item) => item.ref === ref))
    } catch { setError('憑證操作或連線更新失敗，請重試') }
    finally { setBusy(false) }
  }

  return <div className="space-y-2">
    <p className="text-[12px] text-on-surface-variant">{metadata ? `已設定 ${metadata.tokenHint}` : '尚未設定'} · Token 僅儲存於桌面安全 Vault</p>
    <input type="password" aria-label={kind === 'telegram' ? '新的 Telegram Bot Token' : '新的 Webhook Token'}
      className="w-full rounded-control border border-line bg-inset px-3 py-2 text-[13px]"
      autoComplete="new-password" value={draft} onChange={(event) => setDraft(event.target.value)}
      disabled={disabled || busy || !ready} placeholder="輸入新 Token；不會顯示既有值" />
    <div className="flex gap-3 text-[12px]">
      <button type="button" disabled={disabled || busy || !ready || !draft.trim()} onClick={() => void submit(false)}>{metadata ? '更新 Token' : '儲存 Token'}</button>
      <button type="button" disabled={disabled || busy || !ready || !metadata} onClick={() => void submit(true)}>清除 Token</button>
      <button type="button" disabled={disabled || busy} onClick={() => setRefreshRevision((revision) => revision + 1)}>重新整理狀態</button>
    </div>
    {error && <p role="alert" className="text-[12px] text-error">{error}</p>}
  </div>
}
