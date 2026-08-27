/**
 * Subscription provider catalog — the fail-closed projection that decides
 * which CLI-subscription connections a user may pick, and why.
 *
 * ADR-0052 routes CLI subscription OAuth into the builtin Pi Core loop. The
 * substrate already exists (`piUserConfig.syncPiCliOAuth` imports
 * `openai-codex` / `anthropic` credentials into the agent dir's auth.json;
 * vendored Pi resolves and refreshes them natively), so the ONLY new decision
 * surface is selection: which providers are selectable, and when they are not,
 * the honest reason why.
 *
 * This module is that decision, and nothing else. Inputs are two facts the
 * Host already holds — the OAuth sync status carried in the snapshot config
 * (`oauthImportedProviders` / `oauthSkippedProviders` / `oauthConflicts`) and
 * the ModelRuntime view of each provider's models — and the output is a
 * bounded, deterministically ordered catalog. Fail-closed lives HERE and only
 * here: a conflicted account is never selectable, a provider with no detected
 * CLI login never falls back to ambient keys, and a credential without
 * resolvable models is stated as unusable rather than rendered as an empty
 * dropdown.
 *
 * Pure by contract — no I/O, no clock, no randomness, no store reads — because
 * a live snapshot and a replayed fixture must behave identically. Callers add
 * nothing to the verdicts: the UI relays `availability` and `reason` verbatim,
 * the Host relays the bounded list verbatim. Credential-shaped data has no way
 * in: the input types carry status strings and model metadata only.
 */

/** Native Pi providers backed by CLI subscription OAuth (ADR-0052 scope). */
export const SUBSCRIPTION_PROVIDERS = ['openai-codex', 'anthropic'] as const

export type SubscriptionProviderId = (typeof SUBSCRIPTION_PROVIDERS)[number]

/** Bounded model facts the renderer may see. Never more than this shape. */
export type SubscriptionModelInfo = {
  id: string
  label?: string
  contextWindow?: number
  reasoning?: boolean
}

export type SubscriptionAvailability =
  | 'available'
  | 'unavailable'
  | 'conflict'

export type SubscriptionProviderCatalog = {
  id: SubscriptionProviderId
  availability: SubscriptionAvailability
  /** Human-readable Traditional-Chinese reason; present unless available. */
  reason?: string
  /** Bounded page, sorted by id, deduplicated. */
  models: readonly SubscriptionModelInfo[]
  /** How many distinct models the runtime reported before bounding. */
  modelTotal: number
}

export type SubscriptionCatalogInput = {
  /** Providers whose OAuth was imported into auth.json this startup. */
  importedProviders: readonly string[]
  /**
   * Providers whose CLI source was read but NOT re-imported because Pi already
   * holds an equal-or-newer credential. A skip still means the credential
   * exists, so it keeps the provider usable.
   */
  skippedProviders: readonly string[]
  /** Providers whose CLI credential belongs to a different account than Pi's. */
  conflicts: readonly string[]
  /** The ModelRuntime view per provider. Absent or empty means none resolved. */
  providerModels: Partial<Record<SubscriptionProviderId, readonly SubscriptionModelInfo[]>>
  /**
   * Per-provider reason strings from a failed runtime view (agent dir missing,
   * ModelRuntime build failure). Stated verbatim — the projection owns WHEN a
   * reason applies, the caller owns WHAT went wrong.
   */
  providerModelError?: Partial<Record<SubscriptionProviderId, string>>
}

/** Upper bound per provider; beyond it the page truncates and states the total. */
export const SUBSCRIPTION_CATALOG_MAX_MODELS = 32

const REASON_CONFLICT = 'CLI 與 Pi 的憑證屬於不同帳號；請在單一 CLI 登入後重新啟動同步。'
const REASON_NO_CREDENTIAL = '尚未偵測到 CLI 登入；請先在對應 CLI（codex / claude）完成登入後重啟。'
const REASON_NO_MODELS = '憑證已同步，但此訂閱目前沒有可解析的模型。'

/**
 * The single row guard for subscription model facts.
 *
 * Every producer of model rows — the catalog projection and the Host's
 * ModelRuntime view alike — routes raw entries through here, so the two can
 * never drift apart in what they accept or drop. Identity travels VERBATIM:
 * ids are not trimmed, folded, or rewritten, because the model picker writes
 * the listed id back verbatim and the runtime must resolve it unchanged.
 *
 * Pure and total over any input: junk rows become `undefined`, wrong-typed
 * fields drop individually rather than coercing.
 */
export function sanitizeModelRow(input: {
  id?: unknown
  label?: unknown
  contextWindow?: unknown
  reasoning?: unknown
} | null | undefined): SubscriptionModelInfo | undefined {
  if (!input || typeof input.id !== 'string' || !input.id.trim()) return undefined
  const id = input.id
  return {
    id,
    ...(typeof input.label === 'string' && input.label ? { label: input.label } : {}),
    ...(typeof input.contextWindow === 'number' && Number.isFinite(input.contextWindow)
      ? { contextWindow: input.contextWindow }
      : {}),
    ...(input.reasoning === true ? { reasoning: true } : {}),
  }
}

