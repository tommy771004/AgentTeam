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
  /** Host-authored facts; never inferred from stdin/help wording. */
  collaboration: Readonly<{
    sessionReuse: 'unsupported'
    mailbox: 'unsupported'
    followUp: 'unsupported'
    wait: 'unsupported'
    interrupt: 'host-process'
    completion: 'runner-settlement'
  }>
}>

function has(help: string, value: string): boolean {
  return help.toLowerCase().includes(value.toLowerCase())
}

function detectedServiceTiers(help: string): string[] {
  return has(help, '--service-tier') ? ['standard', 'priority', 'flex'] : []
}

type CapabilityDefaults = Pick<
  CliProviderCapabilitySnapshot,
  'provider' | 'binaryPath' | 'version' | 'revision' | 'detectedAt' | 'serviceTiers'
  | 'collaboration'
>

function supportWhen(condition: boolean, supported: CliCapabilitySupport): CliCapabilitySupport {
  return condition ? supported : 'unsupported'
}

function codexCapabilities(defaults: CapabilityDefaults, help: string): CliProviderCapabilitySnapshot {
  return Object.freeze({
    ...defaults,
    approval: Object.freeze({
      always: supportWhen(has(help, '--config'), 'provider-config'),
      auto: supportWhen(has(help, '--approve-for-me'), 'native'),
      full: supportWhen(has(help, '--dangerously-bypass-approvals-and-sandbox'), 'native'),
    }),
    agentMode: Object.freeze({ build: 'native', plan: supportWhen(has(help, 'read-only'), 'native') }),
    thinkingEffort: supportWhen(has(help, '--config'), 'provider-config'),
    maxTurns: 'unsupported',
    runtimeInput: 'stdin',
  })
}

function claudeOrGrokCapabilities(
  defaults: CapabilityDefaults,
  help: string,
  provider: 'claude' | 'grok',
): CliProviderCapabilitySnapshot {
  const modes = has(help, '--permission-mode')
  const fullFlag = provider === 'claude' ? '--dangerously-skip-permissions' : '--always-approve'
  return Object.freeze({
    ...defaults,
    approval: Object.freeze({
      always: supportWhen(modes, 'native'),
      auto: supportWhen(modes, 'native'),
      full: supportWhen(has(help, fullFlag), 'native'),
    }),
    agentMode: Object.freeze({
      build: modes ? 'native' : 'provider-default',
      plan: supportWhen(has(help, 'plan'), 'native'),
    }),
    thinkingEffort: supportWhen(has(help, '--effort') || has(help, '--reasoning-effort'), 'native'),
    maxTurns: supportWhen(has(help, '--max-turns'), 'native'),
    runtimeInput: has(help, 'stream-json') && has(help, '--input-format') ? 'typed-json' : 'stdin',
  })
}

function cursorCapabilities(defaults: CapabilityDefaults, help: string): CliProviderCapabilitySnapshot {
  return Object.freeze({
    ...defaults,
    approval: Object.freeze({
      always: 'provider-default',
      auto: 'provider-default',
      full: supportWhen(has(help, '--force'), 'native'),
    }),
    agentMode: Object.freeze({ build: 'provider-default', plan: 'unsupported' }),
    thinkingEffort: 'unsupported',
    maxTurns: 'unsupported',
    runtimeInput: 'stdin',
  })
}

function fallbackCapabilities(defaults: CapabilityDefaults): CliProviderCapabilitySnapshot {
  return Object.freeze({
    ...defaults,
    approval: Object.freeze({ always: 'provider-default', auto: 'provider-default', full: 'unsupported' }),
    agentMode: Object.freeze({ build: 'provider-default', plan: 'unsupported' }),
    thinkingEffort: 'unsupported',
    maxTurns: 'unsupported',
    runtimeInput: 'none',
  })
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
    collaboration: Object.freeze({
      sessionReuse: 'unsupported' as const,
      mailbox: 'unsupported' as const,
      followUp: 'unsupported' as const,
      wait: 'unsupported' as const,
      interrupt: 'host-process' as const,
      completion: 'runner-settlement' as const,
    }),
  }
  if (provider === 'codex') return codexCapabilities(defaults, help)
  if (provider === 'claude' || provider === 'grok') return claudeOrGrokCapabilities(defaults, help, provider)
  if (provider === 'cursor') return cursorCapabilities(defaults, help)
  return fallbackCapabilities(defaults)
}
