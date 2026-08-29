import type { OutboundGuardMode } from './outbound/outboundGate.ts'
import { gitCommandPolicyFromSettings } from './tools/gitCommandPolicy.ts'
import type { ApprovalMode, LlmSettings, RunContextPolicy, RuntimeOverrides } from './types.ts'
import { collectHookRules } from './hooks.ts'

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
  const restrictiveHooks = collectHookRules(settings)
    .filter((rule) => rule.point === 'beforeTool' && rule.enabled !== false
      && (rule.action === 'deny' || rule.action === 'require-approval'))
  const hookPattern = (rule: (typeof restrictiveHooks)[number]) => rule.match?.tool || '*'
  return {
    memoryEnabled,
    memoryWriteEnabled: memoryEnabled && settings.memoryWriteEnabled !== false,
    referenceChatHistory: settings.referenceChatHistory !== false,
    temporary,
    ...(input.project?.trim() ? { project: input.project.trim() } : {}),
    contextWindowTokens: settings.modelProfiles?.[model]?.contextWindow
      || settings.defaultContextWindowTokens,
    deniedTools: [...new Set(restrictiveHooks.filter((rule) => rule.action === 'deny').map(hookPattern))],
    approvalTools: [...new Set(restrictiveHooks.filter((rule) => rule.action === 'require-approval').map(hookPattern))],
    // Frozen with the rest of the run: changing a Git preference mid-run must
    // not change what an in-flight command is allowed to do.
    gitPolicy: gitCommandPolicyFromSettings(settings),
  }
}

/**
 * Pin this run's builtin-shell posture into the frozen context policy (ADR-0047).
 *
 * The mode and the Restricted Project View are only known once the Outbound Data
 * Gate has admitted the run, so they arrive after buildRunContextPolicy rather
 * than inside it. Two rules hold here: the posture is the mode the gate actually
 * admitted under (never re-derived, so the shell gate and the view cannot
 * disagree). Sandbox evidence is not part of this renderer-owned projection:
 * ADR-0051 allows only the Host verifier to issue it.
 */
export function withRunShellPolicy(
  policy: RunContextPolicy,
  input: { effectiveMode: OutboundGuardMode; viewRoot?: string; connectionId?: string },
): RunContextPolicy {
  const viewRoot = (input.viewRoot || '').trim()
  return {
    ...policy,
    outboundShellMode: input.effectiveMode,
    ...(input.connectionId?.trim() ? { outboundConnectionId: input.connectionId.trim() } : {}),
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
