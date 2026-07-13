/**
 * Tool executor — Electron IPC preferred; browser fallbacks for dev.
 */

import type { ToolName } from './registry'
import type { LlmSettings } from '../types'
import { memoryStore } from '../hermes/memory'
import { skillsStore } from '../hermes/skills'
import { listAllMcpTools, mcpCallTool } from '../hermes/mcp'
import { useSettingsStore } from '../../store/settingsStore'
import { getRunThreadId, resolveEffectiveProjectRoot } from './runContext'
import {
  defaultDesignSystemMarkdown,
  designSystemPath,
  isSafeDesignSystemId,
  readDesignSystem,
  scanDesignSystems,
  DESIGN_SYSTEM_ROOT,
} from '../subdesign/designSystem'

export interface ToolResult {
  ok: boolean
  output: string
  data?: unknown
}

const memory = new Map<string, string>()

export async function executeTool(
  tool: ToolName,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const api = window.subagents?.tools
  // Per-run pin first (scheduler A while UI shows B)
  const projectRoot = await resolveEffectiveProjectRoot()

  try {
    switch (tool) {
      case 'web_search': {
        if (api?.webSearch) {
          const r = await api.webSearch(String(input.query || ''), Number(input.limit) || 5)
          return { ok: true, output: formatSearch(r), data: r }
        }
        return browserWebSearch(String(input.query || ''))
      }
      case 'http_fetch': {
        if (api?.httpFetch) {
          const r = await api.httpFetch(String(input.url || ''), Number(input.maxChars) || 4000)
          return { ok: r.ok, output: r.text, data: r }
        }
        return browserHttpFetch(String(input.url || ''), Number(input.maxChars) || 4000)
      }
      case 'workspace_list': {
        if (api?.workspaceList) {
          const r = await api.workspaceList(String(input.path || '.'), projectRoot)
          return {
            ok: true,
            output: r.entries.map((e) => `${e.dir ? 'dir ' : 'file'} ${e.name}`).join('\n') || '(empty)',
            data: r,
          }
        }
        return { ok: true, output: '(browser mode) workspace unavailable — use Electron app' }
      }
      case 'workspace_read': {
        if (api?.workspaceRead) {
          const r = await api.workspaceRead(String(input.path || ''), projectRoot)
          return { ok: r.ok, output: r.content, data: r }
        }
        return { ok: false, output: 'workspace_read requires Electron' }
      }
      case 'workspace_diff': {
        if (!api?.workspaceDiff) return { ok: false, output: 'workspace_diff requires Electron' }
        const paths = Array.isArray(input.paths)
          ? input.paths.map(String).filter(Boolean).slice(0, 80)
          : []
        const r = await api.workspaceDiff(paths, projectRoot)
        return {
          ok: r.ok,
          output: r.ok ? r.diff || '(working tree clean)' : r.error || 'diff failed',
          data: r,
        }
      }
      case 'bash': {
        if (!window.subagents?.shell?.bash) {
          return { ok: false, output: 'bash 僅支援 Electron 環境' }
        }
        // Prefer per-run pin, then UI project root
        const cwd = projectRoot
        let command = String(input.command || '')
        // Enforce Git preferences from Settings
        try {
          const { useSettingsStore } = await import('../../store/settingsStore')
          command = applyGitSettingsToBash(command, useSettingsStore.getState().settings)
        } catch {
          /* ignore */
        }
        const r = await window.subagents.shell.bash({
          command,
          timeoutMs: Number(input.timeoutMs) || 60_000,
          cwd,
        })
        const out = [
          cwd && `cwd: ${cwd}`,
          command !== String(input.command || '') && `[git-settings rewritten]\n$ ${command}`,
          r.stdout && `stdout:\n${r.stdout}`,
          r.stderr && `stderr:\n${r.stderr}`,
          r.timedOut && '[timed out]',
          `exit=${r.code}`,
        ]
          .filter(Boolean)
          .join('\n')
        return { ok: r.ok, output: out || '(empty)', data: r }
      }
      case 'workspace_write': {
        if (api?.workspaceWrite) {
          const r = await api.workspaceWrite(
            String(input.path || ''),
            String(input.content || ''),
            projectRoot,
          )
          return {
            ok: r.ok,
            output: r.ok ? `Wrote ${r.bytes} bytes → ${r.path}` : r.error || 'write failed',
            data: r,
          }
        }
        return { ok: false, output: 'workspace_write requires Electron' }
      }
      case 'workspace_download': {
        if (!api?.workspaceDownload) return { ok: false, output: 'workspace_download requires Electron' }
        const r = await api.workspaceDownload(
          String(input.url || ''),
          String(input.path || ''),
          projectRoot,
        )
        return { ok: r.ok, output: r.ok ? `Downloaded ${r.bytes} bytes → ${r.path}` : r.error || 'download failed', data: r }
      }
      case 'workspace_mkdir': {
        if (!api?.workspaceMkdir) return { ok: false, output: 'workspace_mkdir requires Electron' }
        const r = await api.workspaceMkdir(String(input.path || ''), projectRoot)
        return { ok: r.ok, output: r.ok ? `Created directory → ${r.path}` : r.error || 'mkdir failed', data: r }
      }
      case 'workspace_move': {
        if (!api?.workspaceMove) return { ok: false, output: 'workspace_move requires Electron' }
        const r = await api.workspaceMove(
          String(input.from || ''),
          String(input.to || ''),
          projectRoot,
        )
        return { ok: r.ok, output: r.ok ? `Moved ${r.from} → ${r.to}` : r.error || 'move failed', data: r }
      }
      case 'workspace_delete': {
        if (!api?.workspaceDelete) return { ok: false, output: 'workspace_delete requires Electron' }
        const r = await api.workspaceDelete(
          String(input.path || ''),
          input.recursive === true,
          projectRoot,
        )
        return { ok: r.ok, output: r.ok ? `Deleted ${r.path}` : r.error || 'delete failed', data: r }
      }
      case 'table_parse': {
        const text = String(input.text || '').trim()
        if (!text) return { ok: false, output: 'text is required' }
        const requested = String(input.delimiter || 'auto')
        const delimiter = requested === 'auto' ? (text.includes('\t') ? '\t' : text.includes(';') && !text.includes(',') ? ';' : ',') : requested
        const rows = text.split(/\r?\n/).filter(Boolean).map((line) => line.split(delimiter).map((cell) => cell.trim()))
        const hasHeader = input.hasHeader !== false
        const headers = hasHeader ? (rows.shift() || []) : []
        const data = hasHeader ? rows.map((row) => Object.fromEntries(headers.map((h, i) => [h || `column_${i + 1}`, row[i] || '']))) : rows
        return { ok: true, output: JSON.stringify({ headers, rows: data, rowCount: data.length }, null, 2), data }
      }
      case 'datetime_now': {
        const now = new Date()
        const tz = String(input.timezone || 'local')
        const output = [
          `ISO: ${now.toISOString()}`,
          `Local: ${now.toLocaleString()}`,
          `Timezone: ${tz}`,
          `Unix: ${Math.floor(now.getTime() / 1000)}`,
        ].join('\n')
        return { ok: true, output }
      }
      case 'memory_set': {
        const key = String(input.key || 'default')
        const value = String(input.value || '')
        memory.set(key, value)
        if (api?.memorySet) await api.memorySet(key, value)
        return { ok: true, output: `memory[${key}] = ${value.slice(0, 200)}` }
      }
      case 'memory_get': {
        if (useSettingsStore.getState().settings.memoryEnabled === false) {
          return { ok: false, output: '記憶已在設定中關閉' }
        }
        const key = String(input.key || 'default')
        let value = memory.get(key)
        if (value == null && api?.memoryGet) {
          value = (await api.memoryGet(key)) ?? undefined
        }
        return {
          ok: value != null,
          output: value != null ? String(value) : `memory[${key}] is empty`,
        }
      }
      case 'memory_append': {
        const s = useSettingsStore.getState().settings
        if (s.memoryEnabled === false || s.memoryWriteEnabled === false) {
          return { ok: false, output: '記憶寫入已在設定中關閉（Memory / Write）' }
        }
        const text = String(input.text || '').trim()
        if (!text) return { ok: false, output: 'text is required' }
        const tags = Array.isArray(input.tags) ? (input.tags as string[]).map(String) : undefined
        const entry = memoryStore.appendMemory(text, tags)
        return { ok: true, output: `已寫入記憶 ${entry.id}: ${entry.text.slice(0, 200)}`, data: entry }
      }
      case 'memory_search': {
        if (useSettingsStore.getState().settings.memoryEnabled === false) {
          return { ok: false, output: '記憶已在設定中關閉' }
        }
        const query = String(input.query || '')
        const limit = Number(input.limit) || 8
        const hits = memoryStore.search(query, limit)
        if (!hits.length) return { ok: true, output: `無記憶命中：${query}` }
        return {
          ok: true,
          output: hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n'),
          data: hits,
        }
      }
      case 'skill_list': {
        const list = skillsStore.list()
        return {
          ok: true,
          output: list.map((s) => `- ${s.meta.name}: ${s.meta.description}`).join('\n') || '(empty)',
          data: list.map((s) => s.meta),
        }
      }
      case 'skill_load': {
        const name = String(input.name || '')
        const skill = skillsStore.get(name)
        if (!skill) return { ok: false, output: `找不到技能：${name}` }
        return { ok: true, output: skill.raw, data: skill.meta }
      }
      case 'skill_save': {
        const name = String(input.name || '').trim()
        const body = String(input.body || '')
        const description = String(input.description || name).slice(0, 60)
        if (!name || !body) return { ok: false, output: 'name and body required' }
        const skill = skillsStore.save(
          {
            name,
            description,
            version: '0.1.0',
            author: 'SubAgents AI',
            createdBy: 'agent',
          },
          body,
        )
        return { ok: true, output: `已儲存技能 ${skill.meta.name}`, data: skill.meta }
      }
      case 'mcp_list_tools': {
        const settings = useSettingsStore.getState().settings
        if (!settings.mcpEnabled) {
          return { ok: false, output: 'MCP 未啟用（請至設定開啟）' }
        }
        const servers = settings.mcpServers || []
        const filterId = input.serverId ? String(input.serverId) : ''
        const list = await listAllMcpTools(
          filterId ? servers.filter((s) => s.id === filterId) : servers,
          settings,
        )
        if (!list.length) return { ok: true, output: '（無 MCP 工具或伺服器未啟用）' }
        return {
          ok: true,
          output: list
            .map(
              (t) =>
                `- [${t.serverName}/${t.serverId}] ${t.name}: ${t.description || ''}`,
            )
            .join('\n'),
          data: list,
        }
      }
      case 'mcp_call': {
        const settings = useSettingsStore.getState().settings
        if (!settings.mcpEnabled) {
          return { ok: false, output: 'MCP 未啟用' }
        }
        const serverId = String(input.serverId || '')
        const toolName = String(input.toolName || '')
        const args =
          input.arguments && typeof input.arguments === 'object'
            ? (input.arguments as Record<string, unknown>)
            : {}
        const server = (settings.mcpServers || []).find((s) => s.id === serverId)
        if (!server) return { ok: false, output: `找不到 MCP 伺服器：${serverId}` }
        const r = await mcpCallTool(server, toolName, args, settings)
        return {
          ok: r.ok,
          output: r.ok ? r.content : r.error || 'MCP call failed',
          data: r,
        }
      }
      case 'delegate_task': {
        const settings = useSettingsStore.getState().settings
        const goal = String(input.goal || '').trim()
        if (!goal) return { ok: false, output: 'goal is required' }
        const background =
          input.background === true ||
          input.background === 'true' ||
          input.background === 1
        const notifyOnComplete =
          input.notify_on_complete !== false &&
          input.notifyOnComplete !== false &&
          input.notify_on_complete !== 'false'

        // Inherit parent run pin + explicit capabilities (audit: must not drop inherit)
        const { getRunProjectRoot, getRunId } = await import('./runContext')
        const inheritRaw =
          input.inherit_capabilities ?? input.inheritCapabilities ?? input.capabilities
        const inheritCapabilities = Array.isArray(inheritRaw)
          ? inheritRaw.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
          : typeof inheritRaw === 'string'
            ? inheritRaw
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 12)
            : []
        const parentCtx = {
          parentRunId: getRunId(),
          projectRoot: getRunProjectRoot(),
          sourceKind: 'delegate' as const,
          inheritCapabilities,
        }

        if (background) {
          const { enqueueBackgroundDelegate } = await import('../hermes/backgroundJobs')
          const job = enqueueBackgroundDelegate(settings, {
            goal,
            context: input.context ? String(input.context) : undefined,
            role: input.role === 'orchestrator' ? 'orchestrator' : 'leaf',
            background: true,
            notifyOnComplete,
            ...parentCtx,
          })
          return {
            ok: true,
            output: `背景委派已排入佇列：${job.id}\n目標：${goal}${inheritCapabilities.length ? `\ninherit: ${inheritCapabilities.join(', ')}` : ''}\n完成時${notifyOnComplete ? '會' : '不會'}桌面通知。可用 delegate_status 查詢。`,
            data: job,
          }
        }

        const { runDelegatedTask } = await import('../hermes/delegate')
        const r = await runDelegatedTask(settings, {
          goal,
          context: input.context ? String(input.context) : undefined,
          role: input.role === 'orchestrator' ? 'orchestrator' : 'leaf',
          ...parentCtx,
        })
        return {
          ok: r.ok,
          output: r.ok
            ? `委派 ${r.id}（depth=${r.depth}，${r.durationMs}ms）\n\n${r.summary}`
            : r.summary,
          data: r,
        }
      }
      case 'delegate_status': {
        const { listBackgroundJobs, getBackgroundJob } = await import('../hermes/backgroundJobs')
        const jobId = input.jobId ? String(input.jobId) : ''
        if (jobId) {
          const j = getBackgroundJob(jobId)
          if (!j) return { ok: false, output: `找不到 job：${jobId}` }
          return {
            ok: true,
            output: JSON.stringify(j, null, 2),
            data: j,
          }
        }
        const list = listBackgroundJobs().slice(0, 20)
        if (!list.length) return { ok: true, output: '（無背景委派任務）' }
        return {
          ok: true,
          output: list
            .map(
              (j) =>
                `· ${j.id} [${j.status}] ${j.goal.slice(0, 60)}${j.summary ? ` — ${j.summary.slice(0, 80)}` : ''}`,
            )
            .join('\n'),
          data: list,
        }
      }
      case 'message_send': {
        const channel = (String(input.channel || 'telegram') as 'telegram') || 'telegram'
        const chatId = String(input.chatId || '').trim()
        const text = String(input.text || '').trim()
        if (!chatId || !text) return { ok: false, output: 'chatId 與 text 必填' }
        if (!window.subagents?.gateway?.send) {
          return { ok: false, output: 'Messaging gateway 僅支援 Electron 環境' }
        }
        const settings = useSettingsStore.getState().settings
        const r = await window.subagents.gateway.send({
          channel,
          chatId,
          text,
          token: settings.telegramBotToken || undefined,
        })
        return {
          ok: r.ok,
          output: r.ok ? `已送出至 ${channel}:${chatId}` : r.error || 'send failed',
          data: r,
        }
      }
      case 'json_extract_lite': {
        const text = String(input.text || '')
        const items = text
          .split(/\n/)
          .map((l) => l.replace(/^[-*•]\s*/, '').trim())
          .filter((l) => l.length > 8 && l.length < 120)
          .slice(0, 8)
        const payload = {
          title: text.split('\n').find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '') || 'json_extract_lite',
          items,
          summary: text.slice(0, 280),
        }
        return { ok: true, output: JSON.stringify(payload, null, 2), data: payload }
      }
      case 'update_plan': {
        const raw = Array.isArray(input.todos)
          ? input.todos
          : Array.isArray(input.items)
            ? input.items
            : []
        const todos = raw
          .map((item, index) => {
            if (typeof item === 'string') {
              return { id: `plan_${index + 1}`, text: item, status: 'pending' }
            }
            if (!item || typeof item !== 'object') return null
            const value = item as Record<string, unknown>
            const text = String(value.text ?? value.title ?? value.task ?? value.step ?? '').trim()
            if (!text) return null
            const status = String(value.status ?? '').toLowerCase()
            return {
              id: String(value.id || `plan_${index + 1}`),
              text: text.slice(0, 200),
              status:
                status.includes('fail') || status.includes('error')
                  ? 'failed'
                  : status.includes('done') || status.includes('complete')
                    ? 'done'
                    : status.includes('active') || status.includes('progress')
                      ? 'active'
                      : 'pending',
            }
          })
          .filter((item): item is { id: string; text: string; status: string } => Boolean(item))
          .slice(0, 40)
        if (!todos.length) return { ok: false, output: 'update_plan 需要至少一個有效的 todos 項目' }
        try {
          const { useRunActivityStore } = await import('../../store/runActivityStore')
          useRunActivityStore.getState().setTasks(todos)
          useRunActivityStore.getState().push({
            kind: 'status',
            title: '任務清單更新',
            detail: `${todos.length} 項 · ${todos.filter((item) => item.status === 'done').length} 項完成`,
          })
          useRunActivityStore.getState().setStatus(`任務清單已更新 · ${todos.length} 項`)
        } catch {
          /* UI store is optional in browser / pure execution contexts */
        }
        const output = todos
          .map((item, index) => `${index + 1}. [${item.status}] ${item.text}`)
          .join('\n')
        let subDesignStage: string | undefined
        try {
          const { stageFromPlan } = await import('../subdesign/brief')
          const { useSubDesignStore } = await import('../../store/subDesignStore')
          const threadId = getRunThreadId()
          const linked = threadId ? useSubDesignStore.getState().findByThreadId(threadId) : null
          const inferred = stageFromPlan(todos)
          if (linked && inferred && (inferred !== 'build' || linked.selectedDirectionId)) {
            const stageResult = useSubDesignStore.getState().setStage(linked.id, inferred, projectRoot)
            if (stageResult.ok) subDesignStage = stageResult.brief.stage
          }
        } catch {
          /* SubDesign metadata is optional for normal task plans. */
        }
        return {
          ok: true,
          output: `任務清單已更新（${todos.length} 項）${subDesignStage ? ` · SubDesign=${subDesignStage}` : ''}\n${output}`,
          data: { todos, subDesignStage },
        }
      }
      case 'design_brief_update': {
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        const threadId = getRunThreadId()
        const briefId = String(input.briefId || '').trim()
        const linked = briefId
          ? useSubDesignStore.getState().findById(briefId)
          : threadId
            ? useSubDesignStore.getState().findByThreadId(threadId)
            : null
        if (!linked) return { ok: false, output: '找不到與目前 thread 關聯的 SubDesign brief。' }
        const patch: Record<string, unknown> = {}
        for (const key of [
          'objective',
          'audience',
          'platform',
          'fidelity',
          'designSystemId',
          'constraints',
          'acceptanceCriteria',
          'directions',
          'references',
        ]) {
          if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key]
        }
        const updated = useSubDesignStore.getState().updateBrief(linked.id, patch, projectRoot)
        if (!updated) return { ok: false, output: 'brief 更新失敗。' }
        let finalBrief = updated
        if (input.stage) {
          const stageResult = useSubDesignStore.getState().setStage(linked.id, String(input.stage) as never, projectRoot)
          if (!stageResult.ok) return { ok: false, output: stageResult.error, data: updated }
          finalBrief = stageResult.brief
        }
        return {
          ok: true,
          output: `SubDesign brief 已更新：stage=${finalBrief.stage} · direction=${finalBrief.selectedDirectionId || '未選定'}`,
          data: finalBrief,
        }
      }
      case 'design_direction_select': {
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        const threadId = getRunThreadId()
        const briefId = String(input.briefId || '').trim()
        const linked = briefId
          ? useSubDesignStore.getState().findById(briefId)
          : threadId
            ? useSubDesignStore.getState().findByThreadId(threadId)
            : null
        if (!linked) return { ok: false, output: '找不到與目前 thread 關聯的 SubDesign brief。' }
        const result = useSubDesignStore.getState().selectDirection(linked.id, String(input.directionId || ''), {
          title: input.title ? String(input.title) : undefined,
          summary: input.summary ? String(input.summary) : undefined,
          rationale: input.rationale ? String(input.rationale) : undefined,
          risk: input.risk ? String(input.risk) : undefined,
        }, projectRoot)
        if (!result.ok) return { ok: false, output: result.error, data: linked }
        return {
          ok: true,
          output: `Direction「${result.brief.selectedDirectionId}」已選定；Build stage 已解鎖。`,
          data: result.brief,
        }
      }
      case 'design_system_list': {
        const systems = await scanDesignSystems(projectRoot)
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        useSubDesignStore.getState().setSystems(systems)
        return {
          ok: true,
          output: systems.length
            ? systems.map((system) => `${system.id}: ${system.title} · ${system.colors.join(', ') || 'no swatches'}`).join('\n')
            : '尚未找到 DESIGN.md 或 .subagents/subdesign/design-systems/*。',
          data: systems,
        }
      }
      case 'design_system_read': {
        const id = String(input.id || '').trim()
        if (id !== 'project' && !isSafeDesignSystemId(id)) {
          return { ok: false, output: '不安全的 design system id。' }
        }
        const system = await readDesignSystem(id, projectRoot)
        if (!system) return { ok: false, output: `讀不到 design system：${id}` }
        return { ok: true, output: system.content.slice(0, 20_000), data: system }
      }
      case 'design_system_create': {
        const id = String(input.id || '').trim()
        const title = String(input.title || '').trim()
        if (!projectRoot) return { ok: false, output: '請先選擇 project root，才能建立 design system。' }
        if (!isSafeDesignSystemId(id) || !title) return { ok: false, output: 'id / title 不合法。' }
        if (!api?.workspaceMkdir || !api.workspaceWrite) return { ok: false, output: 'design system 寫入需要 Electron workspace API。' }
        const dir = await api.workspaceMkdir(`${DESIGN_SYSTEM_ROOT}/${id}`, projectRoot)
        if (!dir.ok && !/exist/i.test(dir.error || '')) return { ok: false, output: dir.error || '建立資料夾失敗。' }
        const content = String(input.content || '').trim() || defaultDesignSystemMarkdown(title, String(input.category || 'custom'))
        const result = await api.workspaceWrite(designSystemPath(id), content, projectRoot)
        if (!result.ok) return { ok: false, output: result.error || '寫入 DESIGN.md 失敗。' }
        return { ok: true, output: `已建立 design system ${id} → ${result.path}`, data: { id, path: result.path } }
      }
      case 'design_system_update': {
        const id = String(input.id || '').trim()
        const content = String(input.content || '').trim()
        if (!projectRoot) return { ok: false, output: '請先選擇 project root，才能更新 design system。' }
        if (!isSafeDesignSystemId(id) || !content) return { ok: false, output: 'id / content 不合法。' }
        if (!api?.workspaceWrite) return { ok: false, output: 'design system 寫入需要 Electron workspace API。' }
        const result = await api.workspaceWrite(designSystemPath(id), content, projectRoot)
        if (!result.ok) return { ok: false, output: result.error || '更新 DESIGN.md 失敗。' }
        return { ok: true, output: `已更新 design system ${id} → ${result.path}`, data: { id, path: result.path } }
      }
      case 'design_artifact_register': {
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const threadId = getRunThreadId()
        const linked = threadId ? useSubDesignStore.getState().findByThreadId(threadId) : null
        const rawManifest = input.manifest && typeof input.manifest === 'object'
          ? { ...(input.manifest as Record<string, unknown>) }
          : null
        if (!rawManifest) return { ok: false, output: 'manifest 必須是 object。' }
        const briefId = String(input.briefId || rawManifest.briefId || linked?.id || '').trim()
        if (!briefId) return { ok: false, output: '找不到 SubDesign brief，不能登記 artifact。' }
        if (linked && briefId !== linked.id) {
          return { ok: false, output: 'artifact briefId 與目前 thread 不一致。' }
        }
        rawManifest.briefId = briefId
        if (!rawManifest.designSystemId && linked?.designSystemId) rawManifest.designSystemId = linked.designSystemId
        const result = useSubDesignArtifactStore.getState().register(rawManifest, {
          briefId,
          designSystemId: linked?.designSystemId,
        }, projectRoot)
        if (!result.ok) return { ok: false, output: `artifact manifest invalid：${result.errors.join('；')}` }
        return {
          ok: true,
          output: `Artifact「${result.artifact.title}」已登記（revision ${result.artifact.revision}）→ ${result.artifact.entry}`,
          data: result.artifact,
        }
      }
      case 'design_artifact_patch': {
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        const artifactId = String(input.artifactId || '').trim()
        const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
        if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
        const patchApi = window.subagents?.subdesign?.patchArtifact
        if (!patchApi) return { ok: false, output: 'artifact patch 需要 Electron workspace API。' }
        const operations = Array.isArray(input.operations) ? input.operations.slice(0, 12) : []
        if (!operations.length) return { ok: false, output: 'operations 必須至少包含一個 exact replacement。' }
        const result = await patchApi({ artifact, operations, projectRoot })
        if (!result.ok || !result.artifact) return { ok: false, output: result.error || 'artifact patch 失敗。', data: result }
        const updated = useSubDesignArtifactStore.getState().register(result.artifact, {
          briefId: artifact.briefId,
          designSystemId: artifact.designSystemId,
        }, projectRoot)
        if (!updated.ok) return { ok: false, output: `patch revision invalid：${updated.errors.join('；')}` }
        const linkedBrief = useSubDesignStore.getState().findById(artifact.briefId)
        if (linkedBrief && linkedBrief.stage !== 'critique') useSubDesignStore.getState().setStage(linkedBrief.id, 'critique', projectRoot)
        return {
          ok: true,
          output: `Artifact「${artifact.title}」已原地調整（revision ${updated.artifact.revision}）→ ${(result.paths || []).join(', ')}`,
          data: { artifact: updated.artifact, paths: result.paths || [], operationCount: result.operationCount || operations.length },
        }
      }
      case 'design_artifact_tweak': {
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        const artifactId = String(input.artifactId || '').trim()
        const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
        if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
        const applyTweak = window.subagents?.subdesign?.applyTweak
        if (!applyTweak) return { ok: false, output: 'structured artifact tweak 需要 Electron workspace API。' }
        const result = await applyTweak({ artifact, tweakId: String(input.tweakId || ''), value: String(input.value ?? ''), projectRoot })
        if (!result.ok || !result.artifact) return { ok: false, output: result.error || 'structured tweak 失敗。', data: result }
        const updated = useSubDesignArtifactStore.getState().register(result.artifact, { briefId: artifact.briefId, designSystemId: artifact.designSystemId }, projectRoot)
        if (!updated.ok) return { ok: false, output: `tweak revision invalid：${updated.errors.join('；')}` }
        const brief = useSubDesignStore.getState().findById(artifact.briefId)
        if (brief && brief.stage !== 'critique') useSubDesignStore.getState().setStage(brief.id, 'critique', projectRoot)
        return { ok: true, output: `Artifact「${artifact.title}」已套用 structured tweak（revision ${updated.artifact.revision}）。`, data: { artifact: updated.artifact, paths: result.paths || [], operationCount: result.operationCount || 1 } }
      }
      case 'design_artifact_capture': {
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const artifactId = String(input.artifactId || '').trim()
        const kind = input.kind === 'dom' ? 'dom' : input.kind === 'screenshot' ? 'screenshot' : ''
        const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
        if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
        if (!kind) return { ok: false, output: 'capture kind 必須是 screenshot 或 dom。' }
        const capture = window.subagents?.subdesign?.captureEvidence
        if (!capture) return { ok: false, output: 'artifact evidence capture 需要 Electron desktop。' }
        const rawViewport = input.viewport && typeof input.viewport === 'object' ? input.viewport as Record<string, unknown> : {}
        const result = await capture({
          artifact,
          kind,
          viewport: {
            width: Math.max(320, Math.min(2400, Math.floor(Number(rawViewport.width) || 1440))),
            height: Math.max(240, Math.min(1800, Math.floor(Number(rawViewport.height) || 900))),
          },
          projectRoot,
        })
        if (!result.ok || !result.path) return { ok: false, output: result.error || 'artifact evidence capture 失敗。', data: result }
        const evidence = {
          kind,
          summary: kind === 'screenshot' ? 'Electron sandbox capture of the registered artifact.' : 'Electron sandbox DOM snapshot of the registered artifact.',
          path: result.path,
          capturedAt: result.capturedAt || new Date().toISOString(),
          evidenceId: result.evidenceId,
          sha256: result.sha256,
          source: result.source,
          artifactId: result.artifactId,
          revision: result.revision,
        }
        return { ok: true, output: `已產生 ${kind} evidence：${result.path}`, data: { ...result, evidence } }
      }
      case 'design_artifact_lint': {
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const artifactId = String(input.artifactId || '').trim()
        const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
        if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
        const lint = window.subagents?.subdesign?.lintEvidence
        if (!lint) return { ok: false, output: 'artifact semantic lint 需要 Electron desktop。' }
        const result = await lint({ artifact, projectRoot })
        if (!result.ok || !result.evidence) return { ok: false, output: result.error || 'artifact semantic lint 失敗。', data: result }
        const evidence = result.evidence as Record<string, unknown>
        return { ok: true, output: `已產生 lint evidence：${String(evidence.path || '')}`, data: { ...result, evidence } }
      }
      case 'design_critique': {
        const { critiqueAllowsDeliver } = await import('../subdesign/critique')
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const { useSubDesignCritiqueStore } = await import('../../store/subDesignCritiqueStore')
        const { useSubDesignStore } = await import('../../store/subDesignStore')
        const rawCritique = input.critique && typeof input.critique === 'object'
          ? { ...(input.critique as Record<string, unknown>) }
          : null
        if (!rawCritique) return { ok: false, output: 'critique 必須是 object。' }
        const artifactId = String(rawCritique.artifactId || '').trim()
        const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
        if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
        const threadId = getRunThreadId()
        const linked = threadId ? useSubDesignStore.getState().findByThreadId(threadId) : null
        const briefId = String(rawCritique.briefId || linked?.id || artifact.briefId).trim()
        if (linked && briefId !== linked.id) return { ok: false, output: 'critique briefId 與目前 thread 不一致。' }
        rawCritique.briefId = briefId
        const verifyEvidence = window.subagents?.subdesign?.verifyEvidence
        if (verifyEvidence) {
          const evidenceCheck = await verifyEvidence({ artifact, evidence: rawCritique.evidence, projectRoot })
          if (!evidenceCheck.ok) {
            const findings = Array.isArray(rawCritique.findings) ? [...rawCritique.findings] : []
            findings.push({
              severity: 'blocker',
              message: `Evidence 未通過 main process 驗證：${evidenceCheck.errors?.join('；') || '檔案不存在、路徑不被允許或已過期。'}`,
              path: '.subagents/subdesign/critiques',
            })
            rawCritique.findings = findings
            rawCritique.verdict = 'needs-revision'
          }
        }
        const result = useSubDesignCritiqueStore.getState().record(rawCritique, { briefId }, projectRoot)
        if (!result.ok) return { ok: false, output: `critique invalid：${result.errors.join('；')}` }
        const nextStage = critiqueAllowsDeliver(result.critique) ? 'deliver' : 'critique'
        const brief = useSubDesignStore.getState().findById(briefId)
        const stageResult = brief ? useSubDesignStore.getState().setStage(brief.id, nextStage, projectRoot) : null
        if (result.critique.verdict === 'pass' && brief) {
          const { learningLoop } = await import('../hermes/learning')
          learningLoop.onSubDesignPass({
            projectRoot,
            surface: brief.surface,
            platform: brief.platform,
            designSystemId: brief.designSystemId,
            templateId: brief.templateId,
            selectedDirectionId: brief.selectedDirectionId,
            memoryEnabled: useSettingsStore.getState().settings.memoryEnabled,
            memoryWriteEnabled: useSettingsStore.getState().settings.memoryWriteEnabled,
          })
        }
        return {
          ok: true,
          output: `Critique ${result.critique.verdict}（revision ${result.critique.revision}） · stage=${stageResult?.ok ? stageResult.brief.stage : nextStage}`,
          data: result.critique,
        }
      }
      case 'design_artifact_export': {
        const { critiqueAllowsDeliver } = await import('../subdesign/critique')
        const { useSubDesignArtifactStore } = await import('../../store/subDesignArtifactStore')
        const { useSubDesignCritiqueStore } = await import('../../store/subDesignCritiqueStore')
        const artifactId = String(input.artifactId || '').trim()
        const format = String(input.format || '').trim() as 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'
        if (!artifactId || !['html', 'zip', 'pdf', 'pptx', 'mp4'].includes(format)) {
          return { ok: false, output: 'artifactId / format 不合法。' }
        }
        const artifact = useSubDesignArtifactStore.getState().findById(artifactId)
        if (!artifact) return { ok: false, output: `找不到 artifact：${artifactId}` }
        if (!artifact.exports.includes(format)) return { ok: false, output: `artifact 不支援 ${format} export。` }
        const critique = useSubDesignCritiqueStore.getState().latestForArtifact(artifact.id, artifact.revision)
        if (!critique || !critiqueAllowsDeliver(critique)) {
          return { ok: false, output: 'Artifact 尚未通過 critique；請先修正 blocker / needs-revision findings。' }
        }
        const verifyEvidence = window.subagents?.subdesign?.verifyEvidence
        if (verifyEvidence) {
          const evidenceCheck = await verifyEvidence({ artifact, evidence: critique.evidence, projectRoot })
          if (!evidenceCheck.ok) return { ok: false, output: `Evidence 未通過 main process 驗證：${evidenceCheck.errors?.join('；') || '請重新 capture screenshot / DOM / lint evidence。'}` }
        }
        const exportApi = window.subagents?.subdesign
        if (!exportApi?.exportArtifact) return { ok: false, output: 'artifact export 需要 Electron desktop。' }
        const result = await exportApi.exportArtifact({
          artifact,
          critique,
          format,
          projectRoot,
          suggestedName: artifact.title,
        })
        if (!result.ok) {
          return {
            ok: false,
            output: result.cancelled ? '使用者取消 export。' : result.error || 'artifact export 失敗。',
            data: result,
          }
        }
        const { useSubDesignExportStore } = await import('../../store/subDesignExportStore')
        const record = useSubDesignExportStore.getState().record({
          artifactId: artifact.id,
          revision: result.revision || artifact.revision,
          format,
          path: result.path || '',
          bytes: result.bytes || 0,
          sha256: result.sha256 || '',
          projectRoot: projectRoot || undefined,
        })
        return {
          ok: true,
          output: `Artifact 已 export：${format} · revision ${record.revision} · ${record.path} · sha256 ${record.sha256}`,
          data: record,
        }
      }
      case 'ask_user': {
        const question = String(input.question || '').trim()
        if (!question) return { ok: false, output: 'ask_user 需要 question' }
        const rawOptions = Array.isArray(input.options) ? input.options : []
        const options = rawOptions
          .map((option) => {
            if (typeof option === 'string') return { label: option }
            if (!option || typeof option !== 'object') return null
            const value = option as Record<string, unknown>
            const label = String(value.label || value.title || '').trim()
            if (!label) return null
            return {
              label,
              description: value.description ? String(value.description) : undefined,
              value: value.value ? String(value.value) : undefined,
            }
          })
          .filter((option): option is { label: string; description?: string; value?: string } => Boolean(option))
          .slice(0, 12)
        const { useQuestionAskStore } = await import('../../store/questionAskStore')
        const answer = await useQuestionAskStore.getState().requestQuestion({
          question,
          options,
          multiSelect: input.multiSelect === true,
          allowFreeform: input.allowFreeform !== false,
          reason: input.reason ? String(input.reason) : undefined,
          timeoutMs: Number(input.timeoutMs) || undefined,
        })
        if (!answer) return { ok: false, output: '使用者取消或逾時，未取得回答' }
        const output = [
          answer.answers.length ? `選擇：${answer.answers.join('、')}` : '',
          answer.freeform ? `補充：${answer.freeform}` : '',
        ]
          .filter(Boolean)
          .join('\n')
        return { ok: true, output: output || '使用者已回答（無文字內容）', data: answer }
      }
      case 'codegraph_status': {
        let root = input.projectRoot ? String(input.projectRoot) : ''
        if (!root) {
          try {
            const { useProjectStore } = await import('../../store/projectStore')
            root = useProjectStore.getState().root || ''
          } catch {
            /* ignore */
          }
        }
        if (!window.subagents?.codegraph?.status) {
          return {
            ok: false,
            output:
              'CodeGraph 需 Electron。安裝：https://github.com/colbymchenry/codegraph — 然後 codegraph init',
          }
        }
        const st = await window.subagents.codegraph.status(root || undefined)
        return {
          ok: Boolean(st.installed),
          output: [
            `installed: ${st.installed}`,
            st.version && `version: ${st.version}`,
            st.binaryPath && `binary: ${st.binaryPath}`,
            `project: ${st.projectRoot || '—'}`,
            `indexed: ${st.indexed}`,
            st.indexPath && `index: ${st.indexPath}`,
            st.error && `error: ${st.error}`,
            st.raw && `---\n${st.raw.slice(0, 4000)}`,
          ]
            .filter(Boolean)
            .join('\n'),
          data: st,
        }
      }
      case 'codegraph_explore': {
        const query = String(input.query || '').trim()
        if (!query) return { ok: false, output: 'query 必填' }
        let root = input.projectRoot ? String(input.projectRoot) : ''
        if (!root) {
          try {
            const { useProjectStore } = await import('../../store/projectStore')
            root = useProjectStore.getState().root || ''
          } catch {
            /* ignore */
          }
        }
        if (!root) return { ok: false, output: '請先選擇專案目錄（專案 pill / ⌘O）' }
        const { runCodegraphExplore } = await import('../codegraphClient')
        const r = await runCodegraphExplore(root, query)
        return {
          ok: r.ok,
          output: r.ok
            ? r.output.slice(0, 12_000)
            : r.error || r.output || 'codegraph explore failed',
          data: r,
        }
      }
      case 'codegraph_impact': {
        const symbol = String(input.symbol || '').trim()
        if (!symbol) return { ok: false, output: 'symbol 必填' }
        let root = input.projectRoot ? String(input.projectRoot) : ''
        if (!root) {
          try {
            const { useProjectStore } = await import('../../store/projectStore')
            root = useProjectStore.getState().root || ''
          } catch {
            /* ignore */
          }
        }
        if (!root) return { ok: false, output: '請先選擇專案目錄' }
        const { runCodegraphImpact } = await import('../codegraphClient')
        const r = await runCodegraphImpact(root, symbol, Number(input.depth) || 2)
        return {
          ok: r.ok,
          output: r.ok ? r.output.slice(0, 12_000) : r.error || r.output || 'impact failed',
          data: r,
        }
      }
      case 'codegraph_callers': {
        const symbol = String(input.symbol || '').trim()
        if (!symbol) return { ok: false, output: 'symbol 必填' }
        let root = input.projectRoot ? String(input.projectRoot) : ''
        if (!root) {
          try {
            const { useProjectStore } = await import('../../store/projectStore')
            root = useProjectStore.getState().root || ''
          } catch {
            /* ignore */
          }
        }
        if (!root) return { ok: false, output: '請先選擇專案目錄' }
        const { runCodegraphCallers } = await import('../codegraphClient')
        const r = await runCodegraphCallers(root, symbol)
        return {
          ok: r.ok,
          output: r.ok ? r.output.slice(0, 12_000) : r.error || r.output || 'callers failed',
          data: r,
        }
      }
      default:
        return { ok: false, output: `Unknown tool: ${tool}` }
    }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

