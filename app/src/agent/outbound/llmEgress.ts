/**
 * LLM egress: sanitize chat messages with company Provider Security Profile.
 * Ticket 19 — same profile semantics as Restricted Project View (not baseline-only).
 */

import type { OutboundGuardMode } from './outboundGate.ts'
import type { ProviderSecurityProfile } from './policyMerge.ts'
import { sanitizeChatMessages } from './textSanitize.ts'

export type LlmProfileLoadResult =
  | { ok: true; profile: ProviderSecurityProfile }
  | { ok: false; reason: string }

export type LlmEgressProfileDecision =
  | {
      action: 'use'
      profile: ProviderSecurityProfile
      source: 'company' | 'baseline'
      degraded?: boolean
    }
  | { action: 'block'; reason: string }

/**
 * Choose which profile sanitizes LLM egress.
 * - loaded company ok → company
 * - required + load fail → block (no silent baseline when company tree is broken)
 * - optional/demo + load fail → baseline degraded
 * - loaded null (no IPC / browser) → baseline floor (irreducible)
 */
export function resolveLlmEgressProfile(opts: {
  effectiveMode: OutboundGuardMode
  loaded: LlmProfileLoadResult | null
  baselineProfile: ProviderSecurityProfile
}): LlmEgressProfileDecision {
  if (opts.loaded?.ok === true) {
    return { action: 'use', profile: opts.loaded.profile, source: 'company' }
  }
  if (opts.loaded && opts.loaded.ok === false) {
    if (opts.effectiveMode === 'required') {
      return { action: 'block', reason: opts.loaded.reason }
    }
    return {
      action: 'use',
      profile: opts.baselineProfile,
      source: 'baseline',
      degraded: true,
    }
  }
  // No load attempt — browser / early path: irreducible baseline floor.
  return { action: 'use', profile: opts.baselineProfile, source: 'baseline' }
}

/** Per-run/connection cache so FC rounds reuse one company profile. */
const _profileCache = new Map<string, LlmEgressProfileDecision>()

export function clearLlmEgressProfileCache(): void {
  _profileCache.clear()
}

export type ChatMessageLite = { role: string; content: string }

export async function prepareLlmEgressMessages(opts: {
  effectiveMode: OutboundGuardMode
  messages: ChatMessageLite[]
  baselineProfile: ProviderSecurityProfile
  /** Return company profile from main ensurePolicy, or null if IPC unavailable. */
  loadCompanyProfile: () => Promise<LlmProfileLoadResult | null>
  /** When set, cache resolved profile decision across rounds. */
  cacheKey?: string
}): Promise<
  | {
      ok: true
      messages: ChatMessageLite[]
      source: 'company' | 'baseline'
      degraded?: boolean
    }
  | { ok: false; reason: string }
> {
  let decision: LlmEgressProfileDecision | undefined
  if (opts.cacheKey) {
    decision = _profileCache.get(opts.cacheKey)
  }
  if (!decision) {
    let loaded: LlmProfileLoadResult | null = null
    try {
      loaded = await opts.loadCompanyProfile()
    } catch (e) {
      loaded = {
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      }
    }
    decision = resolveLlmEgressProfile({
      effectiveMode: opts.effectiveMode,
      loaded,
      baselineProfile: opts.baselineProfile,
    })
    if (opts.cacheKey && decision.action === 'use') {
      _profileCache.set(opts.cacheKey, decision)
    }
  }

  if (decision.action === 'block') {
    return { ok: false, reason: decision.reason }
  }

  const sanitized = sanitizeChatMessages(opts.messages, decision.profile)
  return {
    ok: true,
    messages: sanitized.messages,
    source: decision.source,
    degraded: decision.degraded,
  }
}

/**
 * Default company profile loader via Electron outbound.ensurePolicy.
 * Returns null when IPC is absent (browser / Node unit path without mock).
 */
export async function loadCompanyProfileViaOutboundIpc(
  connectionId: string,
): Promise<LlmProfileLoadResult | null> {
  try {
    const w = globalThis as typeof globalThis & {
      window?: {
        subagents?: {
          outbound?: { ensurePolicy?: (id: string) => Promise<unknown> }
        }
      }
    }
    const fn = w.window?.subagents?.outbound?.ensurePolicy
    if (typeof fn !== 'function') return null
    const raw = await fn(connectionId)
    if (!raw || typeof raw !== 'object') {
      return { ok: false, reason: 'ensurePolicy returned empty' }
    }
    const r = raw as {
      ok?: boolean
      profile?: ProviderSecurityProfile
      reason?: string
    }
    if (r.ok === true && r.profile && Array.isArray(r.profile.detectors)) {
      return { ok: true, profile: r.profile }
    }
    return {
      ok: false,
      reason: r.reason || 'ensurePolicy failed',
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}
