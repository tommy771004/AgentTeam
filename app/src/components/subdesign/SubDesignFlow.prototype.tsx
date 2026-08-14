/**
 * PROTOTYPE — throwaway UI research, not production workflow code.
 * Question: which SubDesign project-flow layout best preserves the Open Design
 * "brief → direction → build → critique → deliver" mental model?
 * Run: npm run dev, then open #/subdesign?prototype=subdesign-flow&variant=A
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'

type VariantKey = 'A' | 'B' | 'C'

const VARIANTS: Array<{ key: VariantKey; label: string; name: string }> = [
  { key: 'A', label: 'A', name: '階段導向 Studio' },
  { key: 'B', label: 'B', name: '任務時間線' },
  { key: 'C', label: 'C', name: '專案工作台' },
]

const STAGES = [
  { label: 'Brief', icon: 'edit_note', state: 'done' },
  { label: 'Direction', icon: 'palette', state: 'done' },
  { label: 'Build', icon: 'auto_awesome', state: 'active' },
  { label: 'Critique', icon: 'rate_review', state: 'pending' },
  { label: 'Deliver', icon: 'rocket_launch', state: 'locked' },
] as const

function StageChip({ stage, compact = false }: { stage: (typeof STAGES)[number]; compact?: boolean }) {
  const tone =
    stage.state === 'done'
      ? 'border-primary/25 bg-transparent text-primary'
      : stage.state === 'active'
        ? 'border-secondary/45 bg-transparent text-secondary'
        : stage.state === 'locked'
          ? 'border-white/8 bg-white/[0.02] text-outline/60'
          : 'border-white/10 bg-white/[0.04] text-outline'
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${tone}`}>
      <Icon name={stage.state === 'done' ? 'check_circle' : stage.icon} size={compact ? 14 : 16} />
      <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-semibold`}>{stage.label}</span>
      {!compact && <span className="ml-auto text-[9px] uppercase tracking-wider opacity-70">{stage.state}</span>}
    </div>
  )
}

function PrototypeNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-secondary/30 bg-secondary/[0.07] px-4 py-3 text-[11px] text-secondary">
      <span className="inline-flex items-center gap-2 font-semibold"><Icon name="science" size={15} />PROTOTYPE · {title}</span>
      <span className="text-outline">{body}</span>
    </div>
  )
}

function ReadonlyButton({ icon, children, primary = false }: { icon: string; children: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(event) => event.preventDefault()}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold ${
        primary ? 'bg-primary text-on-primary' : 'border border-white/12 text-outline'
      }`}
      title="Prototype only — no action is executed"
    >
      <Icon name={icon} size={14} />{children}
    </button>
  )
}

function VariantA() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-28 pt-8 md:px-8">
      <PrototypeNotice title="A · 階段導向 Studio" body="問題：是否應把整個設計旅程固定在頁首？" />
      <header className="rounded-3xl border border-primary/25 bg-surface-container-low px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-primary">SUBDESIGN / PROJECT</p>
            <h1 className="mt-1 text-2xl font-semibold text-on-surface">Aurora 商城商品詳情頁</h1>
            <p className="mt-1 text-[12px] text-outline">brief_7fm2 · Responsive web · Linear-inspired system</p>
          </div>
          <div className="flex gap-2"><ReadonlyButton icon="share" >分享</ReadonlyButton><ReadonlyButton icon="open_in_new" primary>開啟完整逐字稿</ReadonlyButton></div>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-5">
          {STAGES.map((stage) => <StageChip key={stage.label} stage={stage} />)}
        </div>
      </header>
      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-surface-container-low p-4">
            <p className="text-[10px] font-semibold tracking-widest text-outline">PROJECT CONTEXT</p>
            <dl className="mt-3 space-y-3 text-[12px]">
              <div><dt className="text-outline">目的</dt><dd className="mt-1 text-on-surface">提高首購轉換與尺寸理解</dd></div>
              <div><dt className="text-outline">Direction lock</dt><dd className="mt-1 inline-flex items-center gap-1 text-primary"><Icon name="lock" size={13} />已鎖定 · Aurora v2</dd></div>
              <div><dt className="text-outline">選用範本</dt><dd className="mt-1 text-on-surface">e-commerce / calm commerce</dd></div>
            </dl>
          </section>
          <section className="rounded-2xl border border-white/10 bg-surface-container-low p-4">
            <p className="text-[10px] font-semibold tracking-widest text-outline">NEXT GATE</p>
            <p className="mt-3 text-[13px] font-semibold text-on-surface">等待 artifact 產生完成</p>
            <p className="mt-1 text-[11px] leading-relaxed text-outline">完成後自動開放 Critique；交付仍需 critique pass。</p>
          </section>
        </aside>
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#11161b]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-on-surface"><span className="h-2 w-2 rounded-full bg-secondary" />Build 正在產生 artifact</div>
            <span className="text-[10px] text-outline">4 工具呼叫 · 01:42</span>
          </div>
          <div className="grid min-h-[420px] place-items-center bg-[radial-gradient(circle_at_center,rgba(43,184,217,0.15),transparent_55%)] p-8">
            <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/15 bg-[#f9fafb] shadow-2xl">
              <div className="h-8 bg-slate-200 px-3 py-2"><span className="block h-2 w-20 rounded bg-slate-300" /></div>
              <div className="grid grid-cols-[1.1fr_.9fr] gap-6 p-7"><div className="aspect-square rounded-2xl bg-gradient-to-br from-cyan-100 to-slate-200" /><div className="space-y-3"><div className="h-3 w-24 rounded bg-slate-200" /><div className="h-7 w-full rounded bg-slate-300" /><div className="h-3 w-4/5 rounded bg-slate-200" /><div className="mt-8 h-11 rounded-xl bg-cyan-600" /></div></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function VariantB() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-28 pt-8 md:px-8">
      <PrototypeNotice title="B · 任務時間線" body="問題：使用者是否更需要知道現在發生什麼，而不是看設定？" />
      <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)_260px]">
        <aside className="rounded-3xl border border-white/10 bg-surface-container-low p-4">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-primary">DESIGN JOURNEY</p>
          <h1 className="mt-2 text-lg font-semibold text-on-surface">Aurora 商品詳情頁</h1>
          <div className="mt-6 space-y-1 border-l border-white/12 pl-4">
            {STAGES.map((stage, index) => <div key={stage.label} className="relative pb-5 last:pb-0"><span className={`absolute -left-[22px] grid h-4 w-4 place-items-center rounded-full border ${stage.state === 'active' ? 'border-secondary bg-transparent' : stage.state === 'done' ? 'border-primary bg-transparent' : 'border-white/15 bg-background'}`}><Icon name={stage.state === 'done' ? 'check' : index + 1 === 3 ? 'play_arrow' : 'lock'} size={10} className={stage.state === 'locked' ? 'text-outline' : stage.state === 'active' ? 'text-secondary' : 'text-primary'} /></span><p className={`text-[12px] font-semibold ${stage.state === 'active' ? 'text-secondary' : stage.state === 'locked' ? 'text-outline/60' : 'text-on-surface'}`}>{stage.label}</p><p className="mt-0.5 text-[10px] text-outline">{stage.state === 'active' ? '正在執行' : stage.state === 'done' ? '已確認' : '尚未開放'}</p></div>)}
          </div>
        </aside>
        <main className="rounded-3xl border border-white/10 bg-surface-container-low p-5">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-outline">LIVE ACTIVITY</p><h2 className="mt-1 text-xl font-semibold text-on-surface">讓使用者看懂 agent 的下一步</h2></div><span className="text-[10px] font-semibold text-secondary">LIVE · 01:42</span></div>
          <ol className="mt-7 space-y-1">
            {[
              ['done', '讀取 Aurora DESIGN.md', '套用色彩、字體與間距規則'],
              ['done', '選擇 e-commerce template', '已建立商品資訊與購買區段'],
              ['active', '生成 HTML artifact', '正在產生 responsive layout 與 CTA states'],
              ['pending', '執行三角色 critique', 'build 完成後自動啟動'],
              ['locked', '交付 HTML / PDF / PPTX', 'Critique pass 後才可執行'],
            ].map(([state, title, detail]) => <li key={title} className="flex gap-3 rounded-2xl px-3 py-3 hover:bg-white/[0.03]"><span className={`mt-0.5 grid h-6 w-6 place-items-center ${state === 'done' ? 'text-primary' : state === 'active' ? 'text-secondary' : 'text-outline'}`}><Icon name={state === 'done' ? 'check' : state === 'active' ? 'progress_activity' : 'lock'} size={14} className={state === 'active' ? 'animate-spin' : ''} /></span><div><p className="text-[13px] font-semibold text-on-surface">{title}</p><p className="mt-0.5 text-[11px] text-outline">{detail}</p></div></li>)}
          </ol>
        </main>
        <aside className="space-y-4">
          <section className="rounded-3xl border border-primary/25 bg-primary/[0.05] p-4"><p className="text-[10px] font-semibold tracking-widest text-primary">CURRENT OUTPUT</p><div className="mt-3 aspect-[4/3] rounded-xl border border-white/10 bg-gradient-to-br from-cyan-300/20 via-slate-800 to-slate-950" /><p className="mt-3 text-[12px] font-semibold text-on-surface">product-detail.html</p><p className="mt-1 text-[11px] text-outline">revision 2 · 尚未通過 critique</p></section>
          <section className="rounded-3xl border border-white/10 bg-surface-container-low p-4"><p className="text-[10px] font-semibold tracking-widest text-outline">USER CONTROL</p><div className="mt-3 grid gap-2"><ReadonlyButton icon="stop_circle">中止這次建置</ReadonlyButton><ReadonlyButton icon="chat">查看完整對話</ReadonlyButton></div></section>
        </aside>
      </div>
    </div>
  )
}

function VariantC() {
  return (
    <div className="mx-auto max-w-[1320px] px-5 pb-28 pt-8 md:px-8">
      <PrototypeNotice title="C · 專案工作台" body="問題：當同一 brief 有多個 artifact 時，檔案與交付是否應成為主視圖？" />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-primary">SUBDESIGN STUDIO</p><h1 className="mt-1 text-2xl font-semibold text-on-surface">Aurora 商城商品詳情頁</h1></div><div className="flex gap-2"><ReadonlyButton icon="more_horiz">專案選項</ReadonlyButton><ReadonlyButton icon="rocket_launch" primary>交付（已鎖定）</ReadonlyButton></div></header>
      <div className="mt-5 grid min-h-[570px] overflow-hidden rounded-3xl border border-white/10 bg-surface-container-low lg:grid-cols-[230px_minmax(0,1fr)_290px]">
        <aside className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r"><p className="text-[10px] font-semibold tracking-widest text-outline">ARTIFACTS</p><div className="mt-3 space-y-2">{['product-detail.html', 'tokens.css', 'critique-evidence.json'].map((file, index) => <button key={file} type="button" onClick={(event) => event.preventDefault()} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] ${index === 0 ? 'bg-primary/12 text-primary' : 'text-outline hover:bg-white/[0.04]'}`}><Icon name={index === 2 ? 'fact_check' : 'description'} size={15} />{file}</button>)}</div><p className="mt-7 text-[10px] font-semibold tracking-widest text-outline">PROJECT FLOW</p><div className="mt-3 space-y-2">{STAGES.map((stage) => <StageChip key={stage.label} stage={stage} compact />)}</div></aside>
        <main className="min-w-0 border-b border-white/10 lg:border-b-0 lg:border-r"><div className="flex items-center gap-4 border-b border-white/10 px-4 py-3"><button type="button" className="border-b-2 border-primary pb-1 text-[11px] font-semibold text-primary">Preview</button><button type="button" className="text-[11px] text-outline">Code</button><span className="ml-auto text-[10px] text-outline">responsive · revision 2</span></div><div className="grid min-h-[505px] place-items-center bg-[#0f1419] p-7"><div className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl"><div className="flex h-10 items-center gap-2 bg-slate-100 px-4"><span className="h-2 w-2 rounded-full bg-rose-300" /><span className="h-2 w-2 rounded-full bg-amber-300" /><span className="h-2 w-2 rounded-full bg-emerald-300" /></div><div className="grid min-h-[360px] grid-cols-[1.05fr_.95fr] gap-7 p-8"><div className="rounded-2xl bg-gradient-to-br from-teal-100 via-cyan-50 to-indigo-100" /><div className="space-y-3"><div className="h-3 w-20 rounded bg-slate-200" /><div className="h-10 w-full rounded bg-slate-800" /><div className="h-3 w-4/5 rounded bg-slate-200" /><div className="h-3 w-3/5 rounded bg-slate-200" /><div className="mt-8 h-12 rounded-xl bg-teal-600" /></div></div></div></div></main>
        <aside className="p-4"><p className="text-[10px] font-semibold tracking-widest text-outline">INSPECTOR</p><section className="mt-3 rounded-2xl border border-secondary/25 bg-secondary/[0.06] p-3"><p className="text-[12px] font-semibold text-secondary">Build 正在執行</p><p className="mt-1 text-[11px] leading-relaxed text-outline">目前產生 responsive states。結束後會把焦點移至 Critique tab。</p></section><section className="mt-4"><p className="text-[10px] font-semibold tracking-widest text-outline">DIRECTION</p><p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-primary"><Icon name="lock" size={14} />Aurora / Calm commerce</p></section><section className="mt-5"><p className="text-[10px] font-semibold tracking-widest text-outline">HANDOFF CHECKLIST</p><ul className="mt-2 space-y-2 text-[11px] text-outline"><li className="flex gap-2"><Icon name="check_circle" size={14} className="text-primary" />Artifact exists</li><li className="flex gap-2"><Icon name="pending" size={14} className="text-secondary" />Critique pending</li><li className="flex gap-2"><Icon name="lock" size={14} />Export locked</li></ul></section></aside>
      </div>
    </div>
  )
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const location = useLocation()
  const navigate = useNavigate()
  const index = VARIANTS.findIndex((variant) => variant.key === current)
  const go = (delta: number) => {
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
    const params = new URLSearchParams(location.search)
    params.set('prototype', 'subdesign-flow')
    params.set('variant', next.key)
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  const variant = VARIANTS[index]
  return <div className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-control border border-line bg-surface-container px-3 py-2 shadow-raised"><button type="button" onClick={() => go(-1)} className="grid h-8 w-8 place-items-center rounded-control text-secondary hover:bg-hover-2" aria-label="Previous prototype variant"><Icon name="arrow_back" size={16} /></button><span className="min-w-[190px] text-center text-[11px] font-semibold text-on-surface">{variant.label} — {variant.name}</span><button type="button" onClick={() => go(1)} className="grid h-8 w-8 place-items-center rounded-control text-secondary hover:bg-hover-2" aria-label="Next prototype variant"><Icon name="arrow_forward" size={16} /></button></div>
}

export function SubDesignFlowPrototype() {
  const location = useLocation()
  const key = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  const variant: VariantKey = key === 'B' || key === 'C' ? key : 'A'
  return <><div className="h-full min-w-0 overflow-auto bg-background text-on-background">{variant === 'A' ? <VariantA /> : variant === 'B' ? <VariantB /> : <VariantC />}</div><PrototypeSwitcher current={variant} /></>
}
