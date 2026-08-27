import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { PiToolContractSource } from './piToolContract.ts'

export type PiInvocationOrigin = 'model' | 'direct-protocol' | 'code-mode' | 'mcp'
export type PiPolicyVerdict = 'allow' | 'ask' | 'deny'
export type PiPolicyEvidencePhase = 'start' | 'decision' | 'update' | 'result' | 'settlement'

export type PiInvocationCoordinates = {
  sessionId: string
  runId: string
  callId: string
  parentRunId?: string
}

export type PiInvocationContractIdentity = {
  contractRevision: number
  contractDigest: string
  schemaDigest: string
  toolSource: PiToolContractSource
  toolPack?: string
}

export type PiFrozenRunPolicy = Readonly<{
  approvalMode: 'always' | 'auto' | 'full'
  unattended: boolean
  approvalTimeoutMs: number
  projectRoot: string
  outbound: Readonly<{
    mode: 'required' | 'optional' | 'demo' | 'off'
    restrictedViewRoot?: string
  }>
  deniedTools: readonly string[]
  approvalTools: readonly string[]
  resourceView?: Readonly<{
    root: string
    digest: string
    manifest: readonly string[]
    fileDigests?: Readonly<Record<string, string>>
  }>
}>

export type PiToolPolicyRequirements = Readonly<{
  /** Capability-declared approval survives complete/full access. */
  capabilityApproval?: string
  /** Ordinary effect approval is bypassed only by attended full access. */
  approvalRequired?: string
  /** Human-in-the-loop asks (ask_user) prompt even under complete/full access; unattended still denies. */
  hitl?: boolean
  sideEffect?: boolean
  /** Explicit opt-in for a read-only contract that still requires Skill preflight. */
  skillPreflight?: boolean
  outbound?: boolean
  pathArguments?: readonly string[]
}>

/** Contract-metadata classification; model or tool names never participate. */
export function shouldRunSkillPreflight(requirements: PiToolPolicyRequirements): boolean {
  return requirements.sideEffect === true || requirements.skillPreflight === true
}

export type PiPolicyEvaluation = {
  verdict: PiPolicyVerdict
  reason: string
  normalizedArgs: Readonly<Record<string, unknown>>
  evidence: Readonly<{
    outboundMode: PiFrozenRunPolicy['outbound']['mode']
    restrictedViewRoot?: string
    degraded: boolean
    outboundDecision: 'not-applicable' | 'allow' | 'deny' | 'degraded'
    restrictedViewDecision: 'not-applicable' | 'allow' | 'deny'
    resourceViewDecision: 'not-applicable' | 'allow' | 'deny'
  }>
  /** Pure directive: the Host execution seam must consume this before execution. */
  skillPreflight?: Readonly<{
    required: true
    trigger: 'state-changing-tool-call' | 'contract-required-tool-call'
  }>
}

export type PiPolicyEvidenceEvent = PiInvocationCoordinates & PiInvocationContractIdentity & {
  tool: string
  origin: PiInvocationOrigin
  phase: PiPolicyEvidencePhase
  decision?: PiPolicyVerdict
  settlement?: 'success' | 'failed' | 'cancelled' | 'denied'
  detail?: string
}

/**
 * Explicit expand/contract ledger. Ticket 06 began with model-originated
 * workspace_download; Ticket 07 adds contract-bound direct and Code Mode
 * origins. Remaining origins stay visible so a green slice is never mistaken
 * for the completed migration.
 */
export const PI_POLICY_EVIDENCE_MIGRATION_INVENTORY = Object.freeze({
  migrated: Object.freeze([
    'model:pi-builtin',
    'model:extension-pack:all',
    'model:extension-pack:workspace_download',
    'direct-protocol:pi-builtin',
    'direct-protocol:extension-pack',
    'code-mode:nested',
    'model:mcp:native',
    'mcp:bridge',
  ]),
  pending: Object.freeze([]),
})

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function freezeResourceView(value: unknown): PiFrozenRunPolicy['resourceView'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const resource = value as Record<string, unknown>
  return {
    root: resolve(String(resource.root || '')),
    digest: String(resource.digest || ''),
    manifest: Array.isArray(resource.manifest)
      ? resource.manifest.filter((item): item is string => typeof item === 'string')
      : [],
    ...(resource.fileDigests && typeof resource.fileDigests === 'object'
      ? { fileDigests: { ...resource.fileDigests as Record<string, string> } }
      : {}),
  }
}

