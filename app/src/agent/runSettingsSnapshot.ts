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
