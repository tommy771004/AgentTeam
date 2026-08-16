import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deriveEngineAvailabilityFromSettings } from '../agent/engineAvailability'
import { useSettingsStore } from '../store/settingsStore'
import { Icon } from './Icon'
import { settingsBtnCls, settingsBtnPrimaryCls } from './settings/SettingsChrome'

/**
 * First-run honesty（ticket 07）— 首次設定精靈。
 *
 * 全新 profile（未完成且未跳過）且沒有任何可用引擎時自動出現：
 * 選路徑（內建 LLM／外部 CLI）→ 憑證 → 測試連線 → 完成。
 * 可上一步／跳過（Esc 視同跳過）；狀態持久化於 localStorage。
 * 已有可用引擎的使用者靜默標記 completed、不打擾。
 */
const STATE_KEY = 'subagents.firstRunWizard.state.v1'
const REOPEN_EVENT = 'subagents:first-run-wizard:reopen'
/** 精靈落定（完成/跳過）後通知 onboarding tour 接棒 */
export const WIZARD_SETTLED_EVENT = 'subagents:first-run-wizard:settled'

/**
 * 重開精靈（ticket 08）：誠實性橫幅與設定頁的重開入口。
 * 清除持久化狀態並廣播事件；掛載中的精靈監聽後重置並顯示。
 */
export function reopenFirstRunWizard() {
  try {
    window.localStorage.removeItem(STATE_KEY)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(REOPEN_EVENT))
}

type WizardState = 'completed' | 'skipped'
type Step = 'path' | 'llm' | 'cli' | 'test' | 'done'

function readWizardState(): WizardState | null {
  try {
    const value = window.localStorage.getItem(STATE_KEY)
    return value === 'completed' || value === 'skipped' ? value : null
  } catch {
    return null
  }
}

function writeWizardState(value: WizardState) {
  try {
    window.localStorage.setItem(STATE_KEY, value)
  } catch {
    /* persistence is convenience; the session state still closes the wizard */
  }
}

const STEP_TITLE: Record<Step, string> = {
  path: '選擇執行方式',
  llm: '設定語言模型',
  cli: '授權外部 CLI',
  test: '驗證連線',
  done: '準備完成',
}

