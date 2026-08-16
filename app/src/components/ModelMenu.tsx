import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { modelsFromCliProviders } from '../agent/cliProviders'
import type { CliProviderConfig } from '../agent/types'

type Panel = 'root' | 'model'

/**
 * 右下角常駐的模型 pill。
 *
 * ticket 03 之後這裡只管模型：推理程度與速度屬於開發者級決策，已移入 composer
 * 的「進階」折疊區（ComposerAdvanced），兩邊不重複擺同一個控制。
 */
export function ModelMenu({
  model,
  globalModel,
  cliProviders,
  onModelChange,
}: {
  model: string
  globalModel: string
  cliProviders?: CliProviderConfig[]
  onModelChange: (m: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<Panel>('root')
  const [customModel, setCustomModel] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const dynamicModels = useMemo(
    () => modelsFromCliProviders(cliProviders),
    [cliProviders],
  )

  const modelList = useMemo(
    () =>
      dynamicModels.map((m) => ({
        id: m.id,
        label: m.label,
        hint: m.providerName,
      })),
    [dynamicModels],
  )

  const effective = (model.trim() || globalModel || '模型').slice(0, 28)
  const pillLabel = effective.length > 20 ? `${effective.slice(0, 18)}…` : effective

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setPanel('root')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (open) setCustomModel(model)
  }, [open, model])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setPanel('root')
        }}
        className="inline-flex items-center gap-1 max-w-[220px] px-2.5 py-1 rounded-control border border-line bg-surface-container hover:bg-hover-2 text-[11px] text-on-surface-variant transition-colors"
        title="模型"
      >
        <span className="truncate font-medium text-on-surface">{pillLabel}</span>
        <Icon name="expand_more" size={14} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-[90] flex items-end gap-1">
          {panel === 'model' && (
            <div className="w-64 rounded-card border border-line bg-surface-container shadow-raised py-1 overflow-hidden max-h-80 flex flex-col">
              <div className="px-3 py-2 text-[11px] text-ink-3 font-medium">
                模型
                {!dynamicModels.length && (
                  <span className="text-amber-400/80 ml-1">（請先在設定授權 CLI）</span>
                )}
              </div>
              <div className="px-2 pb-2">
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onModelChange(customModel.trim())
                      setPanel('root')
                    }
                  }}
                  placeholder={globalModel || '自訂 model id'}
                  className="w-full bg-inset border border-line rounded-control px-2 py-1.5 text-[12px] text-ink font-[family-name:var(--font-mono)] outline-none focus:border-line-strong"
                />
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1">
                {!modelList.length ? (
                  <p className="px-3 py-3 text-[11px] text-ink-3 leading-relaxed">
                    尚無已授權 CLI 的模型清單。請到「設定 → CLI 授權」啟用本機 CLI，或直接在上方輸入 model id。
                  </p>
                ) : (
                  modelList.map((m) => {
                    const active = (model || globalModel) === m.id
                    return (
                      <button
                        key={`${m.hint}-${m.id}`}
                        type="button"
                        onClick={() => {
                          onModelChange(m.id)
                          setPanel('root')
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left ${
                          active ? 'bg-hover text-ink' : 'text-ink-2 hover:bg-hover-2'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-[12px] font-[family-name:var(--font-mono)] truncate">
                            {m.label}
                          </span>
                          <span className="block text-[10px] text-ink-3">{m.hint}</span>
                        </span>
                        {active && <Icon name="check" size={16} className="shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
              <button
                type="button"
                className="mx-2 mb-2 mt-1 py-1.5 rounded-control border border-line bg-hover text-[12px] text-ink font-medium hover:bg-hover-2"
                onClick={() => {
                  onModelChange(customModel.trim())
                  setPanel('root')
                }}
              >
                套用
              </button>
            </div>
          )}

          <div className="w-56 rounded-card border border-line bg-surface-container shadow-raised py-1 overflow-hidden">
            <MenuRow
              label="模型"
              value={effective}
              onClick={() => setPanel(panel === 'model' ? 'root' : 'model')}
            />
            <div className="mx-2 my-1 border-t border-line" />
            <p className="px-3 py-2 text-[10px] text-ink-3 leading-snug">
              模型來自「設定 → CLI 授權」已啟用項目。推理程度與速度在輸入框的「進階」。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuRow({
  label,
  value,
  onClick,
  active,
}: {
  label: string
  value: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] ${
        active ? 'bg-hover' : 'hover:bg-hover-2'
      }`}
    >
      <span className="text-ink">{label}</span>
      <span className="flex items-center gap-1 text-ink-3 text-[12px] min-w-0">
        <span className="truncate max-w-[100px]">{value}</span>
        <Icon name="chevron_right" size={16} className="shrink-0 opacity-60" />
      </span>
    </button>
  )
}
