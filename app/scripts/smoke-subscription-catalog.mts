import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  projectSubscriptionCatalog,
  assembleSubscriptionCatalog,
  sanitizeModelRow,
  resolveCatalogPublication,
  SUBSCRIPTION_CATALOG_MAX_MODELS,
  SUBSCRIPTION_PROVIDERS,
} from '../src/agent/subscriptionCatalog.ts'

/**
 * ADR-0052 ticket 01 — the fail-closed subscription catalog projection.
 *
 * The Host holds two facts (OAuth sync status + the ModelRuntime model view);
 * this module alone decides which CLI-subscription connections are selectable
 * and, when they are not, the honest reason. Every rule is a fixture here:
 * conflict beats everything, a missing CLI login never falls back to ambient
 * keys, a credential without resolvable models is unusable rather than an
 * empty dropdown. The module may not read a clock, a store, or the DOM — a
 * live snapshot and a replayed fixture must behave identically.
 */

const model = (id: string, extra: { contextWindow?: number; reasoning?: boolean; label?: string } = {}) => ({
  id,
  ...extra,
})

// ── Available: credential imported + resolvable models ─────────────────────
const available = projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: {
    'openai-codex': [model('gpt-5.4', { contextWindow: 400000, reasoning: true }), model('gpt-5.3-codex-spark')],
  },
})
assert.equal(available.length, SUBSCRIPTION_PROVIDERS.length, 'every supported provider gets exactly one row')
const codex = available.find((row) => row.id === 'openai-codex')!
assert.equal(codex.availability, 'available')
assert.equal(codex.reason, undefined, 'an available row carries no reason')
assert.deepEqual(codex.models.map((m) => m.id), ['gpt-5.3-codex-spark', 'gpt-5.4'], 'sorted by id, not input order')

// ── Conflict beats everything ───────────────────────────────────────────────
const conflicted = projectSubscriptionCatalog({
  importedProviders: ['anthropic'],
  skippedProviders: [],
  conflicts: ['anthropic'],
  providerModels: { anthropic: [model('claude-sonnet-4-5')] },
})[1]
assert.equal(conflicted.availability, 'conflict')
assert.equal(conflicted.models.length, 0, 'a conflicted account exposes no models at all')
assert.match(conflicted.reason!, /帳號/)

// ── No detected CLI login: no silent ambient fallback ───────────────────────
const noLogin = projectSubscriptionCatalog({
  importedProviders: [],
  skippedProviders: [],
  conflicts: [],
  providerModels: {},
})[0]
assert.equal(noLogin.id, 'openai-codex')
assert.equal(noLogin.availability, 'unavailable')
assert.match(noLogin.reason!, /登入/)

// ── Skipped means the credential exists and stays usable ────────────────────
const skipped = projectSubscriptionCatalog({
  importedProviders: [],
  skippedProviders: ['anthropic'],
  conflicts: [],
  providerModels: { anthropic: [model('claude-opus-4-1', { reasoning: true })] },
})[1]
assert.equal(skipped.availability, 'available', 'an equal-or-newer Pi credential keeps the provider usable')

// ── Credential without resolvable models is honestly unusable ───────────────
const noModels = projectSubscriptionCatalog({
  importedProviders: ['anthropic'],
  skippedProviders: [],
  conflicts: [],
  providerModels: { anthropic: [] },
})[1]
assert.equal(noModels.availability, 'unavailable')
assert.match(noModels.reason!, /模型/)
assert.equal(noModels.modelTotal, 0)

// Provider absent from providerModels entirely behaves the same.
const absentEntry = projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: {},
})[0]
assert.equal(absentEntry.availability, 'unavailable')

// ── Bounding: truncation is visible, order stays deterministic ──────────────
const many = Array.from({ length: 50 }, (_, index) => model(`m${String(index).padStart(2, '0')}`))
const bounded = projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: { 'openai-codex': many },
})[0]
assert.equal(bounded.models.length, SUBSCRIPTION_CATALOG_MAX_MODELS)
assert.equal(bounded.modelTotal, 50, 'the total states what bounding hid')
assert.deepEqual(
  bounded.models.map((m) => m.id),
  [...bounded.models.map((m) => m.id)].sort(),
  'deterministic id order survives bounding',
)