function boundedModels(
  raw: readonly SubscriptionModelInfo[] | undefined,
): { models: readonly SubscriptionModelInfo[]; modelTotal: number } {
  // Deterministic order and identity come from `id` alone; dedupe repeats so a
  // runtime hiccup cannot render one model twice. Input array is copied, never
  // mutated.
  const byId = new Map<string, SubscriptionModelInfo>()
  for (const model of raw || []) {
    const clean = sanitizeModelRow(model)
    if (clean && !byId.has(clean.id)) byId.set(clean.id, clean)
  }
  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { models: sorted.slice(0, SUBSCRIPTION_CATALOG_MAX_MODELS), modelTotal: sorted.length }
}

/**
 * Project the two Host-held facts into the selectable-subscription catalog.
 * Unknown provider ids in the status lists are ignored: only the providers
 * this product supports get rows. Verdict order is fixed and honest:
 * conflict → no credential → runtime-view failure → no models → available.
 */
export function projectSubscriptionCatalog(
  input: SubscriptionCatalogInput,
): readonly SubscriptionProviderCatalog[] {
  return SUBSCRIPTION_PROVIDERS.map((id) => {
    if (input.conflicts.includes(id)) {
      return { id, availability: 'conflict' as const, reason: REASON_CONFLICT, models: [], modelTotal: 0 }
    }
    const hasCredential = input.importedProviders.includes(id) || input.skippedProviders.includes(id)
    if (!hasCredential) {
      return { id, availability: 'unavailable' as const, reason: REASON_NO_CREDENTIAL, models: [], modelTotal: 0 }
    }
    const runtimeError = input.providerModelError?.[id]
    if (runtimeError) {
      return { id, availability: 'unavailable' as const, reason: runtimeError, models: [], modelTotal: 0 }
    }
    const { models, modelTotal } = boundedModels(input.providerModels[id])
    if (modelTotal === 0) {
      return { id, availability: 'unavailable' as const, reason: REASON_NO_MODELS, models, modelTotal }
    }
    return { id, availability: 'available' as const, models, modelTotal }
  })
}

/** The OAuth status shape the Host snapshot config already carries. */
export type PiOAuthSyncStatusShape = {
  oauthImportedProviders: readonly string[]
  oauthSkippedProviders: readonly string[]
  oauthConflicts: readonly string[]
}

const EMPTY_MODEL_VIEW: Partial<Record<SubscriptionProviderId, readonly SubscriptionModelInfo[]>> = {}

/**
 * Assemble the snapshot-config field from the Host's two held facts. This is
 * THE wiring point: piHostEntry calls this once at startup and stores the
 * result in `config.subscriptionCatalog`; nothing else may hand-render rows.
 * A caller that cannot read the model view passes an entry in `modelErrors`
 * so the row stays honestly unavailable instead of silently empty.
 */
export function assembleSubscriptionCatalog(
  oauth: PiOAuthSyncStatusShape,
  modelView: Partial<Record<SubscriptionProviderId, readonly SubscriptionModelInfo[]>> = EMPTY_MODEL_VIEW,
  modelErrors: Partial<Record<SubscriptionProviderId, string>> = {},
): readonly SubscriptionProviderCatalog[] {
  return projectSubscriptionCatalog({
    importedProviders: oauth.oauthImportedProviders,
    skippedProviders: oauth.oauthSkippedProviders,
    conflicts: oauth.oauthConflicts,
    providerModels: modelView,
    providerModelError: modelErrors,
  })
}

/**
 * The offline-fallback decision: publish a fresh build as-is, or —
 * when the fresh build could not make ANY row available and a previous
 * snapshot carried at least one usable row — republish that last-good catalog
 * marked stale, with the moment the CACHE was built (not now) so the UI can
 * say honestly how old it is.
 *
 * A previous snapshot whose rows were all unavailable is not a cache worth
 * falling back to: republishing it would dress a known-dead state up as
 * memory. Fail-closed stays fail-closed — no previous usable state means the
 * degraded fresh build publishes verbatim.
 */
export function resolveCatalogPublication(
  fresh: readonly SubscriptionProviderCatalog[],
  previous: { catalog: readonly SubscriptionProviderCatalog[]; builtAt: number } | undefined,
  now: number,
  modelErrors: Partial<Record<SubscriptionProviderId, string>>,
): { catalog: readonly SubscriptionProviderCatalog[]; stale: boolean; builtAt: number } {
  if (!previous) {
    return { catalog: fresh, stale: false, builtAt: now }
  }
  const previousByProvider = new Map(previous.catalog.map((row) => [row.id, row]))
  let usedCache = false
  const catalog = fresh.map((row) => {
    // Cache may replace only a model-view failure. OAuth conflict and missing
    // credential verdicts are fresh security facts and must never be revived
    // by a previously selectable row.
    const modelError = modelErrors[row.id]
    if (row.availability !== 'unavailable' || !modelError || row.reason !== modelError) return row
    const cached = previousByProvider.get(row.id)
    if (cached?.availability !== 'available') return row
    usedCache = true
    return cached
  })
  return usedCache
    ? { catalog, stale: true, builtAt: previous.builtAt }
    : { catalog: fresh, stale: false, builtAt: now }
}
