import { useEffect, useState } from 'react'

type PiHostState = 'stopped' | 'starting' | 'ready' | 'crashed' | 'error'

export function PiHostStatusPill({ collapsed = false }: { collapsed?: boolean }) {
  const [state, setState] = useState<PiHostState>('starting')

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

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] text-outline border border-white/8 bg-white/[0.03]"
      title={label}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone}`} />
      {!collapsed && <span className="truncate">{label}</span>}
    </div>
  )
}
