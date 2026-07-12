import { useEffect, useRef } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtocolsPage } from './pages/ProtocolsPage'
import { DocsPage } from './pages/DocsPage'
import { ExecutionPage } from './pages/ExecutionPage'
import { SuccessPage } from './pages/SuccessPage'
import { FailedPage } from './pages/FailedPage'
import { SettingsPage } from './pages/SettingsPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { DashboardPage } from './pages/DashboardPage'
import { AutomationPage } from './pages/AutomationPage'
import { RecordsPage } from './pages/RecordsPage'
import { LearningPage } from './pages/LearningPage'
import { useSettingsStore } from './store/settingsStore'
import { useLearningStore } from './store/learningStore'
import { useScheduleStore } from './store/scheduleStore'
import { useAgentStore } from './store/agentStore'
import { useProjectStore } from './store/projectStore'
import {
  startBackgroundJobSubscription,
  useGatewayStore,
} from './store/gatewayStore'
import { PermissionAskModal } from './components/PermissionAskModal'
import { QuestionAskModal } from './components/QuestionAskModal'
import type { ScheduledJob } from './agent/types'

/** Restore automation queue from disk and drain when idle */
function RunQueueBootstrap() {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { hydrateRunQueue, queueLength, drainExternalRunQueue } = await import(
        './agent/runQueue'
      )
      const n = hydrateRunQueue()
      if (n > 0) {
        void window.subagents?.notify?.(
          'SubAgents AI · 佇列',
          `已恢復 ${n} 筆待跑自動化任務`,
        )
      }
      // Let schedule/settings hydrate first
      await new Promise((r) => setTimeout(r, 900))
      if (cancelled) return
      if (useAgentStore.getState().isRunning || queueLength() === 0) return
      const { runExternalObjective } = await import('./agent/runExternal')
      await drainExternalRunQueue((o) =>
        runExternalObjective({ ...o, _fromQueue: true }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return null
}

function SchedulerBootstrap() {
  const navigate = useNavigate()
  const load = useScheduleStore((s) => s.load)
  const startTicker = useScheduleStore((s) => s.startTicker)
  const markJobResult = useScheduleStore((s) => s.markJobResult)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onDue = (job: ScheduledJob) => {
      void (async () => {
        await markJobResult(job.id, 'running')
        void window.subagents?.notify?.('SubAgents AI · 排程', `執行任務：${job.name}`)
        navigate('/')
        const { runExternalObjective } = await import('./agent/runExternal')
        const settleJob = async (r: {
          status: string
          skipped?: boolean
          queued?: boolean
          skipReason?: string
        }) => {
          if (r.skipped) {
            if (r.skipReason === 'cancelled') {
              await markJobResult(job.id, 'skipped')
              void window.subagents?.notify?.(
                'SubAgents AI · 排程',
                `任務 ${job.name}：已從佇列取消`,
              )
            }
            return
          }
          const ok = r.status === 'success'
          await markJobResult(job.id, ok ? 'success' : 'failed')
          void window.subagents?.notify?.(
            'SubAgents AI · 排程',
            `任務 ${job.name}：${ok ? '成功' : '失敗'}`,
          )
        }
        const r = await runExternalObjective({
          sourceKind: 'schedule',
          objective: job.objective,
          title: job.name || '排程',
          loopType: job.loopType || 'Time-based',
          attachedSkills: job.skillNames || [],
          runner: job.runner || 'builtin',
          projectRoot: job.projectRoot || undefined,
          sourceLabel: `定時任務：${job.name}`,
          unattended: true,
          // Durable across app restart (queue persistence rebinds via scheduleJobId)
          meta: { scheduleJobId: job.id },
          // In-memory path while app stays open
          onSettled: (result) => settleJob(result),
        })
        if (r.skipped) {
          if (r.queued) {
            void window.subagents?.notify?.(
              'SubAgents AI · 排程',
              `任務 ${job.name}：忙碌，已加入待跑佇列（完成後回寫狀態）`,
            )
            return
          }
          await markJobResult(job.id, 'skipped')
          void window.subagents?.notify?.(
            'SubAgents AI · 排程',
            `任務 ${job.name}：忙碌略過`,
          )
          return
        }
        // onSettled already called settleJob — do not double-mark
      })()
    }

    const stop = startTicker(onDue)
    return stop
  }, [startTicker, markJobResult, navigate])

  return null
}

