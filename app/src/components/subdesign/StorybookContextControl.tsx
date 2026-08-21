import { useEffect, useState } from 'react'
import type { SubDesignPluginExecutionProjection } from '../../agent/subdesign/pluginExecution.ts'
import {
  validateStorybookProviderEndpoint,
  type StorybookProviderSettings,
} from '../../agent/subdesign/providers/providerSettings.ts'
import { Icon } from '../Icon.tsx'

type StorybookContextControlProps = {
  settings: StorybookProviderSettings
  latestRun: SubDesignPluginExecutionProjection | null
  disabled?: boolean
  onSave: (value: Pick<StorybookProviderSettings, 'enabled' | 'endpoint'>) => Promise<{ ok: boolean; reason?: string }>
}

function statusText(settings: StorybookProviderSettings, run: SubDesignPluginExecutionProjection | null): string {
  if (!settings.enabled) return 'Off'
  if (!run) return 'Ready'
  if (run.context) return `${run.context.components.length} components`
  if (run.state === 'blocked') return 'Fallback'
  return run.state
}

export function StorybookContextControl({ settings, latestRun, disabled, onSave }: StorybookContextControlProps) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [endpoint, setEndpoint] = useState(settings.endpoint)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setEnabled(settings.enabled)
    setEndpoint(settings.endpoint)
  }, [settings.enabled, settings.endpoint])

  const save = async () => {
    const validation = validateStorybookProviderEndpoint(endpoint)
    if (validation) {
      setMessage(validation)
      return
    }
    setSaving(true)
    setMessage('')
    const result = await onSave({ enabled, endpoint })
    setSaving(false)
    setMessage(result.ok ? '已儲存至 project。下次 run 生效。' : result.reason || '儲存失敗。')
  }

  return (
    <details className="group relative shrink-0">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-medium text-outline transition-colors hover:bg-white/[0.045] hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60">
        <Icon name="account_tree" size={14} />
        <span className="hidden sm:inline">Storybook</span>
        <span className={settings.enabled ? 'text-primary' : 'text-outline/65'}>{statusText(settings, latestRun)}</span>
        <Icon name="expand_more" size={12} className="transition-transform group-open:rotate-180" />
      </summary>
      <section className="absolute right-0 top-10 z-30 w-[320px] rounded-xl border border-white/[0.09] bg-surface-container-high p-4" aria-label="Storybook context settings">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold text-on-surface">Project component context</p>
            <p className="mt-1 text-[10px] leading-relaxed text-on-surface-variant">Pinned 8.6.0，只讀取 localhost metadata。關閉時不會連線。</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[10px] text-on-surface">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled || saving}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            啟用
          </label>
        </div>
        <label className="mt-4 block text-[10px] font-medium text-on-surface-variant">
          Storybook endpoint
          <input
            type="url"
            value={endpoint}
            disabled={disabled || saving}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="http://127.0.0.1:6006"
            className="mt-1.5 h-9 w-full rounded-lg bg-background/55 px-3 text-[10px] text-on-surface outline-none ring-1 ring-white/[0.08] focus:ring-primary/55 disabled:opacity-50"
          />
        </label>
        {latestRun ? (
          <p className="mt-3 text-[10px] leading-relaxed text-on-surface-variant" title={latestRun.summary}>
            Last run: {latestRun.context?.summary || latestRun.summary}
          </p>
        ) : null}
        {message ? <p className="mt-3 text-[10px] leading-relaxed text-on-surface-variant" aria-live="polite">{message}</p> : null}
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => void save()}
          className="mt-4 h-9 w-full rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? '儲存中…' : '儲存設定'}
        </button>
      </section>
    </details>
  )
}
