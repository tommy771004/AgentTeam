import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ThemePage } from '../components/SectionNav'
import {
  SettingsGroup,
  SettingsHeader,
  SettingsRow,
  SettingsToggle,
  settingsBtnCls,
  settingsBtnPrimaryCls,
} from '../components/settings/SettingsChrome'
import { useAgentStore } from '../store/agentStore'
import { useScheduleStore } from '../store/scheduleStore'
import { useSettingsStore } from '../store/settingsStore'
import { useGatewayStore } from '../store/gatewayStore'
import { statusZh } from '../i18n/zh'
import { getElectronBridgeStatus } from '../lib/electronBridge'
import {
  isRunQueueDraining,
  listQueuedRuns,
  queueLength,
  subscribeRunQueue,
} from '../agent/runQueue'
import { usePermissionAskStore } from '../store/permissionAskStore'
import { effectiveOutboundGuardFromSettings } from '../agent/outbound/outboundGate.ts'

const SECTIONS = [
  { id: 'overview', label: '運行狀態', icon: 'monitoring' },
  { id: 'models', label: '子代理模型', icon: 'hub' },
  { id: 'webhook', label: 'Webhook', icon: 'webhook' },
  { id: 'archive', label: '近期封存', icon: 'history' },
]

const META: Record<string, { title: string; subtitle: string }> = {
  overview: {
    title: '運行狀態',
    subtitle: '執行環境、代理狀態與排程心跳。',
  },
  models: {
    title: '子代理模型',
    subtitle: '各角色目前使用的模型（可在設定中調整）。',
  },
  webhook: {
    title: 'Webhook',
    subtitle: '本機主動觸發接收端狀態。',
  },
  archive: {
    title: '近期封存',
    subtitle: '最近幾次執行結果摘要。',
  },
}

type WebhookSt = {
  running: boolean
  port: number
  url: string | null
  hitCount: number
  lastError: string | null
}

