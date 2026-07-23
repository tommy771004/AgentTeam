import { useEffect, useState } from 'react'
import { usePiHostEventStore } from '../store/piHostEventStore'

type PiHostState = 'stopped' | 'starting' | 'ready' | 'crashed' | 'error'

export function PiHostStatusPill({ collapsed = false }: { collapsed?: boolean }) {
  const [state, setState] = useState<PiHostState>('starting')
  const latestToolEvent = usePiHostEventStore((store) => store.events.filter((event) => event.event.startsWith('host/tool-')).at(-1))

  useEffect(() => {
    let active = true
    const refresh = async () => {
      const next = await window.subagents?.piHost.status().catch(() => ({ state: 'error' as const }))
      if (active && next) setState(next.state)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const tone = state === 'ready' ? 'bg-emerald-400' : state === 'starting' ? 'bg-amber-400' : 'bg-rose-400'
  const label = state === 'ready' ? 'Pi Core 已連線' : state === 'starting' ? 'Pi Core 啟動中' : 'Pi Core 未連線'
  const toolHint = latestToolEvent?.payload.tool
    ? ` · ${latestToolEvent.payload.tool}${latestToolEvent.payload.settlement ? ` ${latestToolEvent.payload.settlement}` : ''}`
    : ''

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] text-outline border border-white/8 bg-white/[0.03]"
      title={`${label}${toolHint}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone}`} />
      {!collapsed && <span className="truncate">{label}{toolHint}</span>}
    </div>
  )
}