export function FirstRunWizard() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const testConnection = useSettingsStore((s) => s.testConnection)
  const [wizardState, setWizardState] = useState<WizardState | null>(() => readWizardState())
  // 可見性在 mount 時凍結：精靈進行中即使引擎轉為可用（填完金鑰）也不中途消失，
  // 使用者仍應走完連線驗證；「靜默完成」只發生在 mount 當下。
  const [initiallyVisible] = useState(
    () =>
      readWizardState() === null &&
      !deriveEngineAvailabilityFromSettings(
        useSettingsStore.getState().settings,
        null,
      ).anyEngineUsable,
  )
  const [step, setStep] = useState<Step>('path')
  const [llmPath, setLlmPath] = useState(true)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [forcedOpen, setForcedOpen] = useState(false)

  const visible = wizardState === null && (initiallyVisible || forcedOpen)

  // 重開入口（橫幅／設定頁）：重置步驟與草稿後顯示
  useEffect(() => {
    const onReopen = () => {
      setWizardState(null)
      setStep('path')
      setLlmPath(true)
      setApiKeyDraft('')
      setTesting(false)
      setTestResult(null)
      setTestMessage(null)
      setForcedOpen(true)
    }
    window.addEventListener(REOPEN_EVENT, onReopen)
    return () => window.removeEventListener(REOPEN_EVENT, onReopen)
  }, [])

  // mount 時已有可用引擎 → 靜默標記完成，避免日後停用 LLM 時跳出。
  useEffect(() => {
    if (!initiallyVisible && readWizardState() === null) {
      writeWizardState('completed')
      setWizardState('completed')
    }
  }, [initiallyVisible])

  // Esc 視同跳過（overlay 開啟時）
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const skip = () => {
    writeWizardState('skipped')
    setWizardState('skipped')
    window.dispatchEvent(new CustomEvent(WIZARD_SETTLED_EVENT))
  }
  const complete = () => {
    writeWizardState('completed')
    setWizardState('completed')
    window.dispatchEvent(new CustomEvent(WIZARD_SETTLED_EVENT))
  }

  if (!visible) return null

  const runTest = async () => {
    setTesting(true)
    setTestMessage(null)
    try {
      const result = await testConnection()
      setTestResult(result.ok)
      setTestMessage(result.ok ? '連線測試通過，任務將以真實模型執行。' : result.message)
    } finally {
      setTesting(false)
    }
  }

  const cliAuthorized =
    settings.cliProviders.filter((p) => p.enabled && p.authorized).length > 0
  const testPassed = llmPath ? testResult === true : cliAuthorized

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
      <section
        className="app-panel no-drag max-w-lg w-full p-6 text-left"
        data-testid="first-run-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="首次設定精靈"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">首次設定 · {STEP_TITLE[step]}</h2>
            <p className="mt-1 text-xs text-outline">
              設定一種執行引擎，任務就會以真實模型執行；跳過的話，任務會以本地模擬策略執行。
            </p>
          </div>
          <button type="button" className="text-outline hover:text-on-surface" onClick={skip} title="稍後再說（Esc）">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {(['path', 'llm', 'test', 'done'] as const).map((marker, index) => {
            const active =
              step === marker ||
              (marker === 'llm' && (step === 'llm' || step === 'cli')) ||
              (marker === 'done' && step === 'done')
            const passed =
              (marker === 'path' && step !== 'path') ||
              (marker === 'llm' && step === 'test') ||
              (marker === 'test' && step === 'done')
            return (
              <span
                key={marker}
                className={`h-1 flex-1 rounded-full ${
                  active || passed ? 'bg-primary' : 'bg-outline/25'
                }`}
                style={{ opacity: index > 2 && llmPath === false ? 0.4 : 1 }}
              />
            )
          })}
        </div>

        {step === 'path' && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-card border border-line bg-inset p-4 text-left transition-colors hover:border-primary/50"
              onClick={() => {
                setLlmPath(true)
                setStep('llm')
              }}
            >
              <Icon name="smart_toy" size={20} className="text-primary" />
              <p className="mt-2 text-sm font-semibold">內建語言模型</p>
              <p className="mt-1 text-[11px] leading-snug text-outline">
                填入 OpenAI 相容 API 金鑰即可；支援自訂 Base URL 與備援模型。
              </p>
            </button>
            <button
              type="button"
              className="rounded-card border border-line bg-inset p-4 text-left transition-colors hover:border-primary/50"
              onClick={() => {
                setLlmPath(false)
                setStep('cli')
              }}
            >
              <Icon name="terminal" size={20} className="text-primary" />
              <p className="mt-2 text-sm font-semibold">外部 CLI</p>
              <p className="mt-1 text-[11px] leading-snug text-outline">
                使用本機 Codex／Claude 等既有登入執行；不複製 token。
              </p>
            </button>
          </div>
        )}

        {step === 'llm' && (
          <div className="mt-5">
            <label className="block text-xs font-medium" htmlFor="wizard-api-key">
              API 金鑰
            </label>
            <input
              id="wizard-api-key"
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-line bg-inset px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
            <p className="mt-2 text-[11px] text-outline">
              僅存於本機。供應商與 Base URL 等進階選項可稍後在
              <Link to="/settings?section=llm" className="mx-0.5 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                設定 → 語言模型
              </Link>
              調整。
            </p>
          </div>
        )}

        {step === 'cli' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm leading-relaxed">
              前往
              <Link to="/settings?section=cli" className="mx-0.5 text-primary hover:underline">
                設定 → CLI 授權
              </Link>
              勾選並授權你要使用的 CLI（Codex、Claude、OpenCode 等），完成後回到這裡驗證。
            </p>
            <p className="text-[11px] text-outline">掃描只偵測執行檔位置與登入狀態，不會讀取或複製 token。</p>
          </div>
        )}

        {step === 'test' && (
          <div className="mt-5 space-y-3">
            {llmPath ? (
              <>
                <p className="text-sm">以你填入的金鑰向語言模型發送一次最小請求，確認真的可用。</p>
                <button type="button" className={settingsBtnPrimaryCls} disabled={testing} onClick={() => void runTest()}>
                  {testing ? '測試中…' : '測試連線'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm">檢查目前已授權的 CLI provider。</p>
                <p className={`text-sm font-medium ${cliAuthorized ? 'text-primary' : 'text-secondary'}`}>
                  {cliAuthorized ? '已偵測到授權的 CLI ✓' : '尚未偵測到已授權的 CLI'}
                </p>
              </>
            )}
            {testMessage && (
              <p className={`text-[11px] ${testPassed ? 'text-primary' : 'text-error'}`}>{testMessage}</p>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="mt-5 flex items-start gap-3">
            <Icon name="check_circle" size={22} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">已可執行真實任務</p>
              <p className="mt-1 text-[11px] text-outline">
                送出的任務將以真實引擎執行；之後仍可隨時在設定中調整模型或授權其他 CLI。
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button type="button" className={settingsBtnCls} onClick={skip}>
            稍後再說
          </button>
          <div className="flex gap-2">
            {step !== 'path' && step !== 'done' && (
              <button
                type="button"
                className={settingsBtnCls}
                onClick={() => {
                  if (step === 'llm' || step === 'cli') setStep('path')
                  else if (step === 'test') setStep(llmPath ? 'llm' : 'cli')
                }}
              >
                上一步
              </button>
            )}
            {step === 'llm' && (
              <button
                type="button"
                className={settingsBtnPrimaryCls}
                disabled={apiKeyDraft.trim().length === 0}
                onClick={() => {
                  void update({ enabled: true, apiKey: apiKeyDraft.trim() })
                  setTestResult(null)
                  setTestMessage(null)
                  setStep('test')
                }}
              >
                下一步
              </button>
            )}
            {step === 'cli' && (
              <button type="button" className={settingsBtnPrimaryCls} onClick={() => setStep('test')}>
                我已授權，驗證
              </button>
            )}
            {step === 'test' && (
              <button
                type="button"
                className={settingsBtnPrimaryCls}
                disabled={!testPassed}
                title={testPassed ? '' : llmPath ? '請先通過連線測試' : '請先在設定完成 CLI 授權'}
                onClick={() => setStep('done')}
              >
                完成
              </button>
            )}
            {step === 'done' && (
              <button type="button" className={settingsBtnPrimaryCls} onClick={complete}>
                開始使用
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
