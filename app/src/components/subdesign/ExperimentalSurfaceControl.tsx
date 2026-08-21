import { useEffect, useState } from 'react'
import { Icon } from '../Icon.tsx'
import { providerFlagDescription } from '../../agent/subdesign/providers/providerFlags.ts'
import type { ExperimentalSurfaceSettings } from '../../agent/subdesign/providers/providerSettings.ts'

/**
 * Support and degradation scope for the experimental in-product surfaces
 * (issue 09: MCP Apps host support must be user-visible, not buried in a doc).
 *
 * Both ship off. Turning one on is per-project and persisted like every other
 * provider setting — there is no second gate and no config file to hand-edit.
 */
export function ExperimentalSurfaceControl({
  settings,
  disabled,
  onSave,
}: {
  settings: ExperimentalSurfaceSettings
  disabled?: boolean
  onSave: (value: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>) => Promise<{ ok: boolean; reason?: string }>
}) {
  const [mcpApps, setMcpApps] = useState(settings.mcpApps)
  const [streaming, setStreaming] = useState(settings.streaming)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setMcpApps(settings.mcpApps)
    setStreaming(settings.streaming)
  }, [settings.mcpApps, settings.streaming])

  const enabledCount = Number(settings.mcpApps) + Number(settings.streaming)

  const save = async (next: Pick<ExperimentalSurfaceSettings, 'mcpApps' | 'streaming'>) => {
    setSaving(true)
    setMessage('')
    const result = await onSave(next)
    setSaving(false)
    setMessage(result.ok ? '已儲存至 project。下次 run 生效。' : result.reason || '儲存失敗。')
  }

  return (
    <details className="group relative shrink-0">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-medium text-outline transition-colors hover:bg-white/[0.045] hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60">
        <Icon name="science" size={14} />
        <span className="hidden sm:inline">實驗性介面</span>
        <span className={enabledCount ? 'text-primary' : 'text-outline/65'}>
          {enabledCount ? `${enabledCount} 已啟用` : 'Off'}
        </span>
        <Icon name="expand_more" size={12} className="transition-transform group-open:rotate-180" />
      </summary>
      <section
        className="absolute right-0 top-10 z-30 w-[340px] rounded-xl border border-white/[0.09] bg-surface-container-high p-4"
        aria-label="Experimental surface settings"
      >
        <p className="text-[11px] font-semibold text-on-surface">實驗性介面支援範圍</p>
        <p className="mt-1 text-[10px] leading-relaxed text-on-surface-variant">
          兩項預設關閉。關閉時各自的備援路徑完整可用：MCP Apps 退回原生選擇／表單，streaming 改為完成後預覽。
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <ExperimentalToggle
            label="MCP Apps 互動表面"
            description={providerFlagDescription('mcp-apps')}
            checked={mcpApps}
            disabled={disabled || saving}
            onChange={(value) => {
              setMcpApps(value)
              void save({ mcpApps: value, streaming })
            }}
          />
          <ExperimentalToggle
            label="Streaming artifact"
            description={providerFlagDescription('streaming')}
            checked={streaming}
            disabled={disabled || saving}
            onChange={(value) => {
              setStreaming(value)
              void save({ mcpApps, streaming: value })
            }}
          />
        </div>

        {message ? (
          <p className="mt-3 text-[10px] leading-relaxed text-on-surface-variant" role="status">{message}</p>
        ) : null}
      </section>
    </details>
  )
}

function ExperimentalToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold text-on-surface">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-on-surface-variant">{description}</span>
      </span>
    </label>
  )
}
