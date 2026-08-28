export type CliCapabilitySupport = 'native' | 'provider-config' | 'provider-default' | 'unsupported'

export type CliProviderCapabilitySnapshot = Readonly<{
  provider: string
  binaryPath: string
  version: string
  revision: string
  detectedAt: string
  approval: Readonly<{
    always: CliCapabilitySupport
    auto: CliCapabilitySupport
    full: CliCapabilitySupport
  }>
  agentMode: Readonly<{
    build: CliCapabilitySupport
    plan: CliCapabilitySupport
  }>
  thinkingEffort: CliCapabilitySupport
  maxTurns: CliCapabilitySupport
  runtimeInput: 'typed-json' | 'stdin' | 'none'
  serviceTiers: readonly string[]
}>

function has(help: string, value: string): boolean {
  return help.toLowerCase().includes(value.toLowerCase())
}

function detectedServiceTiers(help: string): string[] {
  return has(help, '--service-tier') ? ['standard', 'priority', 'flex'] : []
}

/** Interpret one exact binary/version help snapshot; no filesystem access. */
export function capabilitiesFromCliHelp(input: {
  provider: string
  binaryPath: string
  version: string
  revision: string
  detectedAt: string
  help: string
}): CliProviderCapabilitySnapshot {
  const provider = input.provider === 'anthropic' ? 'claude'
    : input.provider === 'google' ? 'gemini'
      : input.provider
  const help = input.help
  const defaults = {
    provider,
    binaryPath: input.binaryPath,
    version: input.version,
    revision: input.revision,
    detectedAt: input.detectedAt,
    serviceTiers: detectedServiceTiers(help),
  }
  if (provider === 'codex') {
    return Object.freeze({
      ...defaults,
      approval: Object.freeze({
        always: has(help, '--config') ? 'provider-config' as const : 'unsupported' as const,
        auto: has(help, '--approve-for-me') ? 'native' as const : 'unsupported' as const,
        full: has(help, '--dangerously-bypass-approvals-and-sandbox') ? 'native' as const : 'unsupported' as const,
      }),
      agentMode: Object.freeze({ build: 'native' as const, plan: has(help, 'read-only') ? 'native' as const : 'unsupported' as const }),
      thinkingEffort: has(help, '--config') ? 'provider-config' as const : 'unsupported' as const,
      maxTurns: 'unsupported' as const,
      runtimeInput: 'stdin' as const,
    })
  }
  if (provider === 'claude' || provider === 'grok') {
    const modes = has(help, '--permission-mode')
    return Object.freeze({
      ...defaults,
      approval: Object.freeze({
        always: modes ? 'native' as const : 'unsupported' as const,
        auto: modes ? 'native' as const : 'unsupported' as const,
        full: has(help, provider === 'claude' ? '--dangerously-skip-permissions' : '--always-approve') ? 'native' as const : 'unsupported' as const,
      }),
      agentMode: Object.freeze({ build: modes ? 'native' as const : 'provider-default' as const, plan: has(help, 'plan') ? 'native' as const : 'unsupported' as const }),
      thinkingEffort: has(help, '--effort') || has(help, '--reasoning-effort') ? 'native' as const : 'unsupported' as const,
      maxTurns: has(help, '--max-turns') ? 'native' as const : 'unsupported' as const,
      runtimeInput: has(help, 'stream-json') && has(help, '--input-format') ? 'typed-json' as const : 'stdin' as const,
    })
  }
  if (provider === 'opencode') {
    return Object.freeze({
      ...defaults,
      approval: Object.freeze({ always: 'provider-config' as const, auto: 'provider-config' as const, full: 'unsupported' as const }),
      agentMode: Object.freeze({ build: has(help, '--agent') ? 'native' as const : 'provider-config' as const, plan: has(help, '--agent') ? 'native' as const : 'provider-config' as const }),
      thinkingEffort: has(help, '--variant') ? 'provider-config' as const : 'unsupported' as const,
      maxTurns: 'unsupported' as const,
      runtimeInput: 'none' as const,
    })
  }
  if (provider === 'cursor') {
    return Object.freeze({
      ...defaults,
      approval: Object.freeze({ always: 'provider-default' as const, auto: 'provider-default' as const, full: has(help, '--force') ? 'native' as const : 'unsupported' as const }),
      agentMode: Object.freeze({ build: 'provider-default' as const, plan: 'unsupported' as const }),
      thinkingEffort: 'unsupported' as const,
      maxTurns: 'unsupported' as const,
      runtimeInput: 'stdin' as const,
    })
  }
  return Object.freeze({
    ...defaults,
    approval: Object.freeze({ always: 'provider-default' as const, auto: 'provider-default' as const, full: 'unsupported' as const }),
    agentMode: Object.freeze({ build: 'provider-default' as const, plan: 'unsupported' as const }),
    thinkingEffort: 'unsupported' as const,
    maxTurns: 'unsupported' as const,
    runtimeInput: 'none' as const,
  })
}
