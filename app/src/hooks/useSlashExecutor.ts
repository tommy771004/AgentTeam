import { useNavigate } from 'react-router-dom'
import { getLiveSlashCommands, type SlashCommand } from '../commands/registry'
import { expandCommandTemplate } from '../agent/opencode/configLoader'
import { useAgentStore } from '../store/agentStore'
import { useLearningStore } from '../store/learningStore'
import { useWorkspaceUiStore } from '../store/workspaceUiStore'
import { useSettingsStore } from '../store/settingsStore'
import { useCommandHistoryStore, useSessionStore } from '../store/commandHistoryStore'
import { useThreadStore } from '../store/threadStore'
import { listAllMcpTools } from '../agent/hermes/mcp'
import type { LoopType } from '../agent/types'
import { skillsStore } from '../agent/hermes/skills'
import { buildPromptLayers } from '../agent/hermes/promptBuilder'
import { getThinkingDepth, type ThinkingDepth } from '../agent/thinking'
import {
  parseSubagentMentions,
  getPrimaryAgent,
} from '../agent/opencode/agents'
import type { AgentMode } from '../agent/types'
import { useProjectStore } from '../store/projectStore'
import { projectContextUsage } from '../agent/contextUsageProjection'
import { contextUsageReportLines, resolveKnownContextWindow } from '../agent/contextUsageView'

/**
 * Shared slash command handler — Claude / Codex style
 */
