import type { SubscriptionProviderCatalog } from '../../agent/subscriptionCatalog'
import { subscriptionCacheBadge, useSubscriptionCatalog } from '../../hooks/useSubscriptionCatalog'

/**
 * ADR-0052 ticket 03 — sync-status summary for CLI-subscription connections.
 * Reads ONLY availability metadata from the Host snapshot config
 * (`config.subscriptionCatalog`) through the shared loader hook; raw tokens
 * never cross IPC and never reach this component. Rows relay the projection's
 * verdict verbatim — a conflict stays a conflict until the user resolves it in
 * the CLI.
 */

const PROVIDER_LABELS: Record<string, string> = {
  'openai-codex': 'Codex 訂閱',
  anthropic: 'Claude 訂閱',
}

const AVAILABILITY_LABELS: Record<SubscriptionProviderCatalog['availability'], string> = {
  available: '可用',
  unavailable: '無法使用',
  conflict: '帳號衝突',
}

const AVAILABILITY_STYLES: Record<SubscriptionProviderCatalog['availability'], string> = {
  available: 'bg-primary/15 text-primary',
  unavailable: 'bg-white/10 text-on-surface-variant',
  conflict: 'bg-amber-500/15 text-amber-300',
}

export function SubscriptionConnectionStatus() {
  const { catalog, stale, cachedAt, loadFailed, refresh } = useSubscriptionCatalog()

  if (loadFailed) {
    return (
      <div className="mt-1 flex flex-col items-start gap-1 text-[11px]">
        <p className="text-outline">無法讀取訂閱狀態（Pi Core Host 未就緒）。</p>
        <button type="button" onClick={refresh} className="agent-process-link">重新整理</button>
      </div>
    )
  }
  if (!catalog) return null

  return (
    <div className="mt-1 flex flex-col gap-1.5 text-[11px]">
      {catalog.map((entry) => (
        <div key={entry.id} className="flex items-start gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${AVAILABILITY_STYLES[entry.availability]}`}>
            {PROVIDER_LABELS[entry.id] || entry.id} · {AVAILABILITY_LABELS[entry.availability]}
          </span>
          <span className="min-w-0 flex-1 text-outline">
            {entry.availability === 'available'
              ? `${entry.modelTotal} 個模型${entry.modelTotal > entry.models.length ? `（顯示前 ${entry.models.length} 個）` : ''}`
              : entry.reason}
            {entry.availability === 'conflict' ? (
              <>
                {' '}請在對應 CLI 登出其他帳號後，
                <button type="button" onClick={refresh} className="ml-0.5 underline underline-offset-2 hover:text-ink">重新整理</button>
                以確認。
              </>
            ) : null}
          </span>
        </div>
      ))}
      {stale ? (
        <p className="text-amber-300">⚠︎ {subscriptionCacheBadge(cachedAt)}——此清單非本次啟動的即時結果。</p>
      ) : null}
      <p className="text-outline">
        訂閱連線以「Pi loop + 訂閱模型」執行；受該服務的訂閱條款與限流約束。
      </p>
    </div>
  )
}
