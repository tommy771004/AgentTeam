import type { AgentMode } from './types.ts'

export function getPrimaryAgent(mode?: AgentMode) {
  return mode === 'plan'
    ? { id: 'plan' as const, label: 'Plan' }
    : { id: 'build' as const, label: 'Build' }
}

export function nextPrimaryAgent(mode?: AgentMode): AgentMode {
  return mode === 'plan' ? 'build' : 'plan'
}
