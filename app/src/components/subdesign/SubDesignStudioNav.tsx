import { Icon } from '../Icon'

type SubDesignStudioNavProps = {
  active: 'studio' | 'systems'
  studioHref?: string
  systemsHref?: string
  contextLabel?: string
  onNavigate: (href: string) => void
}

export function SubDesignStudioNav({
  active,
  studioHref = '/subdesign',
  systemsHref = '/design-systems',
  contextLabel,
  onNavigate,
}: SubDesignStudioNavProps) {
  const items = [
    { id: 'studio' as const, label: 'Studio', icon: 'dashboard_customize', href: studioHref },
    { id: 'systems' as const, label: 'Design Systems', icon: 'palette', href: systemsHref },
  ]

  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-5 shrink-0 place-items-center text-primary">
          <Icon name="draw" size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-on-surface">SubDesign workspace</p>
          <p className="max-w-[420px] truncate text-[10px] text-outline">{contextLabel || 'Design System 與產物共用同一個專案脈絡'}</p>
        </div>
      </div>
      <div className="inline-flex w-fit rounded-xl border border-white/10 bg-black/15 p-1" aria-label="SubDesign workspace sections">
        {items.map((item) => {
          const selected = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.href)}
              aria-current={selected ? 'page' : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-colors ${
                selected ? 'bg-hover text-on-surface' : 'text-outline hover:text-on-surface'
              }`}
            >
              <Icon name={item.icon} size={14} />{item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
