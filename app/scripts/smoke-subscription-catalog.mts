import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  projectSubscriptionCatalog,
  assembleSubscriptionCatalog,
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
assert.match(entrySource, /subscriptionCatalog:\s*assembleSubscriptionCatalog\(/, 'piHostEntry must assemble the catalog into config.subscriptionCatalog')
const protocolSource = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
assert.match(protocolSource, /PI_HOST_PROTOCOL_VERSION = 4 as const/, 'ADR-0052 rides protocol v4')
assert.match(protocolSource, /requestedVersion !== PI_HOST_PROTOCOL_VERSION && requestedVersion !== 3 && requestedVersion !== 2/, 'v2/v3 peers stay readable across the v4 bump')
assert.match(protocolSource, /subscriptionCatalog\?: readonly SubscriptionProviderCatalog\[\]/, 'snapshot config type carries the catalog')
const supervisorSource = await readFile(resolve(import.meta.dirname, '../electron/piHostSupervisor.ts'), 'utf8')
assert.match(supervisorSource, /protocolVersion: 4/, 'the app client negotiates the current version')

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
assert.match(storeSource, /isSubscriptionProviderPreset\(s\.apiProvider\)/, 'the browser test-connection path refuses subscription probes fail-closed')

console.log('Subscription catalog projects fail-closed: conflict hides all, no login falls back to nothing, bounding is visible')
