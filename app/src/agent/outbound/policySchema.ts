/**
 * Versioned JSON schemas for Company Base + Provider Supplemental policy.
 * Files live under Electron main ownership — never project or renderer localStorage.
 */

export type PolicyDetector = {
  id: string
  /** JS-compatible source pattern; compiled carefully by sanitizer (ticket 03). */
  pattern: string
  flags?: string
  description?: string
}

export type CompanyBasePolicy = {
  schemaVersion: 1
  kind: 'company-base'
  version: number
  changeId: string
  /** Irreducible baseline detector ids — cannot be disabled by supplements. */
  baselineDetectorIds: string[]
  detectors: PolicyDetector[]
  /** Default true: images denied unless visionAuthorization is set on this company base only. */
  denyImageVision: boolean
  /**
   * Ticket 09: only Company Base may authorize vision on a pinned company classifier.
   * Provider supplements and user settings cannot enable vision.
   */
  visionAuthorization?: {
    enabled: true
    endpointUrl: string
  }
  offlineCache?: {
    maxAgeHours: number
    onExpired: 'block' | 'basic' | 'use-stale'
  }
  evidence?: {
    onKeyUnavailable?: 'block' | 'unsealed'
    retentionWeeks?: number
  }
}

export type ProviderSupplementalPolicy = {
  schemaVersion: 1
  kind: 'provider-supplement'
  connectionId: string
  version: number
  changeId: string
  extraDetectors: PolicyDetector[]
  /** Must always be empty / absent — presence is a validation failure (cannot weaken baseline). */
  disabledBaselineDetectorIds?: string[]
  /** Only true is allowed as a tighten; false/undefined does not relax base. */
  denyImageVision?: boolean
}

/** Built-in floor created when company-base.json is missing. */
export const BUILTIN_BASELINE_POLICY: CompanyBasePolicy = {
  schemaVersion: 1,
  kind: 'company-base',
  version: 1,
  changeId: 'builtin-baseline-v1',
  baselineDetectorIds: [
    'baseline.api-key',
    'baseline.private-key',
    'baseline.password-field',
    'baseline.connection-string',
    'baseline.aws-key',
    'baseline.tw-national-id',
    'baseline.email',
    'baseline.phone-tw',
    'baseline.credit-card',
    'baseline.sensitive-path',
  ],
  detectors: [
    {
      id: 'baseline.api-key',
      pattern: '(?i)(api[_-]?key|access[_-]?token|secret[_-]?key)\\s*[:=]\\s*\\S+',
      description: 'API keys / tokens',
    },
    {
      id: 'baseline.private-key',
      pattern: '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
      description: 'PEM private keys',
    },
    {
      id: 'baseline.password-field',
      pattern: '(?i)(password|passwd|pwd)\\s*[:=]\\s*\\S+',
      description: 'Password fields',
    },
    {
      id: 'baseline.connection-string',
      pattern: '(?i)(postgres|mysql|mongodb|redis):\\/\\/\\S+',
      description: 'DB connection strings',
    },
    {
      id: 'baseline.aws-key',
      pattern: 'AKIA[0-9A-Z]{16}',
      description: 'AWS access key id',
    },
    {
      id: 'baseline.tw-national-id',
      pattern: '[A-Z][12]\\d{8}',
      description: 'Taiwan national ID pattern',
    },
    {
      id: 'baseline.email',
      pattern: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}',
      flags: 'i',
      description: 'Email addresses',
    },
    {
      id: 'baseline.phone-tw',
      pattern: '(?:\\+886[- ]?|0)9\\d{2}[- ]?\\d{3}[- ]?\\d{3}',
      description: 'Taiwan mobile phones',
    },
    {
      id: 'baseline.credit-card',
      pattern: '\\b(?:\\d[ -]*?){13,19}\\b',
      description: 'Payment card digit runs (Luhn applied in sanitizer)',
    },
    {
      id: 'baseline.sensitive-path',
      pattern: '(?i)(?:^|[/\\\\])(?:\\.env(?:\\..+)?|.*\\.(?:pem|key|p12|pfx)|.*(?:credential|secret)s?(?:\\.|$))',
      description: 'Sensitive path names',
    },
  ],
  denyImageVision: true,
  offlineCache: { maxAgeHours: 72, onExpired: 'block' },
  evidence: { onKeyUnavailable: 'block', retentionWeeks: 12 },
}

export function emptySupplementalPolicy(connectionId: string): ProviderSupplementalPolicy {
  return {
    schemaVersion: 1,
    kind: 'provider-supplement',
    connectionId,
    version: 1,
    changeId: 'empty-supplement-v1',
    extraDetectors: [],
  }
}

export function validateCompanyBasePolicy(raw: unknown): CompanyBasePolicy {
  if (!raw || typeof raw !== 'object') throw new Error('invalid company-base: not an object')
  const p = raw as Partial<CompanyBasePolicy>
  if (p.schemaVersion !== 1) throw new Error('invalid company-base: schemaVersion')
  if (p.kind !== 'company-base') throw new Error('invalid company-base: kind')
  if (typeof p.version !== 'number' || p.version < 1) throw new Error('invalid company-base: version')
  if (!Array.isArray(p.detectors) || !Array.isArray(p.baselineDetectorIds)) {
    throw new Error('invalid company-base: detectors')
  }
  return p as CompanyBasePolicy
}

export function validateProviderSupplementalPolicy(raw: unknown): ProviderSupplementalPolicy {
  if (!raw || typeof raw !== 'object') throw new Error('invalid provider-supplement: not an object')
  const p = raw as Partial<ProviderSupplementalPolicy>
  if (p.schemaVersion !== 1) throw new Error('invalid provider-supplement: schemaVersion')
  if (p.kind !== 'provider-supplement') throw new Error('invalid provider-supplement: kind')
  if (!p.connectionId) throw new Error('invalid provider-supplement: connectionId')
  if (typeof p.version !== 'number' || p.version < 1) {
    throw new Error('invalid provider-supplement: version')
  }
  if (!Array.isArray(p.extraDetectors)) throw new Error('invalid provider-supplement: extraDetectors')
  if (Array.isArray(p.disabledBaselineDetectorIds) && p.disabledBaselineDetectorIds.length > 0) {
    throw new Error(
      'provider-supplement cannot weaken baseline (disabledBaselineDetectorIds not allowed)',
    )
  }
  return p as ProviderSupplementalPolicy
}
