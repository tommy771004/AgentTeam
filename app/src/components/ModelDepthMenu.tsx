import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  SPEED_MODES,
  THINKING_DEPTHS,
  getSpeedMode,
  getThinkingDepth,
  type SpeedMode,
  type ThinkingDepth,
} from '../agent/thinking'
import {
  depthsForModel,
  modelsFromCliProviders,
} from '../agent/cliProviders'
import type { CliProviderConfig } from '../agent/types'

type Panel = 'root' | 'model' | 'depth' | 'speed'

/**
 * 附圖風格：右下角 pill「模型 推理強度」巢狀選單
 * 模型列表來自已啟用+授權的 CLI
 */
export function ModelDepthMenu({
  model,
  depth,
  speed = 'standard',
  globalModel,
  cliProviders,
  onModelChange,
  onDepthChange,
  onSpeedChange,
}: {
  model: string
  depth: ThinkingDepth
  speed?: SpeedMode
  globalModel: string
  cliProviders?: CliProviderConfig[]
  onModelChange: (m: string) => void
  onDepthChange: (d: ThinkingDepth) => void
  onSpeedChange?: (s: SpeedMode) => void
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

  const allowedDepths = useMemo(() => {
    const mid = model.trim() || globalModel
    if (!cliProviders?.length || !dynamicModels.length) {
      return THINKING_DEPTHS
    }
    const ids = depthsForModel(cliProviders, mid)
    return THINKING_DEPTHS.filter((d) => ids.includes(d.id))
  }, [cliProviders, dynamicModels.length, model, globalModel])

  const effective = (model.trim() || globalModel || '模型').slice(0, 28)
  const depthDef = getThinkingDepth(depth)
  const speedDef = getSpeedMode(speed)
  const pillLabel = `${effective.length > 14 ? effective.slice(0, 12) + '…' : effective} ${depthDef.label}`

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

  // 若目前深度不在允許列表，提示仍可顯示
  useEffect(() => {
    if (!allowedDepths.some((d) => d.id === depth) && allowedDepths[0]) {
      onDepthChange(allowedDepths[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, allowedDepths.map((d) => d.id).join(',')])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setPanel('root')
        }}
        className="inline-flex items-center gap-1 max-w-[220px] px-2.5 py-1 rounded-full border border-white/12 bg-surface-container/90 hover:bg-white/[0.06] text-[11px] text-on-surface-variant transition-colors"
        title="模型與推理強度"
      >
        <span className="truncate font-medium text-on-surface">{pillLabel}</span>
        <Icon name="expand_more" size={14} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-[90] flex items-end gap-1">
          {panel === 'depth' && (
            <div className="w-48 rounded-xl border border-white/12 bg-[#1c1c1e]/95 backdrop-blur-xl shadow-2xl py-1 overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-white/50 font-medium">推理程度</div>
              {allowedDepths.map((d) => {
                const active = depth === d.id
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      onDepthChange(d.id)
                      setPanel('root')
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-[13px] ${
                      active ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span>
                      {d.label}
                      {d.costNote && (
                        <span className="block text-[10px] text-white/40 mt-0.5">{d.costNote}</span>
                      )}
                    </span>
                    {active && <Icon name="check" size={16} className="text-white shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {panel === 'model' && (
            <div className="w-64 rounded-xl border border-white/12 bg-[#1c1c1e]/95 backdrop-blur-xl shadow-2xl py-1 overflow-hidden max-h-80 flex flex-col">
              <div className="px-3 py-2 text-[11px] text-white/50 font-medium">
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
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-white font-[family-name:var(--font-mono)] outline-none focus:border-white/25"
                />
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1">
                {!modelList.length ? (
                  <p className="px-3 py-3 text-[11px] text-white/40 leading-relaxed">
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
                          active ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-[12px] font-[family-name:var(--font-mono)] truncate">
                            {m.label}
                          </span>
                          <span className="block text-[10px] text-white/40">{m.hint}</span>
                        </span>
                        {active && <Icon name="check" size={16} className="shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
              <button
                type="button"
                className="mx-2 mb-2 mt-1 py-1.5 rounded-lg bg-white/10 text-[12px] text-white font-medium hover:bg-white/15"
                onClick={() => {
                  onModelChange(customModel.trim())
                  setPanel('root')
                }}
              >
                套用
              </button>
            </div>
          )}

          {panel === 'speed' && (
            <div className="w-44 rounded-xl border border-white/12 bg-[#1c1c1e]/95 backdrop-blur-xl shadow-2xl py-1 overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-white/50 font-medium">速度</div>
              {SPEED_MODES.map((s) => {
                const active = speed === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onSpeedChange?.(s.id)
                      setPanel('root')
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-[13px] ${
                      active ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span>
                      {s.label}
                      <span className="block text-[10px] text-white/40 mt-0.5">{s.description}</span>
                    </span>
                    {active && <Icon name="check" size={16} />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="w-56 rounded-xl border border-white/12 bg-[#1c1c1e]/95 backdrop-blur-xl shadow-2xl py-1 overflow-hidden">
            <MenuRow
              label="模型"
              value={effective}
              onClick={() => setPanel(panel === 'model' ? 'root' : 'model')}
            />
            <MenuRow
              label="推理強度"
              value={depthDef.label}
              active={panel === 'depth'}
              onClick={() => setPanel(panel === 'depth' ? 'root' : 'depth')}
            />
            <MenuRow
              label="速度"
              value={speedDef.label}
              onClick={() => setPanel(panel === 'speed' ? 'root' : 'speed')}
            />
            <div className="mx-2 my-1 border-t border-white/10" />
            <p className="px-3 py-2 text-[10px] text-white/30 leading-snug">
              模型來自「設定 → CLI 授權」已啟用項目
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
        active ? 'bg-white/10' : 'hover:bg-white/[0.06]'
      }`}
    >
      <span className="text-white/90">{label}</span>
      <span className="flex items-center gap-1 text-white/45 text-[12px] min-w-0">
        <span className="truncate max-w-[100px]">{value}</span>
        <Icon name="chevron_right" size={16} className="shrink-0 opacity-60" />
      </span>
    </button>
  )
}
