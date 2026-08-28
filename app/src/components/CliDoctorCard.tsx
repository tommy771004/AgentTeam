import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { settingsBtnCls, settingsBtnPrimaryCls } from './settings/SettingsChrome'
import { useSettingsStore } from '../store/settingsStore'
import { sanitizeCliDoctorProviders, type CliDoctorReport } from '../agent/cliDoctor'
import { requestFocusComposer } from '../store/commandHistoryStore'

const DISMISS_KEY = 'subagents.cliDoctor.dismissed.v1'

const STATUS_LABEL: Record<string, string> = {
  ready: '可用',
  missing: '缺少',
  'needs-auth': '需登入',
}

export function CliDoctorCard({ onStartTask }: { onStartTask?: () => void }) {
  const providers = useSettingsStore((s) => s.settings.cliProviders)
  const [report, setReport] = useState<CliDoctorReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    const doctor = window.subagents?.cli?.doctor
    if (!doctor) return
    setBusy(true)
    setError(null)
    try {
      const next = await doctor(sanitizeCliDoctorProviders(providers || []))
      setReport(next as CliDoctorReport)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '環境檢查失敗，請稍後重試。')
    } finally {
      setBusy(false)
    }
  }, [providers])

  useEffect(() => {
    if (!dismissed) void run()
  }, [dismissed, run])

  if (dismissed || !window.subagents?.cli?.doctor) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      // Dismissal is a convenience; keep the card hidden for this session.
    }
    setDismissed(true)
  }

  return (
    <section className="app-panel w-full max-w-xl mt-8 mb-6 p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 shrink-0 text-primary">
            <Icon name="health_and_safety" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">首次啟動環境檢查</h2>
            <p className="mt-1 text-xs text-outline">
              檢查 Git、Codex、Claude Code、Grok、Gemini、Cursor 與其他本機 CLI；不會讀取或複製 token。
            </p>
          </div>
        </div>
        <button type="button" className="text-outline hover:text-on-surface" onClick={dismiss} title="稍後再檢查">
          <Icon name="close" size={16} />
        </button>
      </div>

      {busy && <p className="mt-4 text-xs text-outline">正在掃描本機環境…</p>}
      {error && <p className="mt-4 text-xs text-error">{error}</p>}
      {report && (
        <>
          <p className={`mt-4 text-xs ${report.readyToRun ? 'text-primary' : 'text-secondary'}`}>
            {report.summary}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.checks.map((check) => (
              <div key={check.id} className="rounded-card border border-line bg-inset px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">{check.label}</span>
                  <span
                    className={`text-[10px] font-semibold ${
                      check.status === 'ready'
                        ? 'text-primary'
                        : check.status === 'needs-auth'
                          ? 'text-secondary'
                          : 'text-error'
                    }`}
                  >
                    {STATUS_LABEL[check.status] || check.status}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-outline break-words">{check.detail}</p>
                {check.status !== 'ready' && <p className="mt-1 text-[11px] text-on-surface-variant">{check.remediation}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {report?.readyToRun && (
          <button
            type="button"
            className={settingsBtnPrimaryCls}
            onClick={() => {
              dismiss()
              if (onStartTask) onStartTask()
              else requestFocusComposer({ openSlash: false })
            }}
          >
            開始首次任務
          </button>
        )}
        <button type="button" className={settingsBtnPrimaryCls} onClick={() => void run()} disabled={busy}>
          {busy ? '檢查中…' : '重新檢查'}
        </button>
        <Link to="/settings" className={settingsBtnCls}>
          CLI 設定
        </Link>
      </div>
    </section>
  )
}
