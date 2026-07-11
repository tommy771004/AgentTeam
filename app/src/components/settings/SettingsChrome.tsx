import type { ReactNode } from 'react'

/**
 * Shared page chrome — same language as Settings (ChatGPT-style rows/groups).
 * Used by Dashboard / Automation / Learning / Records / Docs / etc.
 */

/** ChatGPT-style: left title/description, right control on one row */
export function SettingsRow({
  title,
  description,
  control,
  align = 'center',
}: {
  title: string
  description?: string
  control: ReactNode
  /** Use start for tall controls (sliders spanning right) */
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={`flex gap-6 px-4 py-3.5 min-h-[56px] ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-on-surface leading-snug">{title}</div>
        {description ? (
          <p className="text-[11px] text-outline mt-0.5 leading-relaxed max-w-xl">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0 flex items-center justify-end max-w-[46%]">{control}</div>
    </div>
  )
}

/** Card group with dividers between rows */
export function SettingsGroup({
  title,
  children,
  action,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="mb-7">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-2 px-0.5">
          {title ? (
            <h3 className="text-[13px] font-semibold text-on-surface tracking-tight">{title}</h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/[0.07] overflow-hidden">
        {children}
      </div>
    </section>
  )
}

/** Page section header (right pane title) */
export function SettingsHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: ReactNode
}) {
  return (
    <header className="mb-6">
      <h2 className="text-[22px] font-semibold tracking-tight text-on-surface font-[family-name:var(--font-sora)]">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-[13px] text-outline mt-1.5 leading-relaxed max-w-2xl">{subtitle}</p>
      ) : null}
    </header>
  )
}

/** Compact pill select — sits on the right of a SettingsRow */
export function PillSelect({
  value,
  onChange,
  children,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`relative inline-flex ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none cursor-pointer bg-white/[0.08] hover:bg-white/[0.12] border border-white/12 rounded-full pl-3.5 pr-8 py-1.5 text-[12px] font-medium text-on-surface outline-none focus:border-primary/40 min-w-[6.5rem] max-w-[14rem]"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-outline text-[10px]">
        ▾
      </span>
    </div>
  )
}

/** iOS / ChatGPT style toggle */
export function SettingsToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

/** Full-width field inside a group (for textareas / long inputs) */
export function SettingsStack({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="px-4 py-3.5 space-y-2">
      <div>
        <div className="text-[13px] font-medium text-on-surface">{title}</div>
        {description ? (
          <p className="text-[11px] text-outline mt-0.5 leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export const settingsInputCls =
  'w-full bg-black/20 border border-white/10 focus:border-primary/35 rounded-xl px-3 py-2 text-[13px] text-on-surface outline-none placeholder:text-outline/60'

export const settingsBtnCls =
  'px-3 py-1.5 rounded-full border border-white/12 text-[12px] font-semibold text-on-surface-variant hover:bg-white/[0.06] hover:text-on-surface transition-colors'

export const settingsBtnPrimaryCls =
  'px-3 py-1.5 rounded-full border border-primary/35 text-[12px] font-semibold text-primary bg-primary/10 hover:bg-primary/15 transition-colors'
