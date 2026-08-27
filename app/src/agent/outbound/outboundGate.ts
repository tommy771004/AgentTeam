/**
 * Outbound Data Gate — final egress boundary for builtin LLM + external CLI.
 *
 * Payload sanitization happens before this decision seam; evidence, restricted
 * views and sandbox enforcement are handled by their dedicated boundaries.
 *
 * Only effective `off` bypasses inspection. Build flavor never bypasses the gate.
 */

export type OutboundGuardMode = 'off' | 'demo' | 'optional' | 'required'
export type BuildFlavor = 'standard' | 'policy-admin'
export type OutboundChannel = 'llm' | 'cli'

const GUARD_MODES = new Set<OutboundGuardMode>(['off', 'demo', 'optional', 'required'])

/**
 * Parse deploy-time `SUBAGENTS_OUTBOUND_GUARD`.
 * Unset / empty → `off` (backward-compatible product default).
 * Unknown values throw (fail closed — never silently weaken).
 */
export function parseDeployOutboundGuard(raw: string | undefined | null): OutboundGuardMode {
  if (raw == null) return 'off'
  const v = String(raw).trim().toLowerCase()
  if (!v) return 'off'
  if (GUARD_MODES.has(v as OutboundGuardMode)) return v as OutboundGuardMode
  throw new Error(
    `Invalid SUBAGENTS_OUTBOUND_GUARD="${raw}". Expected off|demo|optional|required.`,
  )
}

/**
 * Parse compile/deploy `SUBAGENTS_BUILD_FLAVOR`.
 * Unset / empty / standard → standard; only policy-admin is the other legal value.
 */
export function parseBuildFlavor(raw: string | undefined | null): BuildFlavor {
  if (raw == null) return 'standard'
  const v = String(raw).trim()
  if (!v || v === 'standard') return 'standard'
  if (v === 'policy-admin') return 'policy-admin'
  throw new Error(
    `Invalid SUBAGENTS_BUILD_FLAVOR="${raw}". Expected standard|policy-admin.`,
  )
}

/**
 * Derive effective mode from deploy posture + optional user toggle.
 * - required: always required (UI cannot weaken)
 * - demo: always demo
 * - off: always off (user toggle ignored)
 * - optional: active only when userEnabled === true; otherwise effective off
 */
export function resolveEffectiveOutboundGuard(opts: {
  deploy: OutboundGuardMode
  userEnabled?: boolean
}): OutboundGuardMode {
  switch (opts.deploy) {
    case 'required':
      return 'required'
    case 'demo':
      return 'demo'
    case 'off':
      return 'off'
    case 'optional':
      return opts.userEnabled === true ? 'optional' : 'off'
    default: {
      const _x: never = opts.deploy
      throw new Error(`Unknown deploy guard mode: ${_x}`)
    }
  }
}

export function isProtectionActive(mode: OutboundGuardMode): boolean {
  return mode !== 'off'
}

/** Admission outcome for Restricted Project View at Task run start. */
export type RestrictedViewAdmission =
  | { action: 'skip' }
  | { action: 'use-view'; viewRoot: string }
  | { action: 'block'; reason: string }
  | { action: 'continue-degraded'; reason: string }

/**
 * Decide whether a run may proceed without / with a Restricted Project View.
 * `required` fails closed on missing root, missing bridge, or prepare failure.
 * `optional` / `demo` may continue with an explicit degraded reason.
 */
export function decideRestrictedViewAdmission(opts: {
  effectiveMode: OutboundGuardMode
  projectRoot?: string | null
  /** null = not attempted; use with bridgeAvailable for missing IPC */
  prepare?:
    | { ok: true; viewRoot: string }
    | { ok: false; reason: string }
    | null
  /** default true when prepare is non-null; set false when IPC missing */
  bridgeAvailable?: boolean
}): RestrictedViewAdmission {
  if (!isProtectionActive(opts.effectiveMode)) {
    return { action: 'skip' }
  }

  const root = (opts.projectRoot || '').trim()
  if (!root) {
    const reason = 'projectRoot required for Restricted Project View'
    return opts.effectiveMode === 'required'
      ? { action: 'block', reason }
      : { action: 'continue-degraded', reason }
  }

  const prepare = opts.prepare
  const bridgeOk = opts.bridgeAvailable ?? prepare != null
  if (!bridgeOk || prepare == null) {
    const reason = 'Restricted Project View bridge unavailable'
    return opts.effectiveMode === 'required'
      ? { action: 'block', reason }
      : { action: 'continue-degraded', reason }
  }

  if (prepare.ok === false) {
    const reason = prepare.reason || 'prepareRunView failed'
    return opts.effectiveMode === 'required'
      ? { action: 'block', reason }
      : { action: 'continue-degraded', reason }
  }

  const viewRoot = (prepare.viewRoot || '').trim()
  if (!viewRoot) {
    const reason = 'prepareRunView returned empty viewRoot'
    return opts.effectiveMode === 'required'
      ? { action: 'block', reason }
      : { action: 'continue-degraded', reason }
  }

  return { action: 'use-view', viewRoot }
}

/** Profile selection when building a Restricted Project View. */
export type ProtectedViewProfileDecision =
  | { action: 'use-ensured' }
  | { action: 'use-baseline'; degraded: true }
  | { action: 'block'; reason: string }

/**
 * Under `required`, a failed company policy load must not silently fall back
 * to builtin baseline. optional/demo may degrade to baseline with a flag.
 */