// ── Dedupe and junk filtering ───────────────────────────────────────────────
const deduped = projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: {
    'openai-codex': [model('dup'), model('dup'), model(' '), model(undefined as unknown as string)],
  },
})[0]
assert.deepEqual(deduped.models.map((m) => m.id), ['dup'], 'repeats collapse; blank ids drop')

// Unknown provider ids in status lists are ignored, never invented into rows.
const unknown = projectSubscriptionCatalog({
  importedProviders: ['gemini-cli', 'openai-codex'],
  skippedProviders: [],
  conflicts: ['not-a-provider'],
  providerModels: {},
})
assert.equal(unknown.filter((row) => row.id === 'openai-codex').length, 1)
assert.equal(unknown.length, SUBSCRIPTION_PROVIDERS.length)

// ── A failed runtime view stays honestly unavailable, verbatim reason ──────
const runtimeFailed = projectSubscriptionCatalog({
  importedProviders: ['anthropic'],
  skippedProviders: [],
  conflicts: [],
  providerModels: {},
  providerModelError: { anthropic: '訂閱模型目錄建構失敗：models.json unreadable' },
})[1]
assert.equal(runtimeFailed.availability, 'unavailable')
assert.equal(runtimeFailed.reason, '訂閱模型目錄建構失敗：models.json unreadable', 'the caller owns WHAT went wrong; the projection owns WHEN it applies')
assert.equal(runtimeFailed.modelTotal, 0)
// …but a missing CLI login still wins: no credential means the runtime view
// is irrelevant — the actionable reason is the login one.
const errorWithoutCredential = projectSubscriptionCatalog({
  importedProviders: [],
  skippedProviders: [],
  conflicts: [],
  providerModels: {},
  providerModelError: { 'openai-codex': 'any failure' },
})[0]
assert.match(errorWithoutCredential.reason!, /登入/)

// ── The pure combiner is THE wiring point for the Host snapshot ─────────────
const assembled = assembleSubscriptionCatalog(
  { oauthImportedProviders: ['openai-codex'], oauthSkippedProviders: [], oauthConflicts: [] },
  { 'openai-codex': [model('gpt-5.4')] },
)
assert.deepEqual(assembled, projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: { 'openai-codex': [model('gpt-5.4')] },
}), 'assemble must be exactly the projection over renamed inputs')

// ── Purity: same input, same output; inputs untouched ───────────────────────
const input = {
  importedProviders: ['openai-codex'],
  skippedProviders: ['anthropic'],
  conflicts: [],
  providerModels: {
    'openai-codex': [model('b'), model('a')],
    anthropic: [model('claude-x')],
  },
}
const twice = () => projectSubscriptionCatalog(input)
assert.deepEqual(twice(), twice(), 'pure: same input, same output')
assert.deepEqual([...input.providerModels['openai-codex']!].map((m) => m.id), ['b', 'a'], 'input arrays are not mutated')

// ── Credential-shaped data has no way in ────────────────────────────────────
const serialized = JSON.stringify(twice())
for (const forbidden of ['access_token', 'accessToken', 'refresh_token', 'refreshToken', 'accountId', 'account_id']) {
  assert.ok(!serialized.includes(forbidden), `catalog must not carry credential fields: ${forbidden}`)
}

