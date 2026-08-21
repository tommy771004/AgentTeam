import { useRef } from 'react'
import { Icon } from '../Icon'
import type { SubDesignTemplate } from '../../agent/subdesign/templateCatalog'

type Category = { id: string; label: string; icon?: string }
const CATEGORIES: Category[] = [
  { id: 'all', label: 'All' },
  { id: 'creative', label: 'Creative decks', icon: 'palette' },
  { id: 'engineering', label: 'Engineering talks', icon: 'terminal' },
  { id: 'pitch', label: 'Pitch / business', icon: 'monitor' },
  { id: 'course', label: 'Course / training', icon: 'lightbulb' },
  { id: 'reports', label: 'Reports / briefings', icon: 'description' },
  { id: 'product', label: 'Product / sales', icon: 'star' },
]

export type LandingProps = {
  brief: string
  onBriefChange: (v: string) => void
  template: SubDesignTemplate | null
  onClearTemplate: () => void
  onPickTemplate: (t: SubDesignTemplate) => void
  templates: SubDesignTemplate[]
  examples: SubDesignTemplate[]
  designSystemLabel: string
  workingDirectoryLabel: string
  onBrowseDesignSystems: () => void
  onRefreshSystems: () => void
  activeCategory: string
  onSelectCategory: (id: string) => void
  canSend: boolean
  onSend: () => void
  onStartWithPrompt: (prompt: string, template?: SubDesignTemplate) => void
}

