/**
 * Self-registering tool module: bash
 * Hermes-style import-time register(). I/O lives here (no central switch).
 */
import { register } from '../toolRegistry.ts'
import { resolveEffectiveProjectRoot } from '../runContext.ts'
import type { ToolExecutionContext } from '../toolIoHelpers.ts'
import { applyGitSettingsToBash } from '../toolIoHelpers.ts'

register({
  name: "bash",
  toolset: "shell",
  description: "Run a shell command in Electron (bash / cmd)",
  keywords: ["bash","shell","command","terminal","exec","run script","git","npm"],
  schemaParams: {"type":"object","properties":{"command":{"type":"string","description":"Shell command to run"},"timeoutMs":{"type":"integer","description":"Timeout ms (default 60000)"}},"required":["command"]} as Record<string, unknown>,
  owningCapability: "shell",
  handler: async (args, ctx) => {
    const input = args
    const context = ctx as ToolExecutionContext | undefined
    const projectRoot = await resolveEffectiveProjectRoot(context?.projectRoot, context?.runId)
    const runId = context?.runId
    try {
    if (!window.subagents?.shell?.bash) {
      return { ok: false, output: 'bash 僅支援 Electron 環境' }
    }
    // Prefer per-run pin, then UI project root
    const cwd = projectRoot
    let command = String(input.command || '')
    let shellDegradedNote: string | undefined
    // Enforce Git preferences from Settings
    let settingsForGuard: {
      outboundProtectionEnabled?: boolean
      outboundGuardDeploy?: 'off' | 'demo' | 'optional' | 'required'
    } = {}
    try {
      const { useSettingsStore } = await import('../../../store/settingsStore')
      settingsForGuard = useSettingsStore.getState().settings
      command = applyGitSettingsToBash(command, useSettingsStore.getState().settings)
    } catch {
      /* ignore */
    }

    // Ticket 21: protection → deny unisolated shell / absolute escape paths
    try {
      const { effectiveOutboundGuardFromSettings } = await import(
        '../../outbound/outboundGate.ts'
      )
      const { decideBuiltinShellUnderProtection } = await import(
        '../../outbound/cliSandbox.ts'
      )
      const { getRestrictedViewRootForRun } = await import(
        '../../outbound/sanitizedWorkspace.ts'
      )
      const mode = effectiveOutboundGuardFromSettings(settingsForGuard)
      const viewRoot = getRestrictedViewRootForRun(runId) || cwd
      const shellGate = decideBuiltinShellUnderProtection({
        effectiveMode: mode,
        command,
        viewRoot,
        shellIsolationVerified: false,
      })
      if (!shellGate.allow) {
        return {
          ok: false,
          output: shellGate.reason || '出站資料閘門：已拒絕 builtin shell',
        }
      }
      if (shellGate.degraded && shellGate.reason) {
        shellDegradedNote = shellGate.reason
      }
    } catch {
      /* ignore guard load failures outside electron */
    }

    const r = await window.subagents.shell.bash({
      command,
      timeoutMs: Number(input.timeoutMs) || 60_000,
      cwd,
      runId,
    })
    const out = [
      shellDegradedNote && `[outbound-shell] ${shellDegradedNote}`,
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
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) }
    }
  },
})
