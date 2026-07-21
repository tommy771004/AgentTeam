/**
 * Self-registering tool module: monitor
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "monitor",
  toolset: "monitoring",
  description: "Stream a long-running command; each output line becomes a Proactive event",
  keywords: ["monitor","watch","tail","stream","log","ci","poll"],
  schemaParams: {"type":"object","properties":{"action":{"type":"string","enum":["start","stop","list"],"description":"start a stream, stop one by id, or list active monitors"},"command":{"type":"string","description":"start: shell command whose output lines become events. ALWAYS use line-buffered filters (grep --line-buffered) — raw log streams get auto-stopped for volume."},"description":{"type":"string","description":"start: short label shown on every event (3-6 words)"},"id":{"type":"string","description":"stop: monitor id"}},"required":["action"]} as Record<string, unknown>,
  owningCapability: "monitoring",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    const monitorApi = window.subagents?.monitor
    if (!monitorApi) return { ok: false, output: 'monitor 僅支援 Electron 環境' }
    const action = String(input.action || 'list')
    if (action === 'start') {
      const command = String(input.command || '').trim()
      const description = String(input.description || '').trim()
      if (!command || !description) {
        return { ok: false, output: 'monitor start 需要 command 與 description' }
      }
      const r = await monitorApi.start({ command, description, cwd: projectRoot })
      return {
        ok: r.ok,
        output: r.ok
          ? `monitor 已啟動:${r.id}(${description})\n每行輸出會成為 source=monitor 的 Proactive 事件;事件太多會自動停止 — filter 請用 grep --line-buffered。用 monitor action=stop id=${r.id} 停止。`
          : r.error || 'monitor 啟動失敗',
        data: r,
      }
    }
    if (action === 'stop') {
      const id = String(input.id || '').trim()
      if (!id) return { ok: false, output: 'monitor stop 需要 id' }
      const stopped = await monitorApi.stop(id)
      return { ok: stopped, output: stopped ? `monitor 已停止:${id}` : `找不到 monitor:${id}` }
    }
    const list = await monitorApi.list()
    return {
      ok: true,
      output: list.length
        ? list
            .map((m) => `· ${m.id}(${m.description})lines=${m.lineCount} since ${m.startedAt}\n  $ ${m.command}`)
            .join('\n')
        : '(無進行中的 monitor)',
      data: list,
    }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