// ── Purity is a contract, not a hope ────────────────────────────────────────
const source = await readFile(resolve(import.meta.dirname, '../src/agent/subscriptionCatalog.ts'), 'utf8')
for (const forbidden of [/Date\.now/, /Math\.random/, /useState|useStore|zustand/, /require\(|await import\(/, /window\./, /localStorage/, /node:/]) {
  assert.doesNotMatch(source, forbidden, `the subscription catalog projection must stay pure: ${forbidden}`)
}

// ── Host wiring is a contract, not a convention ─────────────────────────────
const entrySource = await readFile(resolve(import.meta.dirname, '../electron/piHostEntry.ts'), 'utf8')
assert.match(entrySource, /buildPiSubscriptionModelView\(\)/, 'piHostEntry must build the model view at startup')
assert.match(entrySource, /resolveCatalogPublication\(/, 'piHostEntry must publish through the offline-fallback decision, not hand-pick rows')
assert.match(entrySource, /refreshSubscriptionConfig/, 'piHostEntry exposes one real OAuth + model catalog refresh owner')
assert.match(entrySource, /initialSnapshot, persist, refreshSubscriptionConfig, compactionCheckpoints\)/, 'settings/get is wired to the real Host refresh owner')
assert.match(entrySource, /subscriptionCatalog:\s*publishedCatalog\.catalog/, 'config carries exactly the publication decision')
assert.match(entrySource, /subscriptionCatalogStale: true/, 'the stale marker rides only when the fallback fired')
const protocolSource = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
assert.match(protocolSource, /method === 'settings\/get' \|\| method === 'turn\/submit'/, 'settings/get remains classified as requiring fresh Host facts')
assert.match(protocolSource, /await refreshHostConfigForRequest\(state, input, refreshConfig\)/, 'the server refreshes Host facts before dispatching settings/get')
assert.match(protocolSource, /PI_HOST_PROTOCOL_VERSION = 5 as const/, 'durable-memory contract removal rides protocol v5')
assert.match(protocolSource, /requestedVersion !== PI_HOST_PROTOCOL_VERSION && requestedVersion !== 4 && requestedVersion !== 3 && requestedVersion !== 2/, 'v2-v4 peers remain readable only for their compatible surfaces')
assert.match(protocolSource, /negotiatedProtocolVersion < 5[\s\S]*state\/snapshot without memories requires Pi Host Protocol v5/, 'prior snapshot consumers fail closed instead of receiving the contracted shape')
assert.match(protocolSource, /subscriptionCatalog\?: readonly SubscriptionProviderCatalog\[\]/, 'snapshot config type carries the catalog')
assert.match(protocolSource, /subscriptionCatalogStale\?: boolean/, 'snapshot config type carries the stale marker')
assert.match(protocolSource, /subscriptionCatalogCachedAt\?: number/, 'snapshot config type carries when the cached catalog was built')
const supervisorSource = await readFile(resolve(import.meta.dirname, '../electron/piHostSupervisor.ts'), 'utf8')
assert.match(supervisorSource, /protocolVersion: PI_HOST_PROTOCOL_VERSION/, 'the app client negotiates the constant, never a literal')
assert.ok(!/protocolVersion: 4/.test(supervisorSource), 'no hardcoded protocol literal may remain in the supervisor')

// ── Ticket 04: the model picker relays ids verbatim, from the catalog only ──
const pickerSource = await readFile(resolve(import.meta.dirname, '../src/components/settings/SubscriptionModelPicker.tsx'), 'utf8')
for (const forbidden of [/llm\.models|llm\?\.models/, /toLowerCase|toUpperCase|\.replace\(|normalizeNFK|alias/i]) {
  assert.doesNotMatch(pickerSource, forbidden, `the subscription model picker must relay catalog ids verbatim: ${forbidden}`)
}
assert.match(pickerSource, /config\.subscriptionCatalog/, 'the picker reads the projected snapshot catalog')
assert.match(pickerSource, /onChange\(e\.target\.value\)/, 'selection writes the option value exactly as listed')
const productionSource = await readFile(resolve(import.meta.dirname, '../src/agent/piProduction.ts'), 'utf8')
assert.match(productionSource, /model: 'model',/, 'the Host settings mapping stays an identity map for model ids')
const storeSource = await readFile(resolve(import.meta.dirname, '../src/store/settingsStore.ts'), 'utf8')
assert.match(storeSource, /shouldRejectBrowserProbe\(s\)/, 'the browser test-connection path refuses subscription probes fail-closed')
assert.match(storeSource, /isSubscriptionProviderPreset\(settings\.apiProvider\) \|\| !settings\.apiKey/, 'the refusal helper covers both subscription and missing-key probes')

// ── sanitizeModelRow is THE single row guard (ticket 03) ───────────────────
const sanitized = sanitizeModelRow({ id: ' m2 ', label: 'M2', contextWindow: 1000, reasoning: true })
assert.equal(sanitized!.id, ' m2 ', 'ids travel verbatim — no trimming, no case folding (picker contract)')
assert.deepEqual(sanitized, { id: ' m2 ', label: 'M2', contextWindow: 1000, reasoning: true })
assert.equal(sanitizeModelRow({ id: '   ' }), undefined, 'blank ids drop')
assert.equal(sanitizeModelRow({}), undefined, 'missing id drops')
assert.equal(sanitizeModelRow(null), undefined)
assert.deepEqual(sanitizeModelRow({ id: 'x', name: 3 as unknown as string }), { id: 'x' }, 'wrong-typed fields drop, not coerce')
assert.deepEqual(sanitizeModelRow({ id: 'y', contextWindow: Number.NaN }), { id: 'y' }, 'non-finite contextWindow drops')
// Both call sites must route through the one owner.
const coreRuntimeSource = await readFile(resolve(import.meta.dirname, '../electron/piCoreRuntime.ts'), 'utf8')
assert.match(coreRuntimeSource, /sanitizeModelRow\(/, 'the Host model view reuses the shared row guard')
assert.ok(!/typeof raw\.id !== 'string'/.test(coreRuntimeSource), 'the duplicated inline guard chain must be gone from piCoreRuntime')
assert.match(source, /export function sanitizeModelRow/, 'the row guard lives in the catalog module')

// ── Offline fallback: publish fresh, or the last cached catalog marked stale (ticket 02) ──
const freshLive = projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: { 'openai-codex': [model('gpt-live')] },
})
const previousGood = {
  catalog: projectSubscriptionCatalog({
    importedProviders: ['openai-codex'],
    skippedProviders: [],
    conflicts: [],
    providerModels: { 'openai-codex': [model('gpt-old')] },
  }),
  builtAt: 1_000,
}
const publishedLive = resolveCatalogPublication(freshLive, previousGood, 5_000, {})
assert.equal(publishedLive.stale, false, 'a usable fresh build publishes as-is')
assert.equal(publishedLive.builtAt, 5_000)
assert.deepEqual(publishedLive.catalog, freshLive)

const degradedFresh = projectSubscriptionCatalog({
  importedProviders: ['openai-codex'],
  skippedProviders: [],
  conflicts: [],
  providerModels: {},
  providerModelError: { 'openai-codex': 'models.json unreadable' },
})
const publishedStale = resolveCatalogPublication(
  degradedFresh,
  previousGood,
  5_000,
  { 'openai-codex': 'models.json unreadable' },
)
assert.equal(publishedStale.stale, true, 'a degraded build falls back to cache and says so')
assert.equal(publishedStale.builtAt, 1_000, 'cachedAt stays the moment the CACHE was built, not now')
assert.deepEqual(publishedStale.catalog, previousGood.catalog)

// A previous snapshot that never had a usable row must NOT masquerade as cache.
const previousDead = {
  catalog: projectSubscriptionCatalog({
    importedProviders: [],
    skippedProviders: [],
    conflicts: [],
    providerModels: {},
  }),
  builtAt: 1_000,
}
const publishedDead = resolveCatalogPublication(
  degradedFresh,
  previousDead,
  5_000,
  { 'openai-codex': 'models.json unreadable' },
)
assert.equal(publishedDead.stale, false, 'an all-unavailable previous catalog is no cache worth falling back to')
assert.deepEqual(publishedDead.catalog, degradedFresh)

// First boot with no previous snapshot at all.
const publishedFirst = resolveCatalogPublication(
  degradedFresh,
  undefined,
  5_000,
  { 'openai-codex': 'models.json unreadable' },
)
assert.equal(publishedFirst.stale, false)
assert.deepEqual(publishedFirst.catalog, degradedFresh)

// The publication decision is pure too.
const pubInput = { catalog: freshLive, builtAt: 42 }
assert.deepEqual(
  resolveCatalogPublication(degradedFresh, pubInput, 7_000, { 'openai-codex': 'models.json unreadable' }),
  resolveCatalogPublication(degradedFresh, pubInput, 7_000, { 'openai-codex': 'models.json unreadable' }),
  'same input, same output',
)

const conflictFresh = projectSubscriptionCatalog({
  importedProviders: [],
  skippedProviders: [],
  conflicts: ['openai-codex'],
  providerModels: {},
})
const publishedConflict = resolveCatalogPublication(
  conflictFresh,
  previousGood,
  8_000,
  { 'openai-codex': 'models.json unreadable' },
)
assert.equal(publishedConflict.stale, false, 'a fresh OAuth conflict must never be replaced by cached availability')
assert.equal(publishedConflict.catalog.find((row) => row.id === 'openai-codex')?.availability, 'conflict')

const loggedOutFresh = projectSubscriptionCatalog({
  importedProviders: [],
  skippedProviders: [],
  conflicts: [],
  providerModels: {},
})
const publishedLoggedOut = resolveCatalogPublication(
  loggedOutFresh,
  previousGood,
  9_000,
  { 'openai-codex': 'models.json unreadable' },
)
assert.equal(publishedLoggedOut.stale, false, 'a fresh missing-credential verdict must never be replaced by cache')
assert.equal(publishedLoggedOut.catalog.find((row) => row.id === 'openai-codex')?.availability, 'unavailable')

// ── Ticket 01: test-connection honesty — no Host beats no-key ──────────────
const { useSettingsStore } = await import('../src/store/settingsStore.ts')
const store = useSettingsStore.getState()
useSettingsStore.setState({ settings: { ...store.settings, apiProvider: 'openai-codex', apiKey: '' } })
const subscriptionProbe = await useSettingsStore.getState().testConnection()
assert.ok(!subscriptionProbe.ok)
assert.match(subscriptionProbe.message, /Host/, 'a subscription probe without a Host says SO — not "API key is empty"')
assert.doesNotMatch(subscriptionProbe.message, /API key/)
// Non-subscription presets keep the original key check.
useSettingsStore.setState({ settings: { ...store.settings, apiProvider: 'openai', apiKey: '' } })
const keyedProbe = await useSettingsStore.getState().testConnection()
assert.equal(keyedProbe.message, 'API key is empty', 'OpenAI-compatible probes still demand a key first')
useSettingsStore.setState({ settings: store.settings })

// Traditional-Chinese copy standard: 訂閱 (U+95B1), never the variant 閲 (U+95B2).
const storeSourceRecheck = await readFile(resolve(import.meta.dirname, '../src/store/settingsStore.ts'), 'utf8')
assert.ok(!storeSourceRecheck.includes('訂閲'), 'the variant 閲 must not appear in user-facing copy')
assert.match(storeSourceRecheck, /訂閱連線由 Pi Core Host 提供/, 'the honest subscription message stays')
// Ordering contract: the subscription branch is checked BEFORE the key check.
assert.ok(
  storeSourceRecheck.indexOf('shouldRejectBrowserProbe(s)')
    < storeSourceRecheck.indexOf('message: missingCredentialMessage(s)'),
  'no-Host must be judged before no-key',
)

// ── Ticket 01: both settings surfaces load through the ONE shared hook ─────
for (const component of ['SubscriptionConnectionStatus.tsx', 'SubscriptionModelPicker.tsx']) {
  const componentSource = await readFile(resolve(import.meta.dirname, '../src/components/settings', component), 'utf8')
  assert.match(componentSource, /useSubscriptionCatalog\(\)/, `${component} loads through the shared hook`)
  assert.doesNotMatch(componentSource, /piHost\?\.settings\?\.get/, `${component} must not hand-roll its own catalog fetch`)
  // The offline marker must reach the user, verbatim vocabulary.
  assert.match(componentSource, /subscriptionCacheBadge/, `${component} surfaces the stale-cache badge honestly`)
}
// The manual refresh entry lives beside the conflict resolution hint —
// fail-closed healing needs a visible trigger, not only focus re-query.
const statusSource = await readFile(resolve(import.meta.dirname, '../src/components/settings/SubscriptionConnectionStatus.tsx'), 'utf8')
assert.match(statusSource, /onClick=\{refresh\}/, 'the status surface exposes the manual refresh entry')
const hookSource = await readFile(resolve(import.meta.dirname, '../src/hooks/useSubscriptionCatalog.ts'), 'utf8')
assert.match(hookSource, /visibilitychange|'focus'/, 'the shared loader re-queries on focus so conflict resolution becomes observable')

// ── Ticket 04: the rail's usage surface is isolated leaves, not a top-level subscription ──
const panelSource = await readFile(resolve(import.meta.dirname, '../src/components/InlineRunPanel.tsx'), 'utf8')
assert.match(panelSource, /<ContextUsageChip runId=\{runId\}/, 'the section head hosts the self-subscribing usage chip')
assert.match(panelSource, /const RunContextBody = memo\(/, 'the 上下文 body is a memo leaf owning its own projection')

console.log('Subscription catalog projects fail-closed: conflict hides all, no login falls back to nothing, bounding is visible')
