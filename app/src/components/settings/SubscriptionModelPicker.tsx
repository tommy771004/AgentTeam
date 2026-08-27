import type { ApiProviderPreset } from '../../agent/types'
import { subscriptionCacheBadge, useSubscriptionCatalog } from '../../hooks/useSubscriptionCatalog'

/**
 * Fail-closed model picker for CLI-subscription
 * connections. The list comes ONLY from the Host snapshot's projected catalog
 * (`config.subscriptionCatalog`); this component never uses the OpenAI-
 * compatible /models discovery path and never judges availability itself — it
 * relays the projection's verdict and reason verbatim.
 *
 * The selected model id travels EXACTLY as listed: no trimming, no case
 * folding, no rewriting of any kind. `piCoreRuntime.getModel(provider, model)`
 * must be able to resolve what the user picked without this layer
 * second-guessing it.
 */

type Props = {
  providerId: ApiProviderPreset
  value: string
  onChange: (modelId: string) => void
}

export function SubscriptionModelPicker({ providerId, value, onChange }: Props) {
  const { catalog, stale, cachedAt, loadFailed } = useSubscriptionCatalog()

  if (loadFailed) {
    return (
      <>
        <select disabled className="w-full rounded border border-outline/30 bg-transparent px-2 py-1.5 text-sm opacity-60">
          <option>無法讀取訂閱目錄（Pi Core Host 未就緒）</option>
        </select>
      </>
    )
  }
  if (!catalog) {
    return (
      <select disabled className="w-full rounded border border-outline/30 bg-transparent px-2 py-1.5 text-sm opacity-60">
        <option>載入中…</option>
      </select>
    )
  }

  const row = catalog.find((entry) => entry.id === providerId)

  // Unknown provider id (should not happen): fail closed rather than guess.
  if (!row) {
    return (
      <select disabled className="w-full rounded border border-outline/30 bg-transparent px-2 py-1.5 text-sm opacity-60">
        <option>此訂閱 provider 不在目錄中</option>
      </select>
    )
  }

  if (row.availability === 'available' && row.models.length > 0) {
    const known = row.models.some((model) => model.id === value)
    return (
      <div className="flex flex-col gap-1">
        {stale ? (
          <p className="text-[11px] text-amber-300">⚠︎ {subscriptionCacheBadge(cachedAt)}——清單可能不是最新。</p>
        ) : null}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-outline/30 bg-transparent px-2 py-1.5 text-sm"
        >
          {!value && <option value="">選擇模型…</option>}
          {/* A stored id outside the catalog stays visible, honestly marked;
              picking any listed option writes its id verbatim. */}
          {!known && value && <option value={value}>⚠︎ {value}（不在目前目錄）</option>}
          {row.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label || model.id}
              {typeof model.contextWindow === 'number' ? ` · ${Math.round(model.contextWindow / 1000)}k ctx` : ''}
              {model.reasoning === true ? ' · reasoning' : ''}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-outline">
          共 {row.modelTotal} 個模型{row.modelTotal > row.models.length ? `，顯示前 ${row.models.length} 個` : ''}。
        </p>
      </div>
    )
  }

  const conflict = row.availability === 'conflict'
  return (
    <div className="flex flex-col gap-1">
      <select disabled className="w-full rounded border border-outline/30 bg-transparent px-2 py-1.5 text-sm opacity-60">
        <option>{conflict ? '帳號衝突，暫不可選' : '訂閱無法使用'}</option>
      </select>
      <p className={`text-[11px] ${conflict ? 'text-amber-300' : 'text-outline'}`}>
        {row.reason}
        {conflict && ' 請在對應 CLI 登出其他帳號、只保留一個帳號後重新登入。'}
      </p>
    </div>
  )
}
