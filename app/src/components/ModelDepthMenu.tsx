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
import { filterModelChoices } from './modelMenuSearch'

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
  const [modelQuery, setModelQuery] = useState('')
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

  const filteredModelList = useMemo(
    () => filterModelChoices(modelList, modelQuery),
    [modelList, modelQuery],
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
    if (!open || panel !== 'model') return
    setModelQuery('')
  }, [open, panel])

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
        className={`inline-flex h-7 max-w-[220px] items-center gap-1 rounded-control px-2 text-[11px] transition-colors ${
          open
            ? 'bg-hover-2 text-on-surface'
            : 'text-on-surface-variant hover:bg-hover-2 hover:text-on-surface'
        }`}
        title="模型與推理強度"
      >
        <span className="truncate font-medium text-on-surface">{pillLabel}</span>
        <Icon name="expand_more" size={14} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-[90] flex items-end gap-1">
          {panel === 'depth' && (
            <div className="w-48 rounded-card border border-line bg-surface-container shadow-raised py-1 overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-ink-3 font-medium">推理程度</div>
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
                      active ? 'bg-hover text-ink' : 'text-ink-2 hover:bg-hover-2'
                    }`}
                  >
                    <span>
                      {d.label}
                      {d.costNote && (
                        <span className="block text-[10px] text-ink-3 mt-0.5">{d.costNote}</span>
                      )}
                    </span>
                    {active && <Icon name="check" size={16} className="text-ink shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

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
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && modelQuery.trim()) {
                      const exact = modelList.find((item) =>
                        item.id.toLocaleLowerCase() === modelQuery.trim().toLocaleLowerCase(),
                      )
                      onModelChange(exact?.id || modelQuery.trim())
                      setPanel('root')
                    }
                  }}
                  placeholder="搜尋模型或輸入 model id"
                  className="w-full bg-inset border border-line rounded-control px-2 py-1.5 text-[12px] text-ink font-[family-name:var(--font-mono)] outline-none focus:border-line-strong"
                />
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1">
                {!modelList.length ? (
                  <p className="px-3 py-3 text-[11px] text-ink-3 leading-relaxed">
                    尚無已授權 CLI 的模型清單。請到「設定 → CLI 授權」啟用本機 CLI，或直接在上方輸入 model id。
                  </p>
                ) : !filteredModelList.length ? (
                  <p className="px-3 py-3 text-[11px] text-ink-3 leading-relaxed">
                    找不到符合「{modelQuery.trim()}」的模型；可按下方按鈕直接使用此 model id。
                  </p>
                ) : (
                  filteredModelList.map((m) => {
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
                aria-label="套用"
                className="mx-2 mb-2 mt-1 py-1.5 rounded-control border border-line bg-hover text-[12px] text-ink font-medium hover:bg-hover-2"
                disabled={!modelQuery.trim()}
                onClick={() => {
                  onModelChange(modelQuery.trim())
                  setPanel('root')
                }}
              >
                {modelQuery.trim() ? `使用「${modelQuery.trim()}」` : '輸入自訂 model id'}
              </button>
            </div>
          )}

          {panel === 'speed' && (
            <div className="w-44 rounded-card border border-line bg-surface-container shadow-raised py-1 overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-ink-3 font-medium">速度</div>
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
                      active ? 'bg-hover text-ink' : 'text-ink-2 hover:bg-hover-2'
                    }`}
                  >
                    <span>
                      {s.label}
                      <span className="block text-[10px] text-ink-3 mt-0.5">{s.description}</span>
                    </span>
                    {active && <Icon name="check" size={16} />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="w-56 rounded-card border border-line bg-surface-container shadow-raised py-1 overflow-hidden">
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
            <div className="mx-2 my-1 border-t border-line" />
            <p className="px-3 py-2 text-[10px] text-ink-3 leading-snug">
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
