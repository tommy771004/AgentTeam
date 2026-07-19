/**
 * Issue 07 — Free Core entitlement boundary.
 *
 * The ONE decision point every paid capability check must go through.
 * Free Core (local provider/CLI connections, projects, sessions, basic
 * multi-agent use, Plan/Goal tasks, permissions, skills/MCP, diff/terminal/
 * history, export, Handoff) never calls into this module — it has no gate.
 * Only capabilities/tools that opt in via `requiresEntitlement` route here.
 *
 * Anything unavailable, malformed, or expired fails CLOSED to 'free' —
 * never throws, never silently grants paid access.
 */

export type EntitlementTier = 'free' | 'paid'
export type EntitlementSource = 'none' | 'malformed' | 'expired' | 'valid'

export interface EntitlementSnapshot {
  tier: EntitlementTier
  grantedFeatures: ReadonlySet<string>
  source: EntitlementSource
  failClosed: boolean
  reason?: string
}

interface RawEntitlementShape {
  tier?: unknown
  grantedFeatures?: unknown
  expiresAt?: unknown
}

function freeSnapshot(source: EntitlementSource, reason?: string): EntitlementSnapshot {
  return {
    tier: 'free',
    grantedFeatures: new Set<string>(),
    source,
    failClosed: source !== 'none',
    reason,
  }
}

/**
 * Resolve raw entitlement data (a local license/subscription token, or
 * `undefined`/`null` when none is configured) into a snapshot. Pure and total:
 * every input maps to a value, never a throw.
 */
export function resolveEntitlement(raw: unknown): EntitlementSnapshot {
  if (raw === undefined || raw === null) {
    return freeSnapshot('none', 'No entitlement data present — Free Core only.')
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return freeSnapshot('malformed', 'Entitlement payload is not an object.')
  }

  const shape = raw as RawEntitlementShape
  if (shape.tier !== 'paid') {
    // Missing / 'free' / unrecognized tier: not an error, just not paid.
    return freeSnapshot('none', 'Entitlement payload does not claim a paid tier.')
  }

  if (!Array.isArray(shape.grantedFeatures) || shape.grantedFeatures.some((f) => typeof f !== 'string')) {
    return freeSnapshot('malformed', 'grantedFeatures is missing or not a string array.')
  }

  if (shape.expiresAt !== undefined) {
    const expiryMs = new Date(String(shape.expiresAt)).getTime()
    if (Number.isNaN(expiryMs)) {
      return freeSnapshot('malformed', 'expiresAt is not a valid date.')
    }
    if (expiryMs < Date.now()) {
      return freeSnapshot('expired', `Entitlement expired at ${String(shape.expiresAt)}.`)
    }
  }

  return {
    tier: 'paid',
    grantedFeatures: new Set(shape.grantedFeatures),
    source: 'valid',
    failClosed: false,
  }
}

/** Single check point. Free Core call sites never call this at all. */
export function isFeatureEntitled(snapshot: EntitlementSnapshot, featureId: string): boolean {
  if (snapshot.tier !== 'paid') return false
  return snapshot.grantedFeatures.has(featureId)
}

/**
 * Runtime-seam predicate: capabilities/tools with no `requiresEntitlement`
 * are always available (Free Core, unaffected by entitlement state).
 * Ones that declare it route through the single boundary above.
 */
export function isCapabilityEntitled(
  snapshot: EntitlementSnapshot,
  requiresEntitlement?: string,
): boolean {
  if (!requiresEntitlement) return true
  return isFeatureEntitled(snapshot, requiresEntitlement)
}
