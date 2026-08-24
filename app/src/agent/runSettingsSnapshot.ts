import type { OutboundGuardMode } from './outbound/outboundGate.ts'
import type { ApprovalMode, LlmSettings, RunContextPolicy, RuntimeOverrides } from './types.ts'

/** Clone Settings once at coordinator admission so queued/in-flight runs cannot drift. */
export function snapshotRunSettings(settings: LlmSettings): LlmSettings {
  return structuredClone(settings)
}

/** Resolve the context/memory contract once from the frozen settings projection. */
export function buildRunContextPolicy(
  settings: LlmSettings,
  input: { model?: string; temporary?: boolean; project?: string },
): RunContextPolicy {
  const model = input.model || settings.model
  const temporary = input.temporary === true
  const memoryEnabled = settings.memoryEnabled !== false && !temporary
  return {
    memoryEnabled,
    memoryWriteEnabled: memoryEnabled && settings.memoryWriteEnabled !== false,
    referenceChatHistory: settings.referenceChatHistory !== false,
    temporary,
    ...(input.project?.trim() ? { project: input.project.trim() } : {}),
    contextWindowTokens: settings.modelProfiles?.[model]?.contextWindow
      || settings.defaultContextWindowTokens,
  }
}

/**
 * Pin this run's builtin-shell posture into the frozen context policy (ADR-0047).
 *
 * The mode and the Restricted Project View are only known once the Outbound Data
 * Gate has admitted the run, so they arrive after buildRunContextPolicy rather
 * than inside it. Two rules hold here: the posture is the mode the gate actually
 * admitted under (never re-derived, so the shell gate and the view cannot
 * disagree), and isolation is never claimed from the renderer — only main-side
 * proof may set `shellIsolationVerified`, so `required` without a verified
 * sandbox stays a denial on the Host.
 */
export function withRunShellPolicy(
  policy: RunContextPolicy,
  input: { effectiveMode: OutboundGuardMode; viewRoot?: string },
): RunContextPolicy {
  const viewRoot = (input.viewRoot || '').trim()
  return {
    ...policy,
    outboundShellMode: input.effectiveMode,
    ...(viewRoot ? { viewRoot } : {}),
  }
}

/** Resolve mutable Settings + conversation preferences into one admitted run snapshot. */
export function resolveRunSettingsOverrides(
  settings: LlmSettings,
  input: {
    model?: string
    thinkingDepth?: RuntimeOverrides['thinkingDepth']
    speed?: RuntimeOverrides['speed']
    approvalMode?: ApprovalMode
    temporary?: boolean
    project?: string
  },
): Pick<RuntimeOverrides, 'model' | 'thinkingDepth' | 'speed' | 'approvalMode' | 'temporary' | 'contextPolicySnapshot'> {
  const model = input.model || settings.model || undefined
  const temporary = input.temporary ?? settings.temporaryChatDefault === true
  return {
    model,
    thinkingDepth: input.thinkingDepth,
    speed: input.speed,
    approvalMode: input.approvalMode || settings.approvalMode,
    temporary,
    contextPolicySnapshot: buildRunContextPolicy(settings, {
      model,
      temporary,
      project: input.project,
    }),
  }
}