/** Bridge Electron webhook HTTP hits → Proactive event matching → agent run */
function WebhookBootstrap() {
  const navigate = useNavigate()
  const matchEvent = useScheduleStore((s) => s.matchEvent)
  const recordEventTrigger = useScheduleStore((s) => s.recordEventTrigger)
  const load = useScheduleStore((s) => s.load)
  const settings = useSettingsStore((s) => s.settings)

  useEffect(() => {
    void load()
  }, [load])

  // Auto-start / stop webhook when settings say so (after load)
  useEffect(() => {
    if (!window.subagents?.webhook) return
    void (async () => {
      if (settings.webhookEnabled) {
        try {
          await window.subagents!.webhook!.start({
            port: settings.webhookPort || 8787,
            token: settings.webhookToken || '',
          })
        } catch {
          /* main may already own server */
        }
      } else {
        // P1: closing settings must stop existing listener/server
        try {
          await window.subagents!.webhook!.stop?.()
        } catch {
          /* ignore */
        }
      }
    })()
  }, [settings.webhookEnabled, settings.webhookPort, settings.webhookToken])

  useEffect(() => {
    if (!window.subagents?.webhook?.onEvent) return
    const unsub = window.subagents.webhook.onEvent((payload) => {
      const matched = matchEvent({
        source: payload.source || 'webhook.http',
        subject: payload.subject,
        hasAttachment: payload.hasAttachment,
        body: payload.body,
      })
      if (!matched) {
        void window.subagents?.notify?.(
          'SubAgents AI · Webhook',
          `沒有規則匹配：${payload.source || 'event'}`,
        )
        return
      }
      void (async () => {
        await recordEventTrigger(matched.id)
        void window.subagents?.notify?.(
          'SubAgents AI · Webhook',
          `已匹配 rule: ${matched.name}`,
        )
        navigate('/')
        const { runExternalObjective } = await import('./agent/runExternal')
        const body = (payload.body || '').trim()
        const subject = (payload.subject || '').trim()
        const extraParts = [
          subject ? `Subject: ${subject}` : '',
          payload.source ? `Source: ${payload.source}` : '',
          body ? body : '',
        ].filter(Boolean)
        const r = await runExternalObjective({
          sourceKind: 'webhook',
          objective: matched.objective,
          title: matched.name,
          loopType: 'Proactive',
          eventPreMatched: true,
          sourceLabel: `Webhook 事件：${matched.name}`,
          unattended: true,
          extraContext: extraParts.length
            ? extraParts.join('\n\n').slice(0, 12_000)
            : undefined,
        })
        if (r.skipped) {
          void window.subagents?.notify?.(
            'SubAgents AI · Webhook',
            r.queued
              ? `已匹配 ${matched.name}：忙碌，已加入待跑佇列`
              : `已匹配 ${matched.name}，但代理忙碌 — 已略過`,
          )
        }
      })()
    })
    return () => {
      unsub()
    }
  }, [matchEvent, recordEventTrigger, navigate])

  return null
}