export function DashboardPage() {
  const [section, setSection] = useState('overview')
  const agent = useAgentStore((s) => s.agent)
  const isRunning = useAgentStore((s) => s.isRunning)
  const archive = useAgentStore((s) => s.archive)
  const loadArchive = useAgentStore((s) => s.loadArchive)
  const { jobs, events, load: loadSchedule, lastTickAt } = useScheduleStore()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.update)
  const [webhook, setWebhook] = useState<WebhookSt | null>(null)
  const [whBusy, setWhBusy] = useState(false)
  const [platform, setPlatform] = useState('—')
  const [version, setVersion] = useState('—')
  const [userData, setUserData] = useState('—')
  const bridge = useMemo(() => getElectronBridgeStatus(), [])

  useEffect(() => {
    void loadSchedule()
    void loadArchive()
    void (async () => {
      if (window.subagents?.platform) setPlatform(await window.subagents.platform())
      if (window.subagents?.version) setVersion(await window.subagents.version())
      if (window.subagents?.userDataPath) setUserData(await window.subagents.userDataPath())
      if (window.subagents?.webhook?.status) setWebhook(await window.subagents.webhook.status())
    })()
    const t = window.setInterval(() => {
      void window.subagents?.webhook?.status().then(setWebhook)
    }, 5000)
    return () => clearInterval(t)
  }, [loadSchedule, loadArchive])

  const enabledJobs = jobs.filter((j) => j.enabled).length
  const enabledEvents = events.filter((e) => e.enabled).length
  const recent = archive.slice(0, 5)
  const meta = META[section] || META.overview
  const bgJobs = useGatewayStore((s) => s.jobs)
  const [qLen, setQLen] = useState(() => queueLength())
  const [qDraining, setQDraining] = useState(() => isRunQueueDraining())
  const hitlStats = usePermissionAskStore((s) => s.stats)
  const resetHitlStats = usePermissionAskStore((s) => s.resetStats)

  useEffect(() => {
    return subscribeRunQueue(() => {
      setQLen(queueLength())
      setQDraining(isRunQueueDraining())
    })
  }, [])

  return (
    <ThemePage
      title="系統總覽"
      sections={SECTIONS}
      activeId={section}
      onChange={setSection}
    >
      <SettingsHeader title={meta.title} subtitle={meta.subtitle} />

      <SettingsGroup title="即時指標">
        <SettingsRow
          title="代理"
          description="目前執行狀態"
          control={
            <span
              className={`text-[13px] font-semibold ${
                isRunning ? 'text-primary' : 'text-on-surface'
              }`}
            >
              {isRunning ? '執行中' : statusZh(agent.status) || '閒置'}
            </span>
          }
        />
        <SettingsRow
          title="已啟用任務"
          control={<span className="text-[13px] font-semibold tabular-nums">{enabledJobs}</span>}
        />
        <SettingsRow
          title="事件規則"
          control={
            <span className="text-[13px] font-semibold tabular-nums">{enabledEvents}</span>
          }
        />
        <SettingsRow
          title="Webhook"
          control={
            <span
              className={`text-[13px] font-semibold ${
                webhook?.running ? 'text-primary' : 'text-outline'
              }`}
            >
              {webhook?.running ? '線上' : '關閉'}
            </span>
          }
        />
        <SettingsRow
          title="自動化佇列"
          description={
            qDraining
              ? '消化中'
              : qLen > 0
                ? `待跑 ${qLen} · ${listQueuedRuns()[0]?.sourceLabel || '…'}`
                : '空'
          }
          control={
            <span
              className={`text-[13px] font-semibold tabular-nums ${
                qLen > 0 ? 'text-primary' : 'text-outline'
              }`}
            >
              {qLen}
            </span>
          }
        />
        <SettingsRow
          title="背景委派"
          description={settings.subAgentsEnabled === true ? 'delegate_task background' : 'Sub Agent 已關閉'}
          control={
            <span className="text-[13px] font-semibold tabular-nums">
              {bgJobs.filter((j) => j.status === 'running' || j.status === 'queued').length}
              <span className="text-outline font-normal"> / {bgJobs.length}</span>
            </span>
          }
        />
        <SettingsRow
          title="HITL 核准"
          description={
            hitlStats.timedOut > 0
              ? `逾時 ${hitlStats.timedOut}（最近：${hitlStats.recentTimeouts[0]?.tool || '—'}）`
              : '允許 / 拒絕 / 逾時'
          }
          control={
            <span className="text-[13px] font-semibold tabular-nums text-on-surface">
              <span className="text-primary">{hitlStats.allowed}</span>
              <span className="text-outline"> / </span>
              <span className="text-error">{hitlStats.denied}</span>
              <span className="text-outline"> / </span>
              <span className="text-amber-300">{hitlStats.timedOut}</span>
            </span>
          }
        />
      </SettingsGroup>

      {section === 'overview' && (
        <>
          <SettingsGroup title="執行環境">
            <SettingsRow title="Electron 橋接" control={<Mono>{bridge.label}</Mono>} />
            {bridge.detail && (
              <div className="px-4 py-2 text-[11px] text-amber-200/90 leading-relaxed">
                {bridge.detail}
              </div>
            )}
            <SettingsRow title="平台" control={<Mono>{platform}</Mono>} />
            <SettingsRow title="應用版本" control={<Mono>{version}</Mono>} />
            <SettingsRow
              title="Build flavor"
              control={
                <Mono>
                  {typeof process !== 'undefined' &&
                  (process as { env?: Record<string, string | undefined> }).env
                    ?.SUBAGENTS_BUILD_FLAVOR === 'policy-admin'
                    ? 'policy-admin'
                    : 'standard'}
                </Mono>
              }
            />
            <SettingsRow
              title="出站閘門"
              control={
                <Mono>
                  {(() => {
                    // Ticket 16: posture from hydrated settings (main-owned deploy),
                    // not empty renderer process env.
                    const deploy = settings.outboundGuardDeploy || 'off'
                    const effective = effectiveOutboundGuardFromSettings(settings)
                    return deploy === effective
                      ? deploy
                      : `${deploy}→${effective}`
                  })()}
                </Mono>
              }
            />
            <SettingsRow
              title="LLM"
              control={
                <Mono>{settings.enabled ? `開啟 · ${settings.model}` : '關閉（模擬）'}</Mono>
              }
            />
            <SettingsRow
              title="Function Calling"
              control={<Mono>{settings.functionCalling !== false ? '啟用' : '關閉'}</Mono>}
            />
            <SettingsRow
              title="工具"
              control={<Mono>{settings.toolsEnabled !== false ? '啟用' : '關閉'}</Mono>}
            />
            <SettingsRow title="授權等級" control={<Mono>{String(settings.authLevel)}</Mono>} />
            <SettingsRow title="使用者資料" control={<Mono>{userData}</Mono>} />
            <SettingsRow
              title="排程心跳"
              control={
                <Mono>
                  {lastTickAt ? new Date(lastTickAt).toLocaleString() : '—'}
                </Mono>
              }
            />
          </SettingsGroup>
          {agent.id && (
            <SettingsGroup title="目前執行">
              <SettingsRow title="狀態" control={<Mono>{statusZh(agent.status)}</Mono>} />
              <SettingsRow title="進度" control={<Mono>{agent.progress}%</Mono>} />
              <SettingsRow title="工具呼叫" control={<Mono>{agent.toolCalls.length}</Mono>} />
              <SettingsRow title="Tokens" control={<Mono>{agent.tokensUsed}</Mono>} />
            </SettingsGroup>
          )}
          {(hitlStats.allowed > 0 || hitlStats.denied > 0 || hitlStats.timedOut > 0) && (
            <SettingsGroup title="HITL 詳情（本工作階段）">
              <SettingsRow
                title="允許"
                control={<Mono className="text-primary">{String(hitlStats.allowed)}</Mono>}
              />
              <SettingsRow
                title="拒絕"
                control={<Mono className="text-error">{String(hitlStats.denied)}</Mono>}
              />
              <SettingsRow
                title="逾時自動拒絕"
                description="無人值守 45s / 互動 90s"
                control={<Mono className="text-amber-300">{String(hitlStats.timedOut)}</Mono>}
              />
              {hitlStats.recentTimeouts.length > 0 && (
                <div className="px-4 py-2 space-y-1">
                  <p className="text-[10px] tracking-widest text-outline">最近逾時工具</p>
                  {hitlStats.recentTimeouts.slice(0, 5).map((t, i) => (
                    <p
                      key={`${t.at}-${i}`}
                      className="text-[11px] font-[family-name:var(--font-mono)] text-on-surface-variant"
                    >
                      {t.tool} · {new Date(t.at).toLocaleTimeString()}
                    </p>
                  ))}
                </div>
              )}
              <div className="px-4 py-2">
                <button type="button" className={settingsBtnCls} onClick={() => resetHitlStats()}>
                  重設 HITL 統計
                </button>
              </div>
            </SettingsGroup>
          )}

          <div className="flex flex-wrap gap-2 px-0.5">
            <Link to="/" className={settingsBtnPrimaryCls}>
              新任務
            </Link>
            <Link to="/automation" className={settingsBtnCls}>
              自動化 / 佇列
            </Link>
            <Link to="/records?tab=logs" className={settingsBtnCls}>
              開啟日誌
            </Link>
          </div>
        </>
      )}

      {section === 'models' && (
        <>
          <SettingsGroup title="角色模型">
            <SettingsRow
              title="Sub Agent"
              control={<Mono>{settings.subAgentsEnabled === true ? '啟用' : '關閉（預設）'}</Mono>}
            />
            <SettingsRow
              title="Manager"
              control={<Mono>{settings.subAgentsEnabled === true ? (settings.roleModels?.orchestrator || settings.model || '—') : '未套用'}</Mono>}
            />
            <SettingsRow
              title="Analyzer-1"
              control={<Mono>{settings.subAgentsEnabled === true ? (settings.roleModels?.analyst || settings.model || '—') : '未套用'}</Mono>}
            />
            <SettingsRow
              title="Writer"
              control={<Mono>{settings.subAgentsEnabled === true ? (settings.roleModels?.synthesizer || settings.model || '—') : '未套用'}</Mono>}
            />
            <SettingsRow
              title="Core"
              control={<Mono>{settings.subAgentsEnabled === true ? (settings.roleModels?.executor || settings.model || '—') : '未套用'}</Mono>}
            />
          </SettingsGroup>
          {agent.subAgents.length > 0 && (
            <SettingsGroup title="作用中子代理">
              {agent.subAgents.map((a) => (
                <SettingsRow
                  key={a.id}
                  title={a.name}
                  control={
                    <Mono>
                      {a.status === 'active'
                        ? '作用中'
                        : a.status === 'done'
                          ? '完成'
                          : a.status === 'error'
                            ? '錯誤'
                            : '待命'}
                    </Mono>
                  }
                />
              ))}
            </SettingsGroup>
          )}
          <Link to="/settings" className={settingsBtnPrimaryCls + ' self-start'}>
            前往設定
          </Link>
        </>
      )}

      {section === 'webhook' && (
        <>
          <SettingsGroup title="接收端">
            <SettingsRow
              title="啟用 Webhook"
              description="立即 start/stop 本機接收端（同設定頁）"
              control={
                <SettingsToggle
                  checked={settings.webhookEnabled === true}
                  disabled={whBusy}
                  onChange={(v) => {
                    setWhBusy(true)
                    void (async () => {
                      await updateSettings({ webhookEnabled: v })
                      try {
                        if (v && window.subagents?.webhook) {
                          const st = await window.subagents.webhook.start({
                            port: settings.webhookPort || 8787,
                            token: settings.webhookToken || '',
                          })
                          setWebhook(st)
                        } else if (window.subagents?.webhook) {
                          const st = await window.subagents.webhook.stop()
                          setWebhook(st)
                        }
                      } catch {
                        /* ignore */
                      } finally {
                        setWhBusy(false)
                      }
                    })()
                  }}
                />
              }
            />
            <SettingsRow
              title="狀態"
              control={<Mono>{webhook?.running ? '聆聽中' : '已停止'}</Mono>}
            />
            <SettingsRow title="URL" control={<Mono>{webhook?.url || '—'}</Mono>} />
            <SettingsRow
              title="命中次數"
              control={<Mono>{String(webhook?.hitCount ?? 0)}</Mono>}
            />
            <SettingsRow
              title="連接埠"
              control={<Mono>{String(settings.webhookPort || 8787)}</Mono>}
            />
            {webhook?.lastError && (
              <div className="px-4 py-2 text-[12px] text-error font-mono">{webhook.lastError}</div>
            )}
          </SettingsGroup>
          <div className="flex flex-wrap gap-2">
            <Link to="/automation?tab=events" className={settingsBtnCls}>
              事件規則
            </Link>
            <Link to="/automation" className={settingsBtnCls}>
              定時任務
            </Link>
            <Link to="/settings" className={settingsBtnPrimaryCls}>
              完整設定（Token／連接埠）
            </Link>
          </div>
        </>
      )}

      {section === 'archive' && (
        <SettingsGroup
          title="最近 5 筆"
          action={
            <Link to="/records" className="text-[12px] text-primary font-medium">
              查看全部
            </Link>
          }
        >
          {recent.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-outline text-center">尚無封存執行。</div>
          ) : (
            recent.map((r) => (
              <SettingsRow
                key={r.id}
                title={r.objective.slice(0, 80) || r.id}
                description={`${r.id.slice(0, 14)} · ${new Date(r.timestamp).toLocaleString()}`}
                control={
                  <span
                    className={`text-[11px] font-semibold ${
                      r.status === 'success'
                        ? 'text-primary'
                        : r.status === 'failed' || r.status === 'halted'
                          ? 'text-error'
                          : 'text-secondary'
                    }`}
                  >
                    {statusZh(r.status) || r.status}
                  </span>
                }
              />
            ))
          )}
        </SettingsGroup>
      )}
    </ThemePage>
  )
}

function Mono({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={`text-[12px] text-on-surface-variant font-[family-name:var(--font-mono)] text-right max-w-[280px] break-all ${className}`}
    >
      {children}
    </span>
  )
}
