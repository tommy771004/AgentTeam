export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type PiSettings = {
  provider: string
  model: string
  thinkingLevel: PiThinkingLevel
  activeTools: string[]
  compaction: 'auto' | 'manual'
  approvalMode: 'always' | 'auto' | 'full'
  /** Segment-aware Bash policy; dangerous/unsplittable commands always ask. */
  bashRequireAsk: boolean
  unattended: boolean
  /**
   * Enables the Host-owned progressive workspace text-search pack.
   *
   * This is deliberately OFF by default. A run additionally needs an explicit,
   * valid workspace root before workspace_grep/workspace_glob can exist.
   */
  workspaceTextSearch: boolean
}

export type EffectiveAgentProfile = PiSettings

export const DEFAULT_PI_SETTINGS: PiSettings = {
  provider: '',
  model: '',
  thinkingLevel: 'medium',
  activeTools: [],
  compaction: 'auto',
  approvalMode: 'auto',
  bashRequireAsk: true,
  unattended: false,
  workspaceTextSearch: false,
}

export function isPiThinkingLevel(value: unknown): value is PiThinkingLevel {
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(value))
}

export function compileEffectiveAgentProfile(
  settings: PiSettings,
  role?: Partial<PiSettings>,
  taskOverride?: Partial<PiSettings>,
): EffectiveAgentProfile {
  return {
    provider: (taskOverride?.provider || role?.provider || settings.provider || '').trim(),
    model: (taskOverride?.model || role?.model || settings.model || '').trim(),
    thinkingLevel: taskOverride?.thinkingLevel || role?.thinkingLevel || settings.thinkingLevel,
    activeTools: [...(taskOverride?.activeTools || role?.activeTools || settings.activeTools)],
    compaction: taskOverride?.compaction || role?.compaction || settings.compaction,
    approvalMode: taskOverride?.approvalMode || role?.approvalMode || settings.approvalMode,
    bashRequireAsk: taskOverride?.bashRequireAsk ?? role?.bashRequireAsk ?? settings.bashRequireAsk,
    unattended: taskOverride?.unattended ?? role?.unattended ?? settings.unattended,
    // Governance root: per-turn/profile overrides cannot open this capability.
    // Only persisted Host Settings may change it, and turn admission freezes it.
    workspaceTextSearch: settings.workspaceTextSearch === true,
  }
}

export function validatePiSettingsPatch(patch: Record<string, unknown>): Partial<PiSettings> {
  const next: Partial<PiSettings> = {}
  if ('provider' in patch) {
    if (typeof patch.provider !== 'string') throw new Error('provider must be a string')
    next.provider = patch.provider.trim()
  }
  if ('model' in patch) {
    if (typeof patch.model !== 'string') throw new Error('model must be a string')
    next.model = patch.model.trim()
  }
  if ('thinkingLevel' in patch) {
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(patch.thinkingLevel))) {
      throw new Error(`Unsupported thinking level: ${String(patch.thinkingLevel)}`)
    }
    next.thinkingLevel = patch.thinkingLevel as PiThinkingLevel
  }
  if ('activeTools' in patch) {
    if (!Array.isArray(patch.activeTools) || patch.activeTools.some((tool) => typeof tool !== 'string')) {
      throw new Error('activeTools must be an array of strings')
    }
    next.activeTools = [...new Set(patch.activeTools as string[])].sort()
  }
  if ('compaction' in patch) {
    if (!['auto', 'manual'].includes(String(patch.compaction))) throw new Error(`Unsupported compaction: ${String(patch.compaction)}`)
    next.compaction = patch.compaction as PiSettings['compaction']
  }
  if ('approvalMode' in patch) {
    if (!['always', 'auto', 'full'].includes(String(patch.approvalMode))) throw new Error(`Unsupported approval mode: ${String(patch.approvalMode)}`)
    next.approvalMode = patch.approvalMode as PiSettings['approvalMode']
  }
  if ('bashRequireAsk' in patch) {
    if (typeof patch.bashRequireAsk !== 'boolean') throw new Error('bashRequireAsk must be a boolean')
    next.bashRequireAsk = patch.bashRequireAsk
  }
  if ('unattended' in patch) {
    if (typeof patch.unattended !== 'boolean') throw new Error('unattended must be a boolean')
    next.unattended = patch.unattended
  }
  if ('workspaceTextSearch' in patch) {
    if (typeof patch.workspaceTextSearch !== 'boolean') throw new Error('workspaceTextSearch must be a boolean')
    next.workspaceTextSearch = patch.workspaceTextSearch
  }
  return next
}