/** Telegram messaging gateway + background job notifications */
function GatewayBootstrap() {
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const pushInbound = useGatewayStore((s) => s.pushInbound)
  const refreshStatus = useGatewayStore((s) => s.refreshStatus)

  useEffect(() => {
    return startBackgroundJobSubscription()
  }, [])

  // Auto-start telegram from settings
  useEffect(() => {
    const gw = window.subagents?.gateway
    if (!gw) return
    void (async () => {
      if (settings.telegramEnabled && settings.telegramBotToken) {
        try {
          await gw.telegramStart({
            token: settings.telegramBotToken,
            allowedChatIds: settings.telegramAllowedChatIds || '',
          })
        } catch {
          /* main may already own poller */
        }
      } else {
        try {
          await gw.telegramStop()
        } catch {
          /* ignore */
        }
      }
      await refreshStatus()
    })()
  }, [
    settings.telegramEnabled,
    settings.telegramBotToken,
    settings.telegramAllowedChatIds,
    refreshStatus,
  ])

  useEffect(() => {
    if (!window.subagents?.gateway?.onInbound) return
    const unsub = window.subagents.gateway.onInbound((msg) => {
      pushInbound(msg)

      const text = (msg.text || '').trim()
      const rawAtts = (
        msg as {
          attachments?: Array<{
            name: string
            mimeType: string
            kind: 'image' | 'text' | 'binary'
            dataUrl?: string
            size?: number
          }>
        }
      ).attachments
      if ((text === '/ping' || text === '/status') && !rawAtts?.length) {
        void window.subagents?.gateway?.send({
          channel: msg.channel,
          chatId: msg.chatId,
          text: `SubAgents AI 在線 · running=${useAgentStore.getState().isRunning}`,
          token: useSettingsStore.getState().settings.telegramBotToken || undefined,
        })
        return
      }

      const s = useSettingsStore.getState().settings
      if (!s.telegramAutoRun) return
      if (!text && !rawAtts?.length) return

      void (async () => {
        void window.subagents?.notify?.(
          'SubAgents AI · Telegram',
          `${msg.from || msg.chatId}: ${(text || '（附件）').slice(0, 80)}`,
        )
        navigate('/')
        const { runExternalObjective } = await import('./agent/runExternal')
        const attachments = (rawAtts || [])
          .filter((a) => a.dataUrl || a.kind === 'text')
          .map((a, i) => ({
            id: `tg_${Date.now().toString(36)}_${i}`,
            kind: a.kind === 'image' ? ('image' as const) : a.kind === 'text' ? ('text' as const) : ('binary' as const),
            name: a.name || `tg-${i}`,
            mimeType: a.mimeType || 'application/octet-stream',
            size: a.size || 0,
            dataUrl: a.dataUrl,
          }))
        // Goal-based: free-form chat, not event-predicate language
        const replyTelegram = async (summary: string) => {
          if (!s.telegramReplyWithResult) return
          await window.subagents?.gateway?.send({
            channel: msg.channel,
            chatId: msg.chatId,
            text: summary.slice(0, 3500),
            token: s.telegramBotToken || undefined,
          })
        }
        const r = await runExternalObjective({
          sourceKind: 'telegram',
          objective: text || (attachments.length ? '請分析我附上的圖片或檔案。' : ''),
          title: `TG ${msg.chatId}`,
          loopType: 'Goal-based',
          sourceLabel: `Telegram · ${msg.from || msg.chatId}`,
          unattended: true,
          attachments: attachments.length ? attachments : undefined,
          extraContext: attachments.length
            ? `Telegram 附件 ${attachments.length} 個（已下載）`
            : undefined,
          // P1: reply after queue drain as well
          onSettled: async (result) => {
            if (!s.telegramReplyWithResult) return
            const agent = useAgentStore.getState().agent
            const summary =
              agent.result?.slice(0, 3500) ||
              result.result?.slice(0, 3500) ||
              `狀態：${result.status}`
            await replyTelegram(summary)
          },
        })
        if (r.skipped) {
          await window.subagents?.gateway?.send({
            channel: msg.channel,
            chatId: msg.chatId,
            text: r.queued
              ? '代理忙碌中，你的訊息已加入待跑佇列，稍後會自動執行並回覆。'
              : '代理忙碌中，請稍後再試。',
            token: s.telegramBotToken || undefined,
          })
          return
        }
        // Non-queued: onSettled already sent telegram reply when enabled
      })()
    })
    return () => {
      unsub()
    }
  }, [pushInbound, navigate])

  return null
}