function TemplateThumb({ template }: { template: SubDesignTemplate }) {
  // Use deterministic placeholder gradient based on title hash — real product would use template preview image
  const hue = Math.abs(template.title.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360
  const bg = `hsl(${hue} 55% 88%)`
  return (
    <div className="relative h-[132px] overflow-hidden rounded-t-[14px] border-b border-[#e8ddd5]" style={{ background: bg }}>
      <div className="absolute inset-0 grid place-items-center p-3">
        <div className="w-full rounded-[8px] bg-white shadow-[0_1px_8px_rgba(0,0,0,0.08)] p-2.5 text-left">
          <div className="text-[8px] tracking-[0.12em] font-semibold text-neutral-400 uppercase">{template.category}</div>
          <div className="mt-1 text-[11px] font-semibold leading-tight text-neutral-900 line-clamp-2">{template.title}</div>
          <div className="mt-1.5 h-px bg-neutral-100" />
          <div className="mt-1.5 text-[9px] leading-relaxed text-neutral-500 line-clamp-2">{template.summary}</div>
        </div>
      </div>
    </div>
  )
}

export function SubDesignConversationLanding(props: LandingProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { brief, onBriefChange, template, examples, designSystemLabel, workingDirectoryLabel, activeCategory } = props

  return (
    <section className="mx-auto w-full max-w-[880px] px-4 pb-10">
      {/* Header — centered, generous air */}
      <div className="text-center pt-6 pb-5">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 shadow-[0_1px_6px_rgba(0,0,0,0.06)] ring-1 ring-[#e8ddd5]">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#0f1a1a] text-white">
            <Icon name="near_me" size={12} />
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-[#111111]">Open Design</span>
        </div>
        <h1 className="mt-6 text-[30px] md:text-[38px] font-[650] tracking-[-0.02em] text-[#111111]" style={{ fontFamily: 'ui-serif, Georgia, serif' }}>
          What will you design today?
        </h1>
        <p className="mt-2 text-[13px] text-[#8a8580]">The open-source Claude Design alternative.</p>
      </div>

      {/* Composer — thin terracotta hairline, soft corners, generous padding */}
      <div className="rounded-[18px] border border-[#e2c5b8] bg-white shadow-[0_2px_16px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <textarea
            ref={textareaRef}
            value={brief}
            onChange={(e) => onBriefChange(e.target.value)}
            placeholder="Turn my notes into a presentation"
            rows={3}
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#1a1a1a] placeholder:text-[#b8b0a8] outline-none"
            aria-label="Design prompt"
          />
        </div>
        <div className="flex items-center gap-2 px-3 pb-3 pt-2">
          <button
            type="button"
            aria-label="Add attachment"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#e8ddd5] bg-white text-[#8a8580] hover:text-[#111111] transition-colors"
          >
            <Icon name="add" size={16} />
          </button>

          {template ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#fdf2ec] border border-[#e8ddd5] px-2.5 py-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white border border-[#e8ddd5]">
                <Icon name="slideshow" size={14} className="text-[#b8734a]" />
              </span>
              <span className="text-[11px] font-medium text-[#8a8580]">Template</span>
              <span className="text-[13px] font-semibold text-[#111111]">{template.title}</span>
              <button type="button" onClick={props.onClearTemplate} className="grid h-6 w-6 place-items-center rounded-full bg-white border border-[#e8ddd5] text-[#8a8580] hover:text-[#111111]" aria-label="Clear template">
                <Icon name="close" size={14} />
              </button>
            </span>
          ) : null}

          <span className="flex-1" />

          <div className="inline-flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#e8ddd5] bg-white px-2.5 py-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#6b7cff] text-white text-[11px] font-bold">◈</span>
              <Icon name="expand_more" size={14} className="text-[#8a8580]" />
            </span>
            <button
              type="button"
              onClick={props.onSend}
              disabled={!props.canSend}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#c07a56] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_1px_6px_rgba(192,122,86,0.35)] hover:bg-[#b56d48] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="send" size={14} />
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Meta row — design system + working directory */}
      <div className="mt-3 flex flex-wrap items-center gap-3 px-1 text-[12px] text-[#8a8580]">
        <button type="button" onClick={props.onBrowseDesignSystems} className="inline-flex items-center gap-1.5 hover:text-[#111111] transition-colors">
          <Icon name="palette" size={14} className="text-[#b8b0a8]" />
          <span className="text-[#6b6560]">{designSystemLabel}</span>
          <Icon name="expand_more" size={14} />
        </button>
        <span className="h-3 w-px bg-[#e8ddd5]" aria-hidden />
        <button type="button" className="inline-flex items-center gap-1.5 hover:text-[#111111] transition-colors" onClick={props.onRefreshSystems}>
          <Icon name="folder" size={14} className="text-[#b8b0a8]" />
          {workingDirectoryLabel}
          <Icon name="expand_more" size={14} />
        </button>
      </div>

      {/* Category pills — one row + wrapped, first active with terracotta ring */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {CATEGORIES.map((cat) => {
          const active = cat.id === activeCategory
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => props.onSelectCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
                active
                  ? 'bg-[#fdf2ec] border-[#e2c5b8] text-[#111111] ring-1 ring-[#e2c5b8]'
                  : 'bg-white border-[#e8ddd5] text-[#6b6560] hover:border-[#d8c9bc] hover:text-[#111111]'
              }`}
            >
              {cat.icon ? <Icon name={cat.icon as never} size={14} className={active ? 'text-[#c07a56]' : 'text-[#b8b0a8]'} /> : null}
              {cat.label}
            </button>
          )
        })}
      </div>

      {/* Example prompts — horizontal scroll on mobile, gradient masks at edges */}
      <div className="mt-6">
        <h2 className="text-[13px] font-semibold text-[#111111]">Example prompts</h2>
        <div className="relative mt-3">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#fdfcfa] to-transparent z-10 hidden sm:block" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#fdfcfa] to-transparent z-10 hidden sm:block" />
          <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {examples.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => props.onStartWithPrompt(t.suggestedObjective || t.summary, t)}
                className="snap-start shrink-0 w-[220px] rounded-[16px] border border-[#e8ddd5] bg-white text-left overflow-hidden hover:border-[#d8c9bc] hover:shadow-[0_2px_10px_rgba(0,0,0,0.05)] transition-all"
              >
                <TemplateThumb template={t} />
                <div className="px-3 py-2.5">
                  <div className="text-[13px] font-semibold text-[#111111] truncate">{t.title}</div>
                </div>
              </button>
            ))}
          </div>
          {/* Subtle scroll hint arrows — like screenshot */}
          <button type="button" aria-label="Scroll left" className="absolute left-1 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-white border border-[#e8ddd5] shadow-sm text-[#6b6560] hidden sm:grid" onClick={() => document.querySelector('#example-prompts-scroll')?.scrollBy({ left: -240, behavior: 'smooth' })}>
            <Icon name="chevron_left" size={16} />
          </button>
          <button type="button" aria-label="Scroll right" className="absolute right-1 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-white border border-[#e8ddd5] shadow-sm text-[#6b6560] hidden sm:grid" onClick={() => document.querySelector('#example-prompts-scroll')?.scrollBy({ left: 240, behavior: 'smooth' })}>
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