function formatSearch(r: {
  query: string
  results: Array<{ title: string; snippet: string; url?: string }>
}): string {
  if (!r.results?.length) return `No results for: ${r.query}`
  return r.results
    .map(
      (item, i) =>
        `${i + 1}. ${item.title}\n   ${item.snippet}${item.url ? `\n   ${item.url}` : ''}`,
    )
    .join('\n\n')
}

async function browserWebSearch(query: string): Promise<ToolResult> {
  // Wikipedia opensearch (CORS-friendly)
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json&origin=*`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as [string, string[], string[], string[]]
    const titles = data[1] || []
    const snippets = data[2] || []
    const links = data[3] || []
    const results = titles.map((title, i) => ({
      title,
      snippet: snippets[i] || '',
      url: links[i],
    }))
    return {
      ok: true,
      output: formatSearch({ query, results }),
      data: { query, results },
    }
  } catch (e) {
    return {
      ok: false,
      output: `web_search failed: ${e instanceof Error ? e.message : e}`,
    }
  }
}

async function browserHttpFetch(url: string, maxChars: number): Promise<ToolResult> {
  try {
    const res = await fetch(url)
    const text = (await res.text()).slice(0, maxChars)
    return { ok: res.ok, output: text || `(empty body, status ${res.status})` }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Apply Settings → Git preferences to bash commands:
 * - branch prefix on `git checkout -b` / `git switch -c` / `git branch`
 * - force-with-lease when force push is allowed / rewrite bare --force
 * - draft flag on `gh pr create`
 */
export function applyGitSettingsToBash(command: string, settings: Partial<LlmSettings>): string {
  let cmd = command
  const prefix = (settings.gitBranchPrefix || '').trim()

  // checkout -b / switch -c / branch <name>
  if (prefix) {
    cmd = cmd.replace(
      /\bgit\s+checkout\s+-b\s+([^\s;&|]+)/g,
      (_m, name: string) => {
        const n = name.replace(/^['"]|['"]$/g, '')
        if (n.startsWith(prefix) || n.includes('/')) {
          // already has path-like name or prefix
          if (n.startsWith(prefix)) return `git checkout -b ${n}`
        }
        if (n.startsWith(prefix)) return `git checkout -b ${n}`
        return `git checkout -b ${prefix}${n}`
      },
    )
    cmd = cmd.replace(
      /\bgit\s+switch\s+-c\s+([^\s;&|]+)/g,
      (_m, name: string) => {
        const n = name.replace(/^['"]|['"]$/g, '')
        if (n.startsWith(prefix)) return `git switch -c ${n}`
        return `git switch -c ${prefix}${n}`
      },
    )
    cmd = cmd.replace(
      /\bgit\s+branch\s+(?!- )([A-Za-z0-9._/-]+)/g,
      (_m, name: string) => {
        if (name.startsWith('-') || name.startsWith(prefix)) return `git branch ${name}`
        return `git branch ${prefix}${name}`
      },
    )
  }

  // Force push policy
  if (settings.gitForcePush) {
    // bare --force → --force-with-lease (safer)
    cmd = cmd.replace(
      /\bgit\s+push\b([^;&|\n]*)\s--force(?!-with-lease)\b/g,
      'git push$1 --force-with-lease',
    )
    // if push has no force but looks like rewrite of non-main? leave alone
  } else {
    // strip dangerous --force (keep lease if user wrote it intentionally? strip all force)
    cmd = cmd.replace(/\s--force-with-lease\b/g, '')
    cmd = cmd.replace(/\s--force\b/g, '')
  }

  // Draft PR default
  if (settings.gitCreateDraftPr !== false) {
    if (/\bgh\s+pr\s+create\b/.test(cmd) && !/\s--draft\b/.test(cmd)) {
      cmd = cmd.replace(/\bgh\s+pr\s+create\b/, 'gh pr create --draft')
    }
  }

  return cmd
}