/** Apply ChatGPT-style general/appearance prefs to document */
function PreferencesBootstrap() {
  const settings = useSettingsStore((s) => s.settings)
  const isRunning = useAgentStore((s) => s.isRunning)
  const agentStatus = useAgentStore((s) => s.agent.status)

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => {
      const theme = settings.theme || 'dark'
      if (theme === 'system') {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.setAttribute('data-theme', dark ? 'dark' : 'light')
      } else {
        root.setAttribute('data-theme', theme)
      }
    }
    applyTheme()

    let reduced = settings.reducedMotion || 'system'
    if (reduced === 'system') {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'on'
        : 'off'
    }
    root.setAttribute('data-reduced-motion', reduced === 'on' ? 'on' : 'off')
    root.setAttribute(
      'data-sidebar-solid',
      settings.translucentSidebar === false ? 'true' : 'false',
    )
    root.style.setProperty('--app-ui-font-size', `${settings.uiFontSize || 14}px`)
    root.style.setProperty('--app-code-font-size', `${settings.codeFontSize || 13}px`)

    // Live follow system theme / reduced motion
    const mqTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onTheme = () => {
      if ((settings.theme || 'dark') === 'system') applyTheme()
    }
    const onMotion = () => {
      if ((settings.reducedMotion || 'system') === 'system') {
        root.setAttribute(
          'data-reduced-motion',
          mqMotion.matches ? 'on' : 'off',
        )
      }
    }
    mqTheme.addEventListener('change', onTheme)
    mqMotion.addEventListener('change', onMotion)
    return () => {
      mqTheme.removeEventListener('change', onTheme)
      mqMotion.removeEventListener('change', onMotion)
    }
  }, [settings])

  // Notify on run complete (ChatGPT Notifications) — only after a real run ends
  const wasRunning = useRef(false)
  useEffect(() => {
    if (isRunning) {
      wasRunning.current = true
      return
    }
    if (!wasRunning.current) return
    wasRunning.current = false
    if (!['success', 'failed', 'halted'].includes(agentStatus)) return
    if (settings.notifyOnComplete === false) return
    const label =
      agentStatus === 'success' ? '完成' : agentStatus === 'halted' ? '已中止' : '失敗'
    void window.subagents?.notify?.('SubAgents AI', `任務${label}`)
    if (settings.soundOnComplete) {
      try {
        const ctx = new AudioContext()
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g)
        g.connect(ctx.destination)
        o.frequency.value = agentStatus === 'success' ? 880 : 220
        g.gain.value = 0.04
        o.start()
        o.stop(ctx.currentTime + 0.12)
        void ctx.close()
      } catch {
        /* ignore */
      }
    }
  }, [isRunning, agentStatus, settings.notifyOnComplete, settings.soundOnComplete])

  // Best-effort prevent sleep while running
  useEffect(() => {
    if (!settings.preventSleepWhileRunning) return
    if (!isRunning) return
    let released = false
    const release = () => {
      if (released) return
      released = true
      void window.subagents?.power?.allowSleep?.()
    }
    void window.subagents?.power?.preventSleep?.()
    return () => release()
  }, [isRunning, settings.preventSleepWhileRunning])

  return null
}

function PluginTokenRefreshBootstrap() {
  const start = useLearningStore((s) => s.startTokenRefreshScheduler)
  const stop = useLearningStore((s) => s.stopTokenRefreshScheduler)
  const loaded = useLearningStore((s) => s.loaded)

  useEffect(() => {
    if (!loaded) return
    start()
    return () => stop()
  }, [loaded, start, stop])

  return null
}

/** When project root changes, rebind npm-mcp ${projectRoot} args + restart sessions */
function PluginProjectRebindBootstrap() {
  const rebind = useLearningStore((s) => s.rebindPluginProjectRoots)
  useEffect(() => {
    return useProjectStore.subscribe((s, prev) => {
      if (s.root && s.root !== prev.root) {
        void rebind(s.root)
      }
    })
  }, [rebind])
  return null
}

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load)
  const loadLearning = useLearningStore((s) => s.load)

  useEffect(() => {
    void loadSettings()
    void loadLearning()
    // OpenCode config merge (opencode.json + agents/*.md)
    void import('./store/opencodeConfigStore').then(({ useOpenCodeConfigStore }) => {
      void useOpenCodeConfigStore.getState().hydrate()
    })
    void import('./store/projectStore').then(({ useProjectStore }) => {
      // re-hydrate when project root changes
      useProjectStore.subscribe((s, prev) => {
        if (s.root !== prev.root) {
          void import('./store/opencodeConfigStore').then(({ useOpenCodeConfigStore }) => {
            void useOpenCodeConfigStore.getState().hydrate(s.root)
          })
        }
      })
    })
  }, [loadSettings, loadLearning])

  return (
    <HashRouter>
      <PreferencesBootstrap />
      <RunQueueBootstrap />
      <SchedulerBootstrap />
      <WebhookBootstrap />
      <GatewayBootstrap />
      <PluginTokenRefreshBootstrap />
      <PluginProjectRebindBootstrap />
      <PermissionAskModal />
      <QuestionAskModal />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ProtocolsPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="workspace" element={<Navigate to="/" replace />} />
          <Route path="learning" element={<LearningPage />} />
          <Route path="execution" element={<ExecutionPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="success" element={<SuccessPage />} />
          <Route path="failed" element={<FailedPage />} />
          <Route path="scheduler" element={<Navigate to="/automation" replace />} />
          <Route path="events" element={<Navigate to="/automation?tab=events" replace />} />
          <Route path="archive" element={<Navigate to="/records" replace />} />
          <Route path="logs" element={<Navigate to="/records?tab=logs" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
