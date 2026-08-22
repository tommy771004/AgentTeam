/**
 * PROTOTYPE — DEV-only visual QA for the docs/ui → SubDesign integration.
 * Each docs/ui primitive is rendered on its matching SubDesign surface in a
 * settled state so the integration spec can be screenshot-reviewed.
 * Run: npm run dev, then open /?prototype=subdesign-docsui#/subdesign
 */
import { Icon } from '../Icon'

function Section({
  id,
  no,
  title,
  spec,
  children,
}: {
  id: string
  no: string
  title: string
  spec: string
  children: React.ReactNode
}) {
  return (
    <section data-section={id} className="flex gap-6 border-b border-white/[0.06] py-8">
      <div className="w-44 shrink-0">
        <p className="text-[11px] font-semibold text-ink-3 tabular-nums">{no}</p>
        <h2 className="mt-1 text-[15px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-outline">{spec}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  )
}

function Glyph({ children, size = 14 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const CheckIcon = (
  <Glyph size={13}>
    <path d="M20 6L9 17l-5-5" strokeWidth="2.4" />
  </Glyph>
)

/* ── 01 · Prompt Bar → SubDesign composer ───────────────────────────── */

const SOURCES = [
  { name: 'moodboard.png', desc: '參考圖 · 已匯入 12 張', glyph: 'clip' as const },
  { name: 'Storybook', desc: '元件庫截圖 · endpoint 已連線', glyph: 'layers' as const },
  { name: '專案檔案', desc: 'project root 內的檔案', glyph: 'folder' as const },
  { name: 'Web search', desc: '即時資訊與趨勢', glyph: 'globe' as const },
]

function SourceGlyph({ kind }: { kind: 'clip' | 'doc' | 'layers' | 'folder' | 'globe' }) {
  const paths: Record<string, React.ReactNode> = {
    clip: <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
    doc: (
      <g>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </g>
    ),
    layers: (
      <g>
        <path d="M12 2 2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </g>
    ),
    folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
    globe: (
      <g>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </g>
    ),
  }
  return <Glyph size={14}>{paths[kind]}</Glyph>
}

function ComposerSection() {
  return (
    <div className="w-full max-w-[430px]">
      {/* @ menu（展開狀態） */}
      <div className="rounded-[10px] bg-surface p-1 shadow-raised">
        {SOURCES.map((source, i) => (
          <button
            key={source.name}
            type="button"
            onClick={(event) => event.preventDefault()}
            className={`flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left ${
              i === 0 ? 'bg-hover' : ''
            }`}
          >
            <span className="shrink-0 text-ink-2">
              <SourceGlyph kind={source.glyph} />
            </span>
            <span className="shrink-0 text-[12.5px] font-medium text-ink">{source.name}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{source.desc}</span>
            {i === 0 ? (
              <span className="shrink-0 text-[12px] font-medium text-accent-ink">已選</span>
            ) : null}
          </button>
        ))}
        <p className="mt-1 border-t border-line px-2 pb-1 pt-1.5 text-[11px] text-ink-3">
          輸入以搜尋來源與檔案 · ↑↓ 選擇、Enter 採用
        </p>
      </div>

      {/* composer 本體 */}
      <div className="mt-2 rounded-[14px] border border-line bg-surface p-1.5 shadow-card">
        <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
          {['moodboard.png', 'brand-v1.pdf'].map((file) => (
            <span
              key={file}
              className="inline-flex h-6.5 items-center gap-1.5 rounded-chip bg-field py-1 pl-1.5 pr-1 text-[11.5px] text-ink-2 shadow-hairline"
            >
              <Glyph size={12}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </Glyph>
              <span className="max-w-36 truncate">{file}</span>
              <button type="button" aria-label={`移除 ${file}`} className="flex size-4 items-center justify-center rounded-[4px] text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink">
                <Glyph size={10}>
                  <path d="M18 6L6 18M6 6l12 12" strokeWidth="2.5" />
                </Glyph>
              </button>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_28px] items-end gap-x-1">
          <button
            type="button"
            aria-label="附加來源"
            className="col-start-1 row-start-1 flex size-7 items-center justify-center rounded-[8px] bg-hover text-ink transition-colors"
          >
            <Glyph size={16}>
              <path d="M12 5v14M5 12h14" strokeWidth="2" />
            </Glyph>
          </button>
          <textarea
            rows={1}
            readOnly
            value="@moodboard "
            aria-label="SubDesign 指令輸入"
            className="col-start-2 row-start-1 min-h-7 w-full resize-none bg-transparent px-1 py-[5px] text-[13px] leading-[18px] text-ink outline-none"
          />
          <button
            type="button"
            className="col-start-3 row-start-1 flex h-7 shrink-0 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            主力模型
            <span className="text-ink-3">
              <Glyph size={11}>
                <path d="M6 9l6 6 6-6" strokeWidth="2.4" />
              </Glyph>
            </span>
          </button>
          <button
            type="button"
            aria-label="送出"
            className="col-start-4 row-start-1 flex size-7 items-center justify-center rounded-[8px]"
            style={{ background: 'var(--color-ink)', color: 'var(--color-surface)' }}
          >
            <Glyph size={16}>
              <path d="M12 19V5M5 12l7-7 7 7" strokeWidth="2.4" />
            </Glyph>
          </button>
        </div>
      </div>

      {/* / 指令列 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[
          ['/direction', '鎖定視覺方向'],
          ['/critique', '執行評圖'],
          ['/tweak', '局部修訂'],
          ['/deliver', '產出檔案'],
        ].map(([name, desc]) => (
          <span
            key={name}
            className="inline-flex h-7 items-center gap-1.5 rounded-chip bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn"
          >
            {name}
            <span className="font-sans text-[10.5px] text-ink-3">{desc}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── 02 · Thinking → run 前段敘事 ───────────────────────────────────── */

function ThinkingSection() {
  const steps = [
    { label: '整理 brief 驗收條件', meta: '4 條件' },
    { label: '比較三個視覺方向', meta: 'Editorial / Product / Signal' },
    { label: '生成 cover reference image', meta: '1024×768' },
    { label: '註冊 deck artifact', meta: 'r2' },
  ]
  return (
    <div className="w-full max-w-[420px]">
      <button type="button" className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors hover:bg-hover-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--color-ink-3)">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span className="whitespace-nowrap text-[13px] font-medium text-ink-2">思考完成 · 6 秒</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(180deg)' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="relative ml-[5px] mt-1 pl-4">
        <span aria-hidden className="absolute left-[3px] top-[-8px] h-[calc(100%-2px)] w-px bg-line" />
        <div className="flex flex-col gap-1 py-1">
          {steps.map((step) => (
            <div key={step.label} className="flex min-h-7 items-center gap-2 rounded-[6px] px-1.5 py-0.5">
              <span className="shrink-0 text-ink-3">{CheckIcon}</span>
              <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{step.label}</span>
              {step.meta ? <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">{step.meta}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 03 · Tool Chips + Loading State → plugin 執行過程 ──────────────── */

function ToolsSection() {
  const diffs = [
    { file: 'deck.html', add: 74, del: 41 },
    { file: 'tokens.css', add: 13, del: 0 },
  ]
  return (
    <div className="w-full max-w-[400px] pb-1">
      <button type="button" className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors hover:bg-hover-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">5 tool calls · 2 messages</span>
      </button>
      <div className="mt-1.5 flex flex-col gap-1">
        <div>
          <button type="button" aria-expanded className="-mx-[3px] flex h-7 w-[calc(100%+6px)] items-center gap-2 rounded-control px-[3px] text-left transition-colors hover:bg-hover-2">
            <span className="shrink-0 text-ink-3"><SourceGlyph kind="doc" /></span>
            <span className="shrink-0 text-[12.5px] font-medium text-ink">Read</span>
            <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline">
              brief.md
            </span>
          </button>
          <div className="ml-2 mb-1 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
            <span className="truncate font-mono text-[11.5px] leading-[1.6] text-green">+ --color-primary: #a4c3b4;</span>
            <span className="truncate font-mono text-[11.5px] leading-[1.6] text-green">+ radius.card = 14px · type = 3 tiers</span>
          </div>
        </div>
        <button type="button" aria-expanded={false} className="-mx-[3px] flex h-7 w-[calc(100%+6px)] items-center gap-2 rounded-control px-[3px] text-left transition-colors hover:bg-hover-2">
          <span className="shrink-0 text-ink-3">
            <Glyph size={13}>
              <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" strokeWidth="2" />
            </Glyph>
          </span>
          <span className="shrink-0 text-[12.5px] font-medium text-ink">Write 74 lines</span>
          <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline">
            deck.html
          </span>
        </button>
        <button type="button" aria-expanded={false} className="-mx-[3px] flex h-7 w-[calc(100%+6px)] items-center gap-2 rounded-control px-[3px] text-left transition-colors hover:bg-hover-2">
          <span className="shrink-0 text-ink-3">
            <Glyph size={13}>
              <path d="M4 17l6-5-6-5M12 19h8" strokeWidth="2" />
            </Glyph>
          </span>
          <span className="shrink-0 text-[12.5px] font-medium text-ink">Rebuild and verify</span>
          <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline">
            npm run capture
          </span>
        </button>
      </div>
      <div className="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-t border-line pt-2.5">
        {diffs.map((d) => (
          <span key={d.file} className="inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-chip bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn transition-colors hover:bg-hover">
            <span className="min-w-0 truncate">{d.file}</span>
            <span className="shrink-0 tabular-nums text-green">+{d.add}</span>
            {d.del > 0 ? <span className="shrink-0 tabular-nums text-red">−{d.del}</span> : null}
          </span>
        ))}
        <button type="button" className="inline-flex h-7 items-center rounded-chip px-1.5 font-mono text-[11.5px] text-ink-3 underline decoration-transparent underline-offset-2 transition-colors hover:text-ink-2 hover:decoration-current">
          +3 more
        </button>
      </div>

      {/* Loading State — Drive */}
      <div className="mt-5 flex w-fit items-center gap-2.5 rounded-card bg-surface px-3 py-2.5 shadow-card">
        <span aria-hidden className="grid grid-cols-3 gap-[1.5px]">
          {[0.15, 0.85, 0.15, 0.85, 1, 0.85, 0.15, 0.85, 0.15].map((opacity, i) => (
            <span key={i} className="size-[4px] rounded-[1px] bg-ink" style={{ opacity }} />
          ))}
        </span>
        <span className="text-[13px] font-medium text-ink">建構 Deck</span>
        <span className="font-mono text-[12px] tabular-nums text-ink-3">12.4s</span>
      </div>
    </div>
  )
}

/* ── 04 · Task Rows → lifecycle stages ─────────────────────────────── */

function RingBadge({ value }: { value?: string }) {
  const size = 24
  const stroke = 2
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const progress = value ? 0.62 : undefined
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        {progress !== undefined ? (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-3)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * progress} ${c * (1 - progress)}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        ) : null}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{value ?? ''}</span>
    </span>
  )
}

function TasksSection() {
  const doneBadge = (
    <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-green text-white">
      {CheckIcon}
    </span>
  )
  return (
    <div className="w-full max-w-[520px] self-start overflow-hidden rounded-card bg-surface shadow-card">
      {[
        {
          key: 'direction',
          badge: doneBadge,
          label: '方向研究與鎖定',
          amount: '3 directions',
          pill: <span className="inline-flex h-5.5 items-center rounded-full bg-green-tint px-2 text-[11.5px] font-medium text-green">已完成</span>,
          details: [{ label: '比較訊息、受眾與延展性', meta: '3/3' }],
        },
        {
          key: 'build',
          badge: <RingBadge value="2" />,
          label: '建構 Deck artifact',
          amount: '12 slides',
          pill: null,
          details: [
            { label: '讀取 brief 驗收條件 tokens', meta: 'done' },
            { label: '生成投影片', meta: '4/12' },
          ],
        },
        {
          key: 'critique',
          badge: <RingBadge />,
          label: 'Critique 與交付準備',
          amount: '—',
          pill: null,
          details: [],
        },
      ].map((row, i) => (
        <div key={row.key} className={`border-b border-white/[0.06] last:border-0`} style={{ animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both` }}>
          <button type="button" aria-expanded={row.key === 'build'} className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left transition-colors hover:bg-inset">
            <span className="flex size-6 shrink-0 items-center justify-center">{row.badge}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{row.label}</span>
            <span className="tabular-nums text-[12.5px] text-ink-2">{row.amount}</span>
            {row.pill}
            <span aria-hidden className="-ml-2 flex size-7 shrink-0 items-center justify-center text-ink-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: row.key === 'build' ? 'rotate(180deg)' : 'none' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
          {row.details.length ? (
            <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
              <span aria-hidden className="mx-auto h-full w-px bg-line" />
              <div className="flex flex-col gap-1.5">
                {row.details.map((detail) => (
                  <div key={detail.label} className="flex items-center justify-between">
                    <span className="text-[12px] text-ink-2">{detail.label}</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-ink-3">{detail.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* ── 05 · approve → 方向選擇卡 ─────────────────────────────────────── */

function DirectionSection() {
  const options = ['Editorial Focus · 敘事優先', 'Product Canvas · 介面為核心', 'Signal Deck · 高對比節奏']
  return (
    <div className="w-full max-w-[360px] overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad" style={{ animation: 'fade-up 350ms cubic-bezier(0.23,1,0.32,1) both' }}>
        <div className="flex items-start justify-between gap-3">
          <span className="text-[13px] font-medium text-ink">要採用哪個視覺方向？</span>
          <button type="button" aria-label="收合" className="shrink-0 text-ink-3 transition-colors hover:text-ink">
            <Glyph size={14}>
              <path d="M18 6L6 18M6 6l12 12" strokeWidth="2.2" />
            </Glyph>
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          {options.map((option, i) => {
            const on = i === 0
            return (
              <button key={option} type="button" aria-pressed={on} className="-mx-1.5 flex items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-hover">
                <span className={`flex size-4 shrink-0 items-center justify-center rounded-full ${on ? 'bg-ink text-canvas' : 'text-transparent'}`} style={on ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--color-line-strong)' }}>
                  <span className="size-1.5 rounded-full bg-canvas" />
                </span>
                <span className={`text-[13px] ${on ? 'text-ink' : 'text-ink-2'}`}>{option}</span>
              </button>
            )
          })}
          <label className="-mx-1.5 flex items-center gap-2 rounded-control px-1.5 py-1 transition-colors hover:bg-hover">
            <span aria-hidden className="size-4 shrink-0" />
            <input placeholder="輸入自訂方向…" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
          </label>
        </div>
      </div>
      <div className="primitive-card-footer flex items-center justify-between">
        <span className="flex items-center gap-2">
          <button type="button" aria-label="上一題" disabled className="flex size-6 items-center justify-center rounded-[5px] text-ink-3 opacity-35">
            <Glyph size={14}>
              <path d="M15 18l-6-6 6-6" strokeWidth="2.2" />
            </Glyph>
          </button>
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="rounded-full"
                style={
                  i === 0
                    ? { width: 9, height: 9, border: '2.5px solid var(--color-ink)' }
                    : { width: 7, height: 7, border: '1.5px solid var(--color-ink-3)' }
                }
              />
            ))}
          </span>
          <button type="button" aria-label="下一題" className="flex size-6 items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2">
            <Glyph size={14}>
              <path d="M9 6l6 6-6 6" strokeWidth="2.2" />
            </Glyph>
          </button>
        </span>
        <button
          type="button"
          aria-label="送出答案"
          className="-mr-0.5 flex size-7 items-center justify-center rounded-[8px]"
          style={{ background: 'var(--color-ink)', color: 'var(--color-surface)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14)' }}
        >
          <Glyph size={14}>
            <path d="M12 19V5M5 12l7-7 7 7" strokeWidth="2.5" />
          </Glyph>
        </button>
      </div>
    </div>
  )
}

/* ── 06 · Context Cards → 參考與脈絡 ───────────────────────────────── */

function ContextSection() {
  const chunks = [
    {
      title: '季節性色彩規範',
      chars: '290 characters',
      body: '主色 #a4c3b4 僅用於強調；封面背景走 #101310 深綠黑，確保投影環境下的對比。',
      badge: 'PNG',
      tone: 'bg-orange',
      source: 'moodboard.png',
    },
    {
      title: 'Typography 章節',
      chars: '1,250 characters',
      body: '顯示字體三層級：display 32／title 20／body 13。中文內文以系統字體 fallback，行高 1.7。',
      badge: 'URL',
      tone: 'bg-accent',
      source: 'brand-guidelines.com',
    },
  ]
  return (
    <div className="flex w-full max-w-[430px] flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[13px] font-semibold text-ink">參考與脈絡</span>
        <span className="inline-flex h-5 items-center rounded-md bg-inset px-1.5 text-[11.5px] font-medium tabular-nums text-ink-2 shadow-hairline">12</span>
      </div>
      {chunks.map((chunk, i) => (
        <div key={chunk.title} className="overflow-hidden rounded-card bg-surface shadow-card" style={{ animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${i * 100}ms both` }}>
          <div className="primitive-card-bar flex items-center gap-2.5 border-b border-line">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              <span className="truncate">{chunk.title}</span>
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-[12px] text-ink-3">{chunk.chars}</span>
          </div>
          <p className="px-3 pb-1 pt-2 text-[12.5px] leading-relaxed text-ink-2">{chunk.body}</p>
          <div className="px-3 pb-3">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn transition-colors hover:bg-hover">
              <span className={`flex size-3.5 items-center justify-center rounded-[4px] ${chunk.tone} text-[7px] font-bold text-white`}>{chunk.badge}</span>
              {chunk.source}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M7 7h10v10" />
              </svg>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── 07 · Streaming Text → critique 回饋 ───────────────────────────── */

function CritiqueStreamSection() {
  const followUps = ['把第三頁的數據對比再加強一階', '以 Signal Deck 的節奏重排附錄']
  return (
    <div className="w-full max-w-[430px]">
      <p className="text-[13px] leading-relaxed text-ink">
        Critique 通過三項驗收：敘事節奏、色彩對比與字體層級皆符合
契約；建議將第三頁的數據對比再加強，並在附錄補上供應商佐證。
      </p>
      <div className="mt-2 flex items-center gap-0.5">
        {[
          <g key="copy"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></g>,
          <path key="retry" d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />,
          <path key="up" d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />,
        ].map((icon, i) => (
          <button key={i} type="button" aria-label="動作" className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2">
            <Glyph size={15}>{icon}</Glyph>
          </button>
        ))}
        <button type="button" className="ml-1.5 flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 transition-colors hover:bg-hover">
          <span className="flex -space-x-1">
            {['bg-accent', 'bg-orange', 'bg-green'].map((tone) => (
              <span key={tone} className={`size-3.5 rounded-full ${tone} shadow-[0_0_0_1.5px_var(--color-canvas)]`} />
            ))}
          </span>
          <span className="text-[12px] text-ink-2">3 個來源</span>
        </button>
      </div>
      <div className="mt-2.5">
        <p className="text-[12px] font-medium text-ink-2">Follow-ups</p>
        <div className="mt-0.5 flex flex-col">
          {followUps.map((text) => (
            <button key={text} type="button" className="-mx-1.5 flex items-center gap-2 rounded-[7px] border-b border-line px-1.5 py-1.5 text-left text-[12.5px] text-ink transition-colors hover:bg-hover-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M9 10l-5 5 5 5" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
              </svg>
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 08 · Diff Table → artifact 修訂比較 ───────────────────────────── */

function DiffTableSection() {
  return (
    <div className="w-full max-w-[430px]">
      <div className="relative overflow-hidden rounded-card bg-surface shadow-card">
        <div className="primitive-card-bar flex items-center justify-between border-b border-line">
          <span className="text-[12.5px] font-medium text-ink">修訂比較 r1 → r2</span>
        </div>
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {['章節', '類型', '來源'].map((h) => (
                <th key={h} className="primitive-table-cell text-[12px] font-medium text-ink-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line transition-colors hover:bg-hover" style={{ background: 'var(--color-red-tint)' }}>
              <td className="primitive-table-cell tabular-nums text-[13px] font-medium" style={{ color: 'var(--color-red)' }}>定價舊版頁</td>
              <td className="primitive-table-cell">
                <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-inset px-2 text-[11.5px] font-medium shadow-hairline" style={{ opacity: 0.55 }}>
                  <span className="size-1.5 rounded-full bg-red" />
                  <span className="text-ink-2">Classic</span>
                </span>
              </td>
              <td className="primitive-table-cell whitespace-nowrap text-[12.5px]" style={{ color: 'var(--color-red)', textDecorationLine: 'line-through', textDecorationColor: 'color-mix(in srgb, var(--color-red) 50%, transparent)' }}>
                pricing-v1.html
              </td>
            </tr>
            <tr className="last:border-0" style={{ background: 'var(--color-green-tint)' }}>
              <td className="primitive-table-cell tabular-nums text-[13px] font-medium text-green">信號摘要頁</td>
              <td className="primitive-table-cell">
                <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-surface px-2 text-[11.5px] font-medium shadow-hairline">
                  <span className="size-1.5 rounded-full bg-green" />
                  <span className="text-ink-2">Signal</span>
                </span>
              </td>
              <td className="primitive-table-cell whitespace-nowrap text-[12.5px] text-green">summary-r2.html</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── 09 · Recommendation Card → 交付格式建議 ────────────────────────── */

function DeliverSection() {
  const alternatives = [
    { short: 'PDF 直接輸出 · 不經 PPTX', cta: '設定' },
    { short: 'MP4 動態預覽 · 含轉場', cta: '採用' },
  ]
  return (
    <div className="w-full max-w-[430px] overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad">
        <div className="flex items-start justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink">要以此格式交付嗎？</span>
          <span className="flex items-center gap-1.5">
            <span className="flex items-end gap-0.5">
              {[0, 1, 2].map((bar) => (
                <span key={bar} className="w-1 rounded-full" style={{ height: 10, background: bar < 3 ? 'var(--color-green)' : 'var(--color-line-strong)' }} />
              ))}
            </span>
            <span className="text-[11px] font-medium text-green">高信心</span>
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          同時輸出
          <code className="mx-1 rounded-md bg-accent-tint px-1.5 py-0.5 font-mono text-[12px] text-accent-ink">html</code>
          與
          <code className="mx-1 rounded-md bg-accent-tint px-1.5 py-0.5 font-mono text-[12px] text-accent-ink">pptx</code>
          ；PDF 由 PPTX 一併轉出，編輯與簡報兩用。
        </p>
      </div>
      <div className="border-t border-line bg-inset px-2 py-2" style={{ opacity: 1 }}>
        <p className="px-1.5 pb-1 text-[11px] font-medium text-ink-3">其他選項</p>
        {alternatives.map((option) => (
          <button key={option.short} type="button" className="flex h-8 w-full items-center gap-2 rounded-[6px] px-1.5 text-left transition-colors hover:bg-hover">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{option.short}</span>
            <span className="shrink-0 text-[12px] font-medium text-accent-ink">{option.cta}</span>
          </button>
        ))}
      </div>
      <div className="primitive-card-footer flex items-center justify-between border-t border-line">
        <button type="button" className="flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          換一組格式
        </button>
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[12px] font-semibold text-white transition-colors hover:bg-accent/90">
          {CheckIcon}採用此組合
        </button>
      </div>
    </div>
  )
}

/* ── 10 · Code Block → 匯出檔案預覽 ────────────────────────────────── */

const EXPORT_LINES: Array<Array<{ t: string; c?: 'kw' | 'str' | 'fn' | 'dim' }>> = [
  [{ t: '<section ', c: 'kw' }, { t: 'class', c: 'dim' }, { t: '=', c: 'dim' }, { t: '"slide slide--cover"', c: 'str' }, { t: '>', c: 'dim' }],
  [{ t: '  <h1 ', c: 'kw' }, { t: 'data-token', c: 'dim' }, { t: '=', c: 'dim' }, { t: '"type.display"', c: 'str' }, { t: '>', c: 'dim' }, { t: '產品策略簡報', c: 'fn' }, { t: '</h1>', c: 'dim' }],
  [{ t: '  <p ', c: 'kw' }, { t: 'data-token', c: 'dim' }, { t: '=', c: 'dim' }, { t: '"type.body"', c: 'str' }, { t: '>', c: 'dim' }, { t: 'Editorial Focus · v2', c: 'fn' }, { t: '</p>', c: 'dim' }],
  [{ t: '</section>', c: 'dim' }],
]

function CodeBlockSection() {
  return (
    <div className="w-full max-w-[430px] overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-bar flex items-center justify-between border-b border-line">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] font-medium text-ink">export.html</span>
          <span className="text-[11.5px] text-ink-3">Deck HTML</span>
        </span>
        <button type="button" className="flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <Glyph size={10}>
            <rect x="9" y="9" width="12" height="12" rx="2.5" strokeWidth="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
          </Glyph>
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto bg-inset px-3 py-2.5 font-mono text-[11.5px] leading-[1.7]">
        {EXPORT_LINES.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-5 shrink-0 select-none text-right text-[10.5px] leading-[1.86] text-ink-3/60">{i + 1}</span>
            <span className="pl-2.5">
              {line.map((token, j) => (
                <span key={j} style={{ color: token.c ? `var(--color-${token.c === 'kw' ? 'accent-ink' : token.c === 'str' ? 'green' : token.c === 'fn' ? 'ink' : 'ink-3'})` : 'var(--color-ink)' }}>
                  {token.t}
                </span>
              ))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  )
}

/* ── page ──────────────────────────────────────────────────────────── */

export function SubDesignDocsUiPrototype() {
  return (
    <div className="h-full overflow-y-auto bg-background custom-scrollbar">
      <div className="mx-auto max-w-[900px] px-8 py-8">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-secondary/30 bg-secondary/[0.07] px-4 py-3 text-[11px] text-secondary">
          <span className="inline-flex items-center gap-2 font-semibold">
            <Icon name="science" size={15} />
            PROTOTYPE · docs/ui × SubDesign 整合規格
          </span>
          <span className="text-outline">每個區塊對應一份 docs/ui 元件規格，畫面為 settled 狀態，供截圖審查。</span>
        </header>

        <Section id="composer" no="01 · Prompt Bar.md" title="Composer" spec="左欄對話 composer：@ 引用 brief 來源、/ 呼叫 SubDesign 指令、附件 chips、模型 picker。">
          <ComposerSection />
        </Section>
        <Section id="thinking" no="02 · Thinking.md" title="Run 敘事前段" spec="run 起始後的 Thinking trace：整理 brief、比較方向、生成 reference、註冊 artifact。">
          <ThinkingSection />
        </Section>
        <Section id="tools" no="03 · Tool Chips.md + Loading State.md" title="Plugin 執行過程" spec="plugin 執行的工具呼叫列、檔案 diff chips，以及 build 期間的 pixel loader 與計時。">
          <ToolsSection />
        </Section>
        <Section id="tasks" no="04 · Task Rows.md" title="Lifecycle 任務列" spec="brief → direction → build → critique → deliver 對應的可展開任務列，含進度環與狀態 pill。">
          <TasksSection />
        </Section>
        <Section id="direction" no="05 · approve.md" title="方向選擇卡" spec="awaiting_user 時的方向選擇：單選 + 自訂答案 + pager，取代現有 grid fallback。">
          <DirectionSection />
        </Section>
        <Section id="context" no="06 · Context Cards.md" title="參考與脈絡" spec="ReferenceImportPanel 與 provenance 的 chunk 卡：標題、摘要、來源 badge。">
          <ContextSection />
        </Section>
        <Section id="critique" no="07 · Streaming Text.md" title="Critique 回饋" spec="critique 結論以 streaming 文字呈現，附 citation chips 與 follow-ups。">
          <CritiqueStreamSection />
        </Section>
        <Section id="diff" no="08 · Diff Table.md" title="修訂比較" spec="artifact revision r1 → r2 的章節差異表：移除紅 tint 劃線、新增綠 tint。">
          <DiffTableSection />
        </Section>
        <Section id="deliver" no="09 · Recommendation Card.md" title="交付建議" spec="Deliver gate 的格式建議：信號 meter、alternatives drawer、主要確認鍵。">
          <DeliverSection />
        </Section>
        <Section id="code" no="10 · Code Block.md" title="匯出檔案預覽" spec="Deliver 後的 export.html 預覽：token 標註的語法著色與 Copy。">
          <CodeBlockSection />
        </Section>
      </div>
    </div>
  )
}
