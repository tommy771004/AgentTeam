/**
 * Self-registering tool module: codegraph_status
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'

register({
  name: "codegraph_status",
  toolset: "codegraph",
  description: "Check whether CodeGraph CLI is installed and project is indexed",
  keywords: ["codegraph status","index status","code index"],
  schemaParams: {"type":"object","properties":{"projectRoot":{"type":"string","description":"Optional absolute project path"}}} as Record<string, unknown>,
  owningCapability: "codegraph",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const api = window.subagents?.tools
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    const threadId = context?.threadId
    try {
    let root = input.projectRoot ? String(input.projectRoot) : ''
    if (!root) {
      try {
        const { useProjectStore } = await import('../../../store/projectStore')
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
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
