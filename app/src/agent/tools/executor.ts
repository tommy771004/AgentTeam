/**
 * Tool executor — Electron IPC preferred; browser fallbacks for dev.
 */

import type { ToolName } from './registry'
import type { LlmSettings } from '../types'
import { memoryStore } from '../hermes/memory'
import { skillsStore } from '../hermes/skills'
import { listAllMcpTools, mcpCallTool } from '../hermes/mcp'
import { useSettingsStore } from '../../store/settingsStore'
import { resolveEffectiveProjectRoot } from './runContext'

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
        return { ok: true, output: `任務清單已更新（${todos.length} 項）\n${output}`, data: { todos } }
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