export function resolveProfileForProtectedView(opts: {
  effectiveMode: OutboundGuardMode
  ensureOk: boolean
  ensureReason?: string
}): ProtectedViewProfileDecision {
  if (opts.ensureOk) return { action: 'use-ensured' }
  const reason = opts.ensureReason || 'provider security profile unavailable'
  if (opts.effectiveMode === 'required') {
    return { action: 'block', reason }
  }
  if (!isProtectionActive(opts.effectiveMode)) {
    return { action: 'use-baseline', degraded: true }
  }
  // optional / demo
  return { action: 'use-baseline', degraded: true }
}

export type OutboundInspectRequest = {
  channel: OutboundChannel
  runId?: string
  /** Sanitized transport payload (messages body / CLI prompt bundle). */
  payload: unknown
  effectiveMode: OutboundGuardMode
  /** Orthogonal to guard — must never create a bypass. */
  buildFlavor: BuildFlavor
  providerConnectionId?: string
}

export type OutboundInspectResult =
  | {
      action: 'allow'
      /** false only when effective mode is off (true bypass). */
      inspected: boolean
      effectiveMode: OutboundGuardMode
      payload: unknown
    }
  | {
      action: 'block'
      reason: string
      effectiveMode: OutboundGuardMode
    }

/** Optional test/production observer (no sensitive content logging). */
type GateObserver = (event: {
  channel: OutboundChannel
  effectiveMode: OutboundGuardMode
  inspected: boolean
  action: 'allow' | 'block'
}) => void

let _observer: GateObserver | null = null

export function setOutboundGateObserver(fn: GateObserver | null): void {
  _observer = fn
}

/**
 * Final egress decision after mode resolution and payload preparation.
 * Non-off modes always enter the gate (inspected=true) even when payload is unchanged.
 */
export function inspectOutbound(req: OutboundInspectRequest): OutboundInspectResult {
  // Build flavor is intentionally unused for allow/deny — documents orthogonality.
  void req.buildFlavor

  if (req.effectiveMode === 'off') {
    const result: OutboundInspectResult = {
      action: 'allow',
      inspected: false,
      effectiveMode: 'off',
      payload: req.payload,
    }
    _observer?.({
      channel: req.channel,
      effectiveMode: 'off',
      inspected: false,
      action: 'allow',
    })
    return result
  }

  const result: OutboundInspectResult = {
    action: 'allow',
    inspected: true,
    effectiveMode: req.effectiveMode,
    payload: req.payload,
  }
  _observer?.({
    channel: req.channel,
    effectiveMode: req.effectiveMode,
    inspected: true,
    action: 'allow',
  })
  return result
}

/**
 * Read deploy guard from process env (Node / Electron main / strip-types smoke).
 * Renderer should pass settings-backed deploy snapshot when env is unavailable.
 */
export function readDeployOutboundGuardFromEnv(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): OutboundGuardMode {
  return parseDeployOutboundGuard(env.SUBAGENTS_OUTBOUND_GUARD)
}

export function readBuildFlavorFromEnv(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): BuildFlavor {
  return parseBuildFlavor(env.SUBAGENTS_BUILD_FLAVOR)
}

/**
 * Map Electron main `outbound:status` deploy field into a settings patch.
 * Runtime consumers must apply this so effective mode is main-owned,
 * not renderer process.env (often empty in Electron → silent `off`).
 */
export function settingsPatchFromOutboundStatus(status: {
  deployGuard: OutboundGuardMode | 'invalid'
}): { outboundGuardDeploy: OutboundGuardMode } {
  if (status.deployGuard === 'invalid') {
    throw new Error(
      'Invalid SUBAGENTS_OUTBOUND_GUARD from main status — cannot build settings patch.',
    )
  }
  return { outboundGuardDeploy: status.deployGuard }
}

/**
 * Apply main `outbound:status` deploy into settings-shaped fields + effective mode.
 * Used at settings load so coordinator / LLM / CLI share main-owned posture.
 */
export function applyMainOutboundStatusToSettings(
  settings: {
    outboundProtectionEnabled?: boolean
    outboundGuardDeploy?: OutboundGuardMode
  },
  status: { deployGuard: OutboundGuardMode | 'invalid' },
):
  | {
      ok: true
      patch: { outboundGuardDeploy: OutboundGuardMode }
      effectiveMode: OutboundGuardMode
    }
  | { ok: false; reason: string } {
  try {
    const patch = settingsPatchFromOutboundStatus(status)
    const effectiveMode = resolveEffectiveOutboundGuard({
      deploy: patch.outboundGuardDeploy,
      userEnabled: settings.outboundProtectionEnabled === true,
    })
    return { ok: true, patch, effectiveMode }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Resolve effective mode from settings + deploy env (common call site helper).
 * Prefer `outboundGuardDeploy` (main-hydrated snapshot) over process env.
 */
export function effectiveOutboundGuardFromSettings(settings: {
  outboundProtectionEnabled?: boolean
  /** Optional cached deploy mode from Electron main; falls back to env. */
  outboundGuardDeploy?: OutboundGuardMode
}): OutboundGuardMode {
  const deploy =
    settings.outboundGuardDeploy ??
    (() => {
      try {
        return readDeployOutboundGuardFromEnv()
      } catch {
        // Unknown deploy value must fail closed for outbound — surface as required block later.
        // At resolve time rethrow so callers can present a configuration error.
        return parseDeployOutboundGuard(
          typeof process !== 'undefined' ? process.env?.SUBAGENTS_OUTBOUND_GUARD : undefined,
        )
      }
    })()
  return resolveEffectiveOutboundGuard({
    deploy,
    userEnabled: settings.outboundProtectionEnabled === true,
  })
}
