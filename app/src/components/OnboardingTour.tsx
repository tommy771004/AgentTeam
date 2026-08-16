import { useEffect, useState } from 'react'
import { WIZARD_SETTLED_EVENT, isFirstRunWizardSettled } from './FirstRunWizard'
import { Icon } from './Icon'
import { settingsBtnCls, settingsBtnPrimaryCls } from './settings/SettingsChrome'

/**
 * Onboarding Tour（first-run honesty ticket 11）。
 *
 * Spotlight 式一次性導覽：四個概念點（Loop Pattern／執行引擎／Approval Mode／誠實性）。
 * 順序協調：首次設定精靈落定（完成或跳過）後才出現；完成／跳過持久化；
 * 設定 → 外觀提供「重新導覽」；Esc 視同跳過；動效掛 data-reduced-motion 閘門。
 */
const TOUR_STATE_KEY = 'subagents.onboardingTour.state.v1'
const REOPEN_EVENT = 'subagents:onboarding-tour:reopen'

/** 設定頁「重新導覽」入口 */
export function reopenOnboardingTour() {
  try {
    window.localStorage.removeItem(TOUR_STATE_KEY)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(REOPEN_EVENT))
}

type TourState = 'completed' | 'skipped'

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: 'all_inclusive',
    title: '四種 Loop Pattern',
    body: 'Turn 輕量問答一來一回；Goal 迭代到可量測的 DoD 滿足才算完成；Time（排程）與 Proactive（事件）只能從自動化頁的排程與事件證據觸發——對話文字永遠不會直接啟動它們。',
  },
  {
    icon: 'terminal',
    title: '執行引擎',
    body: '內建引擎有完整工具、HITL 核可與 DoD 驗證；外部 CLI（Codex、Claude 等）用你本機的既有登入執行，結果會誠實標示「外部 CLI 執行（未執行內建 DoD 驗證）」。',
  },
  {
    icon: 'shield',
    title: 'Approval Mode 三段',
    body: '要求核准——每個副作用工具都先問你；代我核准——只對高風險操作要求核准；完整存取權——不再打擾，但 deny 規則仍然生效。輸入框左下角隨時可切換。',
  },
  {
    icon: 'verified',
    title: '誠實性優先',
    body: '沒有可用引擎時，輸入框上方的橫幅會明白告訴你：任務會以本地模擬策略執行（run 摘要也會蓋「模擬執行」章）。我們不假裝完成——完成是量測出來的。',
  },
]

function readTourState(): TourState | null {
  try {
    const value = window.localStorage.getItem(TOUR_STATE_KEY)
    return value === 'completed' || value === 'skipped' ? value : null
  } catch {
    return null
  }
}

function writeTourState(value: TourState) {
  try {
    window.localStorage.setItem(TOUR_STATE_KEY, value)
  } catch {
    /* ignore */
  }
}

export function OnboardingTour() {
  const [tourState, setTourState] = useState<TourState | null>(() => readTourState())
  const [step, setStep] = useState(0)
  const [forcedOpen, setForcedOpen] = useState(false)
  const [wizardDone, setWizardDone] = useState(() => isFirstRunWizardSettled())

  const visible = tourState === null && (wizardDone || forcedOpen)

  // 精靈落定 / 重開事件 → 重新評估
  useEffect(() => {
    const reevaluate = () => {
      setWizardDone(isFirstRunWizardSettled())
    }
    const onReopen = () => {
      setTourState(null)
      setStep(0)
      setForcedOpen(true)
    }
    window.addEventListener(WIZARD_SETTLED_EVENT, reevaluate)
    window.addEventListener(REOPEN_EVENT, onReopen)
    return () => {
      window.removeEventListener(WIZARD_SETTLED_EVENT, reevaluate)
      window.removeEventListener(REOPEN_EVENT, onReopen)
    }
  }, [])

  // Esc 視同跳過（導覽開啟時）
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const skip = () => {
    writeTourState('skipped')
    setTourState('skipped')
    setForcedOpen(false)
  }
  const finish = () => {
    writeTourState('completed')
    setTourState('completed')
    setForcedOpen(false)
  }

  if (!visible) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-[115] bg-black/55 backdrop-blur-sm flex items-end justify-center p-6 pb-[10vh]"
      data-testid="onboarding-tour"
      role="dialog"
      aria-modal="true"
      aria-label="使用導覽"
    >
      <section className="app-panel no-drag animate-macos-enter max-w-xl w-full p-5">
        <div className="flex items-start gap-3.5">
          <span className="mt-0.5 shrink-0 rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
            <Icon name={current.icon} size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-widest text-outline">
              使用導覽 · {step + 1}/{STEPS.length}
            </p>
            <h2 className="mt-1 text-base font-semibold">{current.title}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-on-surface-variant">{current.body}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 w-6 rounded-full ${i === step ? 'bg-primary' : 'bg-outline/25'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={settingsBtnCls} onClick={skip}>
              跳過導覽
            </button>
            {step > 0 && (
              <button type="button" className={settingsBtnCls} onClick={() => setStep((v) => v - 1)}>
                上一步
              </button>
            )}
            <button
              type="button"
              className={settingsBtnPrimaryCls}
              onClick={() => (isLast ? finish() : setStep((v) => v + 1))}
            >
              {isLast ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