export function freezePiRunPolicy(input: {
  approvalMode?: unknown
  unattended?: unknown
  approvalTimeoutMs?: unknown
  projectRoot: string
  outboundMode?: unknown
  restrictedViewRoot?: unknown
  deniedTools?: unknown
  approvalTools?: unknown
  resourceView?: unknown
}): PiFrozenRunPolicy {
  const unattended = input.unattended === true
  const timeout = typeof input.approvalTimeoutMs === 'number' && Number.isFinite(input.approvalTimeoutMs)
    ? Math.max(1, Math.floor(input.approvalTimeoutMs))
    : unattended ? 45_000 : 90_000
  const mode = input.outboundMode === 'required' || input.outboundMode === 'optional'
    || input.outboundMode === 'demo' || input.outboundMode === 'off'
    ? input.outboundMode
    : 'off'
  const resourceView = freezeResourceView(input.resourceView)
  return freezeDeep({
    approvalMode: input.approvalMode === 'always' || input.approvalMode === 'full'
      ? input.approvalMode
      : 'auto',
    unattended,
    approvalTimeoutMs: timeout,
    projectRoot: resolve(input.projectRoot),
    outbound: {
      mode,
      ...(typeof input.restrictedViewRoot === 'string' && input.restrictedViewRoot.trim()
        ? { restrictedViewRoot: resolve(input.restrictedViewRoot) }
        : {}),
    },
    deniedTools: Array.isArray(input.deniedTools)
      ? input.deniedTools.filter((name): name is string => typeof name === 'string')
      : [],
    approvalTools: Array.isArray(input.approvalTools)
      ? input.approvalTools.filter((name): name is string => typeof name === 'string')
      : [],
    ...(resourceView ? { resourceView } : {}),
  })
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Resolve existing symlinked ancestors while retaining a lexical tail. */
function resolveExistingPath(path: string): string {
  let cursor = resolve(path)
  const tail: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    tail.unshift(cursor.slice(parent.length + 1))
    cursor = parent
  }
  let resolved = cursor
  try {
    resolved = realpathSync.native(cursor)
  } catch {
    resolved = resolve(cursor)
  }
  return tail.reduce((current, part) => resolve(current, part), resolved)
}

/**
 * Pure policy composition. It consumes an admission-frozen policy and exact
 * contract identity, but performs neither HITL nor tool execution.
 */
export function evaluatePiInvocationPolicy(input: {
  coordinates: PiInvocationCoordinates
  origin: PiInvocationOrigin
  tool: string
  contract: PiInvocationContractIdentity
  args: Record<string, unknown>
  policy: PiFrozenRunPolicy
  requirements?: PiToolPolicyRequirements
}): PiPolicyEvaluation {
  const normalized: Record<string, unknown> = { ...input.args }
  const lexicalRoot = input.policy.outbound.restrictedViewRoot || input.policy.projectRoot
  const root = resolveExistingPath(lexicalRoot)
  const resourceLexicalRoot = input.policy.resourceView ? resolve(input.policy.resourceView.root) : undefined
  const resourceRoot = resourceLexicalRoot ? resolveExistingPath(resourceLexicalRoot) : undefined
  const resourceManifest = new Set(input.policy.resourceView?.manifest || [])
  const resourceFields = new Set<string>()
  const resourceAttemptedFields = new Set<string>()
  if (input.tool === 'read' && resourceRoot) {
    for (const field of input.requirements?.pathArguments || []) {
      const value = normalized[field]
      if (typeof value !== 'string' || !value.trim()) continue
      const lexicalCandidate = resolve(value)
      if (resourceLexicalRoot && within(resourceLexicalRoot, lexicalCandidate)) resourceAttemptedFields.add(field)
      const candidate = resolveExistingPath(lexicalCandidate)
      const rel = relative(resourceRoot, candidate)
      if (within(resourceRoot, candidate) && resourceManifest.has(rel)) resourceFields.add(field)
    }
  }
  const evidence = freezeDeep({
    outboundMode: input.policy.outbound.mode,
    ...(input.policy.outbound.restrictedViewRoot ? { restrictedViewRoot: input.policy.outbound.restrictedViewRoot } : {}),
    degraded: input.policy.outbound.mode !== 'off' && !input.policy.outbound.restrictedViewRoot,
    outboundDecision: input.requirements?.outbound
      ? input.policy.outbound.mode === 'off'
        ? 'allow' as const
        : input.policy.outbound.restrictedViewRoot
          ? 'allow' as const
          : input.policy.outbound.mode === 'required'
            ? 'deny' as const
            : 'degraded' as const
      : 'not-applicable' as const,
    restrictedViewDecision: (input.requirements?.pathArguments?.length || 0) > 0 && resourceAttemptedFields.size === 0
      ? 'allow' as const
      : 'not-applicable' as const,
    resourceViewDecision: resourceFields.size > 0
      ? 'allow' as const
      : resourceAttemptedFields.size > 0
        ? 'deny' as const
        : 'not-applicable' as const,
  })
  const finish = (verdict: PiPolicyVerdict, reason: string): PiPolicyEvaluation => ({
    verdict,
    reason,
    normalizedArgs: freezeDeep(normalized),
    evidence,
    ...(input.origin === 'model' && shouldRunSkillPreflight(input.requirements || {}) ? {
      skillPreflight: Object.freeze({
        required: true as const,
        trigger: input.requirements?.sideEffect === true
          ? 'state-changing-tool-call' as const
          : 'contract-required-tool-call' as const,
      }),
    } : {}),
  })

  if (!input.coordinates.sessionId || !input.coordinates.runId || !input.coordinates.callId
    || !Number.isInteger(input.contract.contractRevision) || input.contract.contractRevision < 1
    || !/^[a-f0-9]{64}$/.test(input.contract.schemaDigest)) {
    return finish('deny', 'Invocation coordinates or tool contract identity are incomplete')
  }
  const matchesTool = (patterns: readonly string[]) => patterns.some((pattern) => pattern === '*'
    || pattern === input.tool
    || (pattern.endsWith('*') && input.tool.startsWith(pattern.slice(0, -1))))
  if (matchesTool(input.policy.deniedTools)) return finish('deny', `Restrictive run policy denies ${input.tool}`)

  for (const field of input.requirements?.pathArguments || []) {
    const value = normalized[field]
    if (typeof value !== 'string' || !value.trim()) continue
    if (resourceFields.has(field)) {
      normalized[field] = resolve(String(value))
      continue
    }
    if (resourceAttemptedFields.has(field)) {
      return finish('deny', `${field} is not in the frozen Skill Resource View manifest`)
    }
    const lexicalCandidate = resolve(lexicalRoot, value)
    const candidate = resolveExistingPath(lexicalCandidate)
    if (!within(root, candidate)) {
      return {
        ...finish('deny', `${field} escapes the frozen Restricted Project View`),
        evidence: freezeDeep({ ...evidence, restrictedViewDecision: 'deny' as const }),
      }
    }
    // Keep the lexical form rooted at the exact cwd/view passed to the tool.
    // The authorization check above uses real paths, but rewriting `/var` to
    // `/private/var` would make the legacy tool's own lexical scope check
    // reject an otherwise valid path on macOS.
    normalized[field] = lexicalCandidate
  }

  if (input.requirements?.outbound && input.policy.outbound.mode === 'required'
    && !input.policy.outbound.restrictedViewRoot) {
    return finish('deny', 'Outbound Guard required has no frozen Restricted Project View')
  }

  if (matchesTool(input.policy.approvalTools)) {
    return input.policy.unattended
      ? finish('deny', `Unattended restrictive approval denied for ${input.tool}`)
      : finish('ask', `Restrictive run policy requires approval for ${input.tool}`)
  }

  if (input.requirements?.capabilityApproval) {
    return input.policy.unattended
      ? finish('deny', `Unattended approval denied: ${input.requirements.capabilityApproval}`)
      : finish('ask', input.requirements.capabilityApproval)
  }
  const effectiveMode = input.policy.approvalMode === 'full' && input.policy.unattended
    ? 'auto'
    : input.policy.approvalMode
  if (input.requirements?.approvalRequired && (effectiveMode !== 'full' || input.requirements.hitl)) {
    return input.policy.unattended
      ? finish('deny', `Unattended approval denied: ${input.requirements.approvalRequired}`)
      : finish('ask', input.requirements.approvalRequired)
  }
  if (effectiveMode === 'always' && input.requirements?.sideEffect) {
    return input.policy.unattended
      ? finish('deny', `Unattended approval denied for side-effect tool ${input.tool}`)
      : finish('ask', `Approval Mode requires approval for ${input.tool}`)
  }
  return finish('allow', 'Frozen Host run policy allows invocation')
}

