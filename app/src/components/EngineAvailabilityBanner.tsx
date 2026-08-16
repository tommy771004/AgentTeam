import { useNavigate } from 'react-router-dom'
import { settingsPath } from '../commands/settingsSections'
import {
  ENGINE_BANNER_COPY,
  deriveEngineAvailabilityFromSettings,
} from '../agent/engineAvailability'
import { useSettingsStore } from '../store/settingsStore'
import { Icon } from './Icon'
import { reopenFirstRunWizard } from './FirstRunWizard'

/**
 * First-run honesty（ticket 03）：沒有任何可用執行引擎（語言模型未設、
 * 也無已授權 CLI）時，composer 上方的誠實警示橫幅。CTA 直達設定的語言模型節。
 * 可用性推導見 agent/engineAvailability.ts；顯示/消失完全由推導結果驅動。
 */
export function EngineAvailabilityBanner() {
  const settings = useSettingsStore((s) => s.settings)
  const lastTest = useSettingsStore((s) => s.lastConnectionTest)
  const navigate = useNavigate()
  // 消費最近一次連線測試結果：失敗會讓橫幅出現（誠實），尚未測試視為可用（對齊引擎語義）。
  const { bannerVisible } = deriveEngineAvailabilityFromSettings(
    settings,
    lastTest ? lastTest.ok : null,
  )
  if (!bannerVisible) return null

  return (
    <div
      role="status"
      data-testid="engine-availability-banner"
      className="animate-macos-enter flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/15 px-3.5 py-2.5 text-left"
    >
      <Icon name="warning" className="mt-0.5 shrink-0 text-amber-100" size={16} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-amber-100">{ENGINE_BANNER_COPY.title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-amber-100/85">{ENGINE_BANNER_COPY.body}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={() => navigate(settingsPath('llm', 'llm.apiKey'))}
          className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-500/30"
        >
          {ENGINE_BANNER_COPY.cta}
        </button>
        <button
          type="button"
          onClick={reopenFirstRunWizard}
          className="rounded-lg border border-amber-500/25 px-2.5 py-1 text-[11px] font-medium text-amber-100/85 transition-colors hover:bg-amber-500/15"
        >
          開啟設定精靈
        </button>
      </div>
    </div>
  )
}