export function useSlashExecutor() {
  const navigate = useNavigate()
  const {
    setDraftInput,
    setSelectedLoopType,
    stopExecution,
    getRunIdForThread,
    draftInput,
    isRunning,
    agent,
    selectedLoopType,
  } = useAgentStore()
  const { appendMemory, memory, refresh: refreshLearning } = useLearningStore()
  const ui = useWorkspaceUiStore()
  const settings = useSettingsStore((s) => s.settings)
  const projectRoot = () => useProjectStore.getState().root
  const sessionPush = useSessionStore((s) => s.push)
  const sessionClear = useSessionStore((s) => s.clear)
  const historyItems = useCommandHistoryStore((s) => s.items)

  const log = (line: string) => {
    ui.pushLog(line)
    sessionPush('system', line)
    const thr = useThreadStore.getState()
    if (thr.activeId) thr.pushBubble(thr.activeId, 'system', line)
  }

  /** Embedded run: stay on page, open Run panel — honors thread.runner (CLI or builtin) */
  const runEmbedded = async (goal: string, opts?: { skipUserBubble?: boolean }) => {
    const thr = useThreadStore.getState()
    const tid = thr.activeId
    const thread = thr.threads.find((t) => t.id === tid)
    const { subagents } = parseSubagentMentions(goal)
    if (tid) {
      if (subagents.length) {
        thr.pushBubble(tid, 'system', `Subagent: @${subagents.join(' @')}`)
      }
      if (thread?.runner && thread.runner !== 'builtin') {
        thr.pushBubble(
          tid,
          'system',
          `執行引擎：本機 ${thread.runner} CLI（使用既有登入）`,
        )
      }
    }
    setDraftInput(goal)
    // Single lifecycle controller (thread status / bubbles / busy policy / trace)
    const { runTask } = await import('../agent/taskRunCoordinator')
    const thrState = useThreadStore.getState()
    const active = thrState.threads.find((t) => t.id === tid)
    // Only force loop when thread/UI explicitly pinned; else auto-classify
    const loopType =
      active?.loopType ||
      useAgentStore.getState().selectedLoopType ||
      undefined
    const r = await runTask({
      objective: goal,
      sourceKind: 'slash',
      reuseThreadId: tid || undefined,
      skipUserBubble: opts?.skipUserBubble,
      runner: active?.runner,
      loopType: loopType || undefined,
      // Snapshot the project pinned at dispatch time — a concurrent run must not
      // silently re-resolve to whatever project the UI switches to mid-flight.
      projectRoot: projectRoot() || undefined,
    })
    if (r.skipped && !r.queued) {
      log(`✗ ${r.error || '忙碌中'}`)
    } else if (r.queued) {
      log('已加入待跑佇列，完成後自動執行')
    } else if (r.error && r.status === 'failed' && !r.result) {
      log(`✗ ${r.error}`)
    }
  }

  const run = async (cmd: SlashCommand, args: string, _raw: string) => {
    const name = cmd.name

    if (!cmd.description && name) {
      log(`未知指令：/${name} — 輸入 /help`)
      return
    }

    // OpenCode dynamic commands → expand template → run as task
    if (cmd.source === 'opencode' && cmd.template) {
      const prompt = expandCommandTemplate(cmd.template, args)
      if (!prompt.trim()) {
        log(`/${name} 模板為空`)
        return
      }
      log(`OpenCode command /${name}${cmd.agentHint ? ` · agent=${cmd.agentHint}` : ''}`)
      const thr = useThreadStore.getState()
      if (thr.activeId) {
        if (cmd.agentHint === 'plan' || cmd.agentHint === 'build') {
          thr.setAgentMode(thr.activeId, cmd.agentHint)
        }
        if (cmd.modelHint) thr.setModel(thr.activeId, cmd.modelHint)
        thr.pushBubble(thr.activeId, 'user', `/${name}${args ? ` ${args}` : ''}`)
        thr.pushBubble(thr.activeId, 'system', prompt.slice(0, 500))
      }
      await runEmbedded(prompt, { skipUserBubble: true })
      return
    }

    switch (name) {
      case 'help': {
        const all = getLiveSlashCommands()
        const byCat = new Map<string, string[]>()
        for (const c of all) {
          const k = c.category
          if (!byCat.has(k)) byCat.set(k, [])
          byCat.get(k)!.push(`/${c.name}`)
        }
        log(`共 ${all.length} 個指令（含 OpenCode）。⌘/ 開啟選單 · ↑ 歷史`)
        for (const [cat, names] of byCat) {
          log(`${cat}: ${names.slice(0, 12).join(' ')}${names.length > 12 ? ' …' : ''}`)
        }
        return
      }
      case 'clear':
      case 'new': {
        // 清掉目前對話自己的草稿，不只全域那份
        const thrState = useThreadStore.getState()
        if (thrState.activeId) thrState.setThreadDraft(thrState.activeId, '')
        setDraftInput('')
        ui.setComposer('')
        ui.clearLog()
        sessionClear()
        ui.pushLog('Session 已清空。輸入 / 或 ⌘/ 查看指令。')
        sessionPush('system', 'Session 已清空。')
        return
      }
      case 'status':
      case 'info': {
        log(`狀態：${isRunning ? '執行中' : agent.status}`)
        log(`模式：${selectedLoopType || agent.loopConfig.loopType || 'Goal-based'}`)
        log(`模型：${settings.model || '—'} · LLM ${settings.enabled ? '開' : '關'}`)
        log(`工具：${settings.toolsEnabled ? '開' : '關'} · FC ${settings.functionCalling ? '開' : '關'}`)
        log(`MCP：${settings.mcpEnabled ? '開' : '關'} · TG：${settings.telegramEnabled ? '開' : '關'}`)
        if (agent.objective) log(`目標：${agent.objective.slice(0, 120)}`)
        return
      }
      case 'cost':
      case 'tokens':
      case 'usage': {
        /*
         * The same projection the 上下文 panel and the feed microcopy read.
         * `/cost` used to print one scalar that could not say whether a run
         * was expensive because the context was long or the answer was; now it
         * prints the measured split — and prints NO line for a figure nobody
         * measured, because a `0` there would read as a measurement.
         */
        const record = agent.turnRecord
        const runModel = agent.steps[agent.steps.length - 1]?.modelUsed || settings.model
        const usage = projectContextUsage(record, {
          contextWindow: resolveKnownContextWindow(settings, runModel),
          pricing: settings.modelProfiles?.[(runModel || '').trim()]?.pricing,
        })
        if (usage.measuredSteps > 0) {
          for (const line of contextUsageReportLines(usage)) log(line)
        } else {
          // A runner that publishes no per-step usage keeps the scalar it has.
          log(`Tokens：${agent.tokensUsed || 0}`)
          log(`步驟：${agent.steps.length} · 工具呼叫：${agent.toolCalls?.length || 0}`)
        }
        log(`耗時：${agent.metrics?.executionMs || 0} ms`)
        return
      }
      case 'model':
      case 'models': {
        const thr = useThreadStore.getState()
        if (args.trim()) {
          const m = args.trim()
          // 預設寫入「此對話」；加 global 才改全域
          if (m.startsWith('global ') || m.startsWith('global:')) {
            const gm = m.replace(/^global\s*:?\s*/, '')
            await useSettingsStore.getState().update({ model: gm })
            log(`全域模型 → ${gm}`)
            return
          }
          if (thr.activeId) {
            thr.setModel(thr.activeId, m)
            log(`此對話模型 → ${m}（不改全域；/model global <名> 改全域）`)
          } else {
            await useSettingsStore.getState().update({ model: m })
            log(`模型 → ${m}`)
          }
          return
        }
        const t = thr.threads.find((x) => x.id === thr.activeId)
        log(`此對話：${t?.model || '（沿用全域）'}`)
        log(`全域：${settings.model || '（未設定）'}`)
        log('用法：/model <id>  |  /model global <id>')
        return
      }
      case 'depth':
      case 'think':
      case 'thinking': {
        const thr = useThreadStore.getState()
        const key = args.toLowerCase().trim() as ThinkingDepth
        const map: Record<string, ThinkingDepth> = {
          fast: 'fast',
          quick: 'fast',
          standard: 'standard',
          normal: 'standard',
          default: 'standard',
          deep: 'deep',
          high: 'deep',
          max: 'max',
          maxx: 'max',
          ultra: 'ultra',
          快思: 'fast',
          快: 'fast',
          中: 'standard',
          高: 'deep',
          極高: 'max',
          超高: 'ultra',
          極: 'max',
        }
        if (!key) {
          const t = thr.threads.find((x) => x.id === thr.activeId)
          const d = getThinkingDepth(t?.thinkingDepth)
          log(`思考深度：${d.label}（${d.id}）iter≤${d.maxIterations} tools≤${d.maxToolRounds}`)
          log('用法：/depth 快思|中|高|極高|超高 或 fast|standard|deep|max|ultra')
          return
        }
        const id = map[key]
        if (!id) {
          log('用法：/depth 快思|中|高|極高|超高')
          return
        }
        if (thr.activeId) thr.setThinkingDepth(thr.activeId, id)
        const d = getThinkingDepth(id)
        log(`思考深度 → ${d.label}（iter≤${d.maxIterations} · tools≤${d.maxToolRounds}）`)
        return
      }
      case 'doctor':
      case 'health':
      case 'check': {
        log('── 健康檢查 ──')
        log(`Electron：${window.subagents ? '是' : '否（瀏覽器預覽）'}`)
        log(`LLM：${settings.enabled ? 'enabled' : 'disabled'} · key=${settings.apiKey ? '已設' : '未設'}`)
        log(`Webhook：${settings.webhookEnabled ? 'on' : 'off'} · MCP：${settings.mcpEnabled ? 'on' : 'off'}`)
        log(`Telegram：${settings.telegramEnabled ? 'on' : 'off'}`)
        if (window.subagents?.gateway) {
          try {
            const st = await window.subagents.gateway.status()
            log(`TG poll：running=${st.telegram.running} @${st.telegram.botUsername || '-'}`)
          } catch (e) {
            log(`TG：${e instanceof Error ? e.message : e}`)
          }
        }
        if (window.subagents?.mcp?.stdioSessions) {
          const sess = await window.subagents.mcp.stdioSessions()
          log(`MCP sessions：${sess.length}`)
        }
        log(settings.apiKey && settings.enabled ? '✓ 就緒可執行' : '⚠ 建議到 /settings 設定 API')
        return
      }
      case 'export':
      case 'copy': {
        const text = [
          `# SubAgents session`,
          `mode: ${selectedLoopType || agent.loopConfig.loopType}`,
          `status: ${agent.status}`,
          `objective: ${agent.objective || draftInput || '—'}`,
          agent.result ? `\n## result\n${agent.result.slice(0, 4000)}` : '',
        ].join('\n')
        try {
          await navigator.clipboard.writeText(text)
          log('已複製 session 摘要到剪貼簿')
        } catch {
          log(text.slice(0, 500))
        }
        return
      }
      case 'undo': {
        const prev = historyItems[0]
        if (!prev) {
          log('沒有可還原的歷史')
          return
        }
        setDraftInput(prev)
        ui.setComposer(prev)
        log(`已還原：${prev.slice(0, 80)}`)
        return
      }
      case 'history':
      case 'hist': {
        if (!historyItems.length) {
          log('（無輸入歷史）')
          return
        }
        historyItems.slice(0, 12).forEach((h, i) => log(`${i + 1}. ${h.slice(0, 100)}`))
        return
      }
      case 'quit':
      case 'exit':
      case 'hide': {
        if (window.subagents?.showWindow === undefined) {
          log('僅 Electron 可隱藏到系統匣')
        }
        // close via hide: no direct hide API — notify
        void window.subagents?.notify?.('SubAgents AI', '請用視窗關閉按鈕隱藏到系統匣')
        log('提示：關閉視窗可隱藏到系統匣')
        return
      }
      case 'run':
      case 'go':
      case 'start':
      case 'exec': {
        const goal = args || draftInput || ui.composer
        if (!goal.trim()) {
          log('用法：/run <目標>')
          return
        }
        log(`▶ 內嵌執行：${goal.slice(0, 80)}`)
        // caller (Protocols) may already push user bubble for raw slash line
        await runEmbedded(goal, { skipUserBubble: true })
        return
      }
      case 'stop':
      case 'abort':
      case 'cancel': {
        const threadId = useThreadStore.getState().activeId
        const runId = threadId ? getRunIdForThread(threadId) : null
        if (runId) {
          stopExecution(runId)
          log('已送出停止')
        } else {
          log('目前沒有可停止的 run')
        }
        return
      }
      case 'mode':
      case 'pattern':
      case 'loop':
      case 'protocol': {
        const map: Record<string, LoopType> = {
          turn: 'Turn-based',
          'turn-based': 'Turn-based',
          goal: 'Goal-based',
          'goal-based': 'Goal-based',
          time: 'Time-based',
          'time-based': 'Time-based',
          proactive: 'Proactive',
        }
        const key = args.toLowerCase().trim()
        const t = map[key]
        if (!t) {
          log('用法：/mode turn|goal|time|proactive')
          return
        }
        setSelectedLoopType(t)
        log(`循環模式 → ${t}`)
        return
      }
      case 'build': {
        const thr = useThreadStore.getState()
        if (thr.activeId) thr.setAgentMode(thr.activeId, 'build')
        log('Agent → Build（完整工具，靈感自 OpenCode）')
        if (args.trim()) await runEmbedded(args, { skipUserBubble: true })
        return
      }
      case 'plan': {
        // OpenCode Plan mode (read-only), optional goal after
        const thr = useThreadStore.getState()
        if (thr.activeId) thr.setAgentMode(thr.activeId, 'plan')
        log('Agent → Plan（唯讀規劃，禁止寫入）')
        if (args.trim()) {
          await runEmbedded(args, { skipUserBubble: true })
        }
        return
      }
      case 'ask': {
        setSelectedLoopType('Turn-based')
        const thr = useThreadStore.getState()
        if (thr.activeId) thr.setLoopType(thr.activeId, 'Turn-based')
        if (args.trim()) {
          await runEmbedded(args, { skipUserBubble: true })
          return
        }
        log('已切換 Turn-based。輸入問題後 Enter')
        return
      }
      case 'agent': {
        const thr = useThreadStore.getState()
        const key = args.toLowerCase().trim() as AgentMode
        if (key === 'build' || key === 'plan') {
          if (thr.activeId) thr.setAgentMode(thr.activeId, key)
          log(`Agent → ${getPrimaryAgent(key).label}`)
          return
        }
        const t = thr.threads.find((x) => x.id === thr.activeId)
        log(`目前：${getPrimaryAgent(t?.agentMode).label}`)
        log('用法：/agent build|plan  或 /build /plan · Tab 空輸入切換')
        return
      }
      case 'opencode': {
        if (!window.subagents?.opencode) {
          log('opencode 僅 Electron')
          return
        }
        const sub = args.toLowerCase().trim()
        if (sub === 'detect' || sub === '') {
          const d = await window.subagents.opencode.detect()
          log(
            d.found
              ? `opencode CLI：${d.path} · ${d.version || '?'}`
              : '未找到 opencode（PATH）',
          )
          return
        }
        if (sub === 'agents' || sub === 'scan') {
          const s = await window.subagents.opencode.scanAgents()
          log(`掃描目錄：${(s.dirs || []).join(', ')}`)
          const all = [...(s.global || []), ...(s.project || [])]
          if (!all.length) log('（無 agents/*.md）')
          all.forEach((a) =>
            log(`· ${a.name} [${a.mode || '?'}] ${a.description || a.path}`),
          )
          return
        }
        if (sub.startsWith('run ')) {
          const prompt = args.slice(4).trim()
          log('呼叫 opencode CLI…')
          const r = await window.subagents.opencode.run({ prompt })
          log(r.ok ? r.output.slice(0, 1500) : r.error || 'failed')
          return
        }
        log('用法：/opencode · /opencode agents · /opencode run <提示>')
        return
      }
      case 'codegraph':
      case 'cg':
      case 'graph': {
        const root = projectRoot()
        const parts = args.trim().split(/\s+/)
        const sub = (parts[0] || 'status').toLowerCase()
        const rest = parts.slice(1).join(' ').trim()
        if (!window.subagents?.codegraph) {
          log('CodeGraph 需 Electron')
          return
        }
        if (sub === 'status' || sub === 'st') {
          const st = await window.subagents.codegraph.status(root || undefined)
          log(
            st.installed
              ? `codegraph ${st.version || '?'} · indexed=${st.indexed} · ${st.projectRoot || '—'}`
              : st.error || '未安裝 codegraph',
          )
          if (st.error && st.installed) log(st.error)
          return
        }
        if (sub === 'init') {
          if (!root) {
            log('請先選擇專案目錄')
            return
          }
          log('codegraph init…（可能較久）')
          const r = await window.subagents.codegraph.init(root)
          log(r.ok ? '索引完成' : r.error || 'init 失敗')
          if (r.output) log(r.output.slice(0, 800))
          return
        }
        if (sub === 'sync') {
          if (!root) {
            log('請先選擇專案')
            return
          }
          const r = await window.subagents.codegraph.sync(root)
          log(r.ok ? 'sync 完成' : r.error || 'sync 失敗')
          return
        }
        if (sub === 'explore' || sub === 'ex') {
          if (!root) {
            log('請先選擇專案')
            return
          }
          const q = rest || 'main architecture entry points'
          log(`codegraph explore: ${q}`)
          const { runCodegraphExplore } = await import('../agent/codegraphClient')
          const r = await runCodegraphExplore(root, q)
          log(r.ok ? r.output.slice(0, 2000) : r.error || 'explore 失敗')
          if (r.ok) log(`已合併 ${r.graph.entities.length} 節點 → 知識圖譜`)
          return
        }
        if (sub === 'impact') {
          if (!root || !rest) {
            log('用法：/codegraph impact <symbol>')
            return
          }
          const { runCodegraphImpact } = await import('../agent/codegraphClient')
          const r = await runCodegraphImpact(root, rest)
          log(r.ok ? r.output.slice(0, 2000) : r.error || 'impact 失敗')
          return
        }
        if (sub === 'callers') {
          if (!root || !rest) {
            log('用法：/codegraph callers <symbol>')
            return
          }
          const { runCodegraphCallers } = await import('../agent/codegraphClient')
          const r = await runCodegraphCallers(root, rest)
          log(r.ok ? r.output.slice(0, 2000) : r.error || 'callers 失敗')
          return
        }
        log(
          '用法：/codegraph status|init|sync|explore <q>|impact <sym>|callers <sym> · /knowledge',
        )
        return
      }
      case 'knowledge':
      case 'kg': {
        navigate('/knowledge')
        log('開啟知識圖譜')
        return
      }
      case 'review': {
        navigate('/records')
        log('前往封存與日誌')
        return
      }
      case 'jobs':
      case 'bg':
      case 'todo':
      case 'delegate': {
        const { listBackgroundJobs } = await import('../agent/hermes/backgroundJobs')
        const list = listBackgroundJobs()
        if (!list.length) {
          log('（無背景委派）')
          return
        }
        list.slice(0, 15).forEach((j) => {
          log(`· ${j.id} [${j.status}] ${j.goal.slice(0, 70)}`)
        })
        return
      }
      case 'queue':
      case 'q': {
        const {
          listQueuedRuns,
          queueLength,
          clearRunQueue,
          removeQueuedRun,
          isRunQueueDraining,
        } = await import('../agent/runQueue')
        const sub = (args || '').trim()
        const subLower = sub.toLowerCase()
        if (subLower === 'clear' || subLower === 'flush') {
          const n = clearRunQueue()
          log(`已清除自動化佇列 ${n} 筆`)
          return
        }
        if (subLower.startsWith('cancel ') || subLower.startsWith('rm ')) {
          const id = sub.split(/\s+/)[1]
          if (!id) {
            log('用法：/queue cancel <id>')
            return
          }
          log(removeQueuedRun(id) ? `已取消 ${id}` : `找不到 ${id}`)
          return
        }
        const list = listQueuedRuns()
        log(
          `自動化佇列：${queueLength()}/24${isRunQueueDraining() ? ' · 消化中' : ''}${isRunning ? ' · 代理忙碌' : ''}`,
        )
        if (!list.length) {
          log('（空）— 排程/Webhook/Telegram 忙碌時會入列')
          return
        }
        list.forEach((q, i) => {
          log(
            `${i + 1}. [${q.id}] ${(q.sourceLabel || 'auto').slice(0, 40)} · ${(q.objective || '').slice(0, 60)}`,
          )
        })
        log('提示：/queue clear · /queue cancel <id>')
        return
      }
      case 'permissions':
      case 'safety':
      case 'auth': {
        log(`authLevel：${settings.authLevel}`)
        log(`safety：${settings.safetyEnabled ? 'on' : 'off'}`)
        log(`minConfidence：${settings.minConfidence}`)
        log(`haltOnPayloadOverflow：${settings.haltOnPayloadOverflow}`)
        return
      }
      case 'verbose':
      case 'debug': {
        log(JSON.stringify({
          model: settings.model,
          tools: settings.toolsEnabled,
          fc: settings.functionCalling,
          maxToolRounds: settings.maxToolRounds,
          maxIterations: settings.maxIterationsDefault,
          mcp: settings.mcpEnabled,
          telegram: settings.telegramEnabled,
        }, null, 2))
        return
      }
      case 'context':
      case 'ctx': {
        try {
          const layers = buildPromptLayers({
            role: 'orchestrator',
            objective: draftInput || agent.objective || '（無）',
          })
          log(`stable ≈ ${layers.stable?.length || 0} chars`)
          log(`context ≈ ${layers.context?.length || 0} chars`)
          log(`volatile ≈ ${layers.volatile?.length || 0} chars`)
          log((layers.volatile || layers.full || '').slice(0, 400))
        } catch (e) {
          log(e instanceof Error ? e.message : String(e))
        }
        return
      }
      case 'init': {
        const body = `# AGENTS.md\n\n> SubAgents / Hermes 風格專案指引\n\n## 目標\n\n- \n\n## 約束\n\n- \n\n## 偏好\n\n- 回覆使用繁體中文\n`
        const root = projectRoot()
        if (window.subagents?.tools?.workspaceWrite && root) {
          const r = await window.subagents.tools.workspaceWrite('AGENTS.md', body)
          log(r.ok ? `已寫入 ${root}/AGENTS.md` : r.error || '寫入失敗')
          return
        }
        // fallback download
        const blob = new Blob([body], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'AGENTS.md'
        a.click()
        URL.revokeObjectURL(url)
        log('已下載 AGENTS.md（請放到專案根目錄；或先選擇專案資料夾）')
        return
      }
      case 'skills': {
        refreshLearning()
        const list = skillsStore.list()
        if (!list.length) log('（無技能）')
        else list.forEach((s) => log(`· ${s.meta.name} — ${s.meta.description}`))
        return
      }
      case 'skill': {
        if (!args) {
          log('用法：/skill <名稱>')
          return
        }
        const s = skillsStore.get(args)
        if (!s) {
          log(`找不到技能：${args}`)
          return
        }
        log(`── ${s.meta.name} ──`)
        s.raw.split('\n').slice(0, 40).forEach((l) => log(l))
        return
      }
      case 'memory':
      case 'mem': {
        if (args.startsWith('append ') || args.startsWith('add ')) {
          const text = args.replace(/^(append|add)\s+/, '')
          await appendMemory(text)
          log(`已寫入記憶：${text.slice(0, 80)}`)
          return
        }
        log('── USER ──')
        log(memory.userProfile || '（空）')
        log('── MEMORY ──')
        log(memory.memory.slice(0, 800) || '（空）')
        return
      }
      case 'search':
      case 'find':
      case 'web': {
        if (!args) {
          log('用法：/search <關鍵字>')
          return
        }
        log(`搜尋：${args}`)
        try {
          if (window.subagents?.tools?.webSearch) {
            const r = await window.subagents.tools.webSearch(args, 5)
            if (!r.results?.length) log('（無結果）')
            else
              r.results.forEach((x, i) =>
                log(`${i + 1}. ${x.title}\n   ${x.snippet}\n   ${x.url || ''}`),
              )
          } else {
            // browser fallback
            const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(args)}&limit=5&namespace=0&format=json&origin=*`
            const res = await fetch(url)
            const data = (await res.json()) as [string, string[], string[], string[]]
            const titles = data[1] || []
            if (!titles.length) log('（無結果）')
            titles.forEach((t, i) => log(`${i + 1}. ${t}\n   ${data[3]?.[i] || ''}`))
          }
        } catch (e) {
          log(e instanceof Error ? e.message : String(e))
        }
        return
      }
      case 'ls':
      case 'list':
      case 'dir': {
        const root = projectRoot()
        if (!window.subagents?.tools?.workspaceList) {
          log(root ? `專案：${root}` : '請先選擇專案目錄，並在 Electron 中執行')
          return
        }
        const r = await window.subagents.tools.workspaceList('.')
        log(r.entries.map((entry) => `${entry.dir ? 'dir ' : 'file'} ${entry.name}`).join('\n') || '（空）')
        return
      }
      case 'pwd': {
        const root = projectRoot()
        if (root) {
          log(root)
          return
        }
        if (window.subagents?.tools?.workspaceRoot) {
          log(await window.subagents.tools.workspaceRoot())
        } else log('尚未選擇專案目錄')
        return
      }
      case 'note': {
        const root = projectRoot()
        const name = `note_${Date.now()}.md`
        const body = `# 筆記\n\n建立於 ${new Date().toISOString()}\n`
        if (window.subagents?.tools?.workspaceWrite && root) {
          const r = await window.subagents.tools.workspaceWrite(`reports/${name}`, body)
          log(r.ok ? `已建立 ${root}/reports/${name}` : r.error || '失敗')
        } else {
          const blob = new Blob([body], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = name
          a.click()
          URL.revokeObjectURL(url)
          log(`已下載 ${name}`)
        }
        return
      }
      case 'term':
      case 'terminal':
      case 'shell': {
        window.dispatchEvent(new CustomEvent('subagents:toggle-terminal'))
        log('已切換終端面板')
        navigate('/')
        return
      }
      case 'compact':
      case 'mini':
      case 'float': {
        ui.setLayoutMode('float')
        ui.setFloatOpen(true)
        log('已切換小視窗模式（⌘. 可切換）')
        return
      }
      case 'expand':
      case 'full': {
        ui.setLayoutMode('full')
        ui.setFloatOpen(false)
        navigate('/')
        log('已回到主對話')
        return
      }
      case 'home':
      case 'chat':
        navigate('/')
        return
      case 'thread':
      case 'threads': {
        if (args === 'new' || args === '') {
          const id = useThreadStore.getState().createThread()
          log(`新 thread：${id}`)
          navigate('/')
          return
        }
        log('用法：/thread new')
        return
      }
      case 'dashboard':
        navigate('/dashboard')
        return
      case 'learning':
        navigate('/learning')
        return
      case 'settings':
      case 'config':
      case 'login':
        navigate('/settings')
        return
      case 'records':
      case 'logs':
      case 'archive':
        navigate('/records')
        return
      case 'automation':
      case 'cron':
      case 'schedule':
        navigate('/ops?tab=automation')
        return
      case 'docs':
      case 'manual':
      case 'readme':
        navigate('/docs')
        return
      case 'bug':
      case 'issue':
      case 'failed':
        navigate('/records?tab=logs')
        log('前往紀錄（可檢視失敗）')
        return
      case 'mcp': {
        if (!settings.mcpEnabled) {
          log('MCP 未啟用 — /settings')
          return
        }
        try {
          const tools = await listAllMcpTools((settings.mcpServers || []).filter((s) => s.enabled))
          if (!tools.length) log('（無 MCP 工具）')
          tools.forEach((t) => log(`· [${t.serverName}] ${t.name}`))
          if (window.subagents?.mcp?.stdioSessions) {
            const sess = await window.subagents.mcp.stdioSessions()
            if (sess.length) {
              log('── sessions ──')
              sess.forEach((s) =>
                log(`· ${s.id} pid=${s.pid} alive=${s.alive} reqs=${s.requestCount}`),
              )
            }
          }
        } catch (e) {
          log(e instanceof Error ? e.message : String(e))
        }
        return
      }
      case 'gateway':
      case 'telegram':
      case 'tg': {
        if (!window.subagents?.gateway) {
          log('Gateway 僅 Electron')
          return
        }
        const st = await window.subagents.gateway.status()
        log(
          `Telegram running=${st.telegram.running} bot=@${st.telegram.botUsername || '-'} msgs=${st.telegram.messageCount}`,
        )
        if (st.telegram.lastError) log(`error: ${st.telegram.lastError}`)
        return
      }
      case 'diff': {
        const r = agent.result || ''
        if (!r) {
          log('尚無 result 可 diff')
          return
        }
        log('── result preview ──')
        log(r.slice(0, 1200))
        return
      }
      default:
        log(`未處理：/${name}`)
    }
  }

  return { run, log, isRunning }
}