/**
 * Coordinates the evidence lifecycle without owning the Pi loop or invoking a
 * tool. Terminal settlement is exactly-once and updates are byte-bounded.
 */
export class PiInvocationEvidence {
  private settled = false
  private readonly base: Omit<PiPolicyEvidenceEvent, 'phase' | 'decision' | 'settlement' | 'detail'>
  private readonly append: (event: PiPolicyEvidenceEvent) => void
  constructor(
    base: Omit<PiPolicyEvidenceEvent, 'phase' | 'decision' | 'settlement' | 'detail'>,
    append: (event: PiPolicyEvidenceEvent) => void,
  ) {
    this.base = base
    this.append = append
  }

  start(): void { this.append({ ...this.base, phase: 'start' }) }
  decision(decision: PiPolicyVerdict, reason: string): void {
    this.append({ ...this.base, phase: 'decision', decision, detail: bounded(reason) })
  }
  update(detail: string): void { this.append({ ...this.base, phase: 'update', detail: bounded(detail) }) }
  result(ok: boolean, detail?: string): void {
    this.append({ ...this.base, phase: 'result', settlement: ok ? 'success' : 'failed', ...(detail ? { detail: bounded(detail) } : {}) })
  }
  settle(settlement: 'success' | 'failed' | 'cancelled' | 'denied', detail?: string): void {
    if (this.settled) return
    this.settled = true
    this.append({ ...this.base, phase: 'settlement', settlement, ...(detail ? { detail: bounded(detail) } : {}) })
  }
}

function bounded(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= 1_024) return value
  let boundedValue = Buffer.from(value, 'utf8').subarray(0, 1_024).toString('utf8')
  while (Buffer.byteLength(boundedValue, 'utf8') > 1_024) boundedValue = boundedValue.slice(0, -1)
  return boundedValue
}
