import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { apiProviderPreset } from '../src/agent/apiProviders.ts'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFile(resolve(root, file), 'utf8')

/**
 * ADR-0052 tickets 05 — honest-labeling drift guards. Three contracts over
 * source text, each pointing at its owner (the 01 projection module, the 03
 * preset definitions, the 04 picker); none re-implements logic inline.
 *
 * 1. Labeling — a subscription run is presented as「Pi loop + 訂閱模型」and
 *    never as a vendor-agent run. The capability wording may live in the
 *    preset NOTE as an explicit negation（非 Codex agent）; the connection UI
 *    itself must not claim vendor-agent behavior at all.
 * 2. Capability matrix — runner→executionKind keeps its two-way shape
 *    (builtin → loop, cli → external). No provider-specific branch may appear
 *    in the dispatch path, or the matrix stops being total.
 * 3. IPC boundary — renderer sources never gain a path that reads credential
 *    material; the ONLY sanctioned surface is availability metadata via
 *    `config.subscriptionCatalog`.
 */

// ── Guard 1: honest labeling ────────────────────────────────────────────────
const presets = await read('src/agent/apiProviders.ts')
assert.match(presets, /id: 'openai-codex'/, 'the codex subscription preset exists')
assert.match(presets, /id: 'anthropic'/, 'the anthropic subscription preset exists')
const codexNote = presets.slice(presets.indexOf("id: 'openai-codex'"), presets.indexOf("id: 'anthropic'"))
assert.match(codexNote, /Pi loop/, 'the codex preset states Pi-loop semantics')
assert.match(codexNote, /非 Codex agent/, 'the codex preset explicitly negates vendor-agent semantics')
const anthropicNote = presets.slice(presets.indexOf("id: 'anthropic'"), presets.indexOf("id: 'custom'"))
assert.match(anthropicNote, /Pi loop/, 'the anthropic preset states Pi-loop semantics')
assert.match(anthropicNote, /非 Claude Code/, 'the anthropic preset explicitly negates vendor-agent semantics')
assert.equal(
  apiProviderPreset('legacy-unknown' as never).id,
  'custom',
  'an unknown persisted provider falls back to custom, never a subscription provider',
)

for (const ui of ['src/components/settings/SubscriptionConnectionStatus.tsx', 'src/components/settings/SubscriptionModelPicker.tsx']) {
  const source = await read(ui)
  assert.doesNotMatch(source, /Codex agent|Claude Code/, `${ui} must not present a subscription run as a vendor-agent run`)
}
const statusUi = await read('src/components/settings/SubscriptionConnectionStatus.tsx')
assert.match(statusUi, /Pi loop \+ 訂閱模型/, 'the connection UI carries the honest「Pi loop + 訂閱模型」wording')

// ── Guard 2: the capability matrix admits no provider special-case ─────────
const runDispatch = await read('src/agent/runDispatch.ts')
assert.match(runDispatch, /runner === 'builtin'/, 'the builtin branch of the matrix exists')
assert.match(runDispatch, /path: 'builtin',\s*\n\s*executionKind: 'loop',/, 'builtin runs stay executionKind loop')
assert.match(runDispatch, /path: 'cli',\s*\n\s*executionKind: 'external',/, 'cli runs stay executionKind external')
for (const forbidden of [/isSubscriptionProviderPreset/, /subscriptionCatalog/i, /apiProvider\s*===\s*'(openai-codex|anthropic)'/]) {
  assert.doesNotMatch(runDispatch, forbidden, `the dispatch path must not special-case subscription providers: ${forbidden}`)
}
const coordinator = await read('src/agent/taskRunCoordinator.ts')
assert.doesNotMatch(coordinator, /isSubscriptionProviderPreset|subscriptionCatalog/i, 'run admission stays provider-blind')

// ── Guard 3: credential-shaped data never crosses the IPC boundary ─────────
// The NEW subscription surface must be credential-blind in every sense:
const subscriptionSurfaceFiles = [
  'src/components/settings/SubscriptionConnectionStatus.tsx',
  'src/components/settings/SubscriptionModelPicker.tsx',
  'src/agent/apiProviders.ts',
]
for (const file of subscriptionSurfaceFiles) {
  const source = await read(file)
  for (const forbidden of [/auth\.json/, /credentials\.json/, /access_token|refresh_token/i, /apiKey\s*[:=]/]) {
    assert.doesNotMatch(source, forbidden, `${file} must not touch credential material: ${forbidden}`)
  }
}
// Pre-existing broad surfaces keep their unrelated features, but must never
// grow a path into the CLI-subscription credential store:
for (const file of ['src/store/settingsStore.ts', 'src/pages/SettingsPage.tsx', 'src/agent/piProduction.ts']) {
  const source = await read(file)
  for (const forbidden of [/auth\.json/, /\.credentials\.json/, /codexOAuthImport|claudeOAuthImport/, /SUBAGENTS_CODEX_AUTH_PATH|SUBAGENTS_CLAUDE_CREDENTIALS_PATH/]) {
    assert.doesNotMatch(source, forbidden, `${file} must not read the subscription credential store: ${forbidden}`)
  }
}
// …while the sanctioned surface — availability metadata only — is consumed
// exactly where ticket 03/04 wired it. The fetch itself lives in the shared
// hook; the components may only reach the catalog THROUGH it.
assert.match(statusUi, /useSubscriptionCatalog\(\)/)
const catalogHook = await read('src/hooks/useSubscriptionCatalog.ts')
assert.match(catalogHook, /config\?\.subscriptionCatalog/, 'the shared loader is the one place reading config.subscriptionCatalog')
for (const forbidden of [/auth\.json/, /credentials\.json/, /access_token|refresh_token/i]) {
  assert.doesNotMatch(catalogHook, forbidden, `the catalog loader must not touch credential material: ${forbidden}`)
}
const catalogModule = await read('src/agent/subscriptionCatalog.ts')
assert.match(catalogModule, /Credential-shaped data/, 'the projection module still states its credential-exclusion contract')

console.log('Subscription labeling guards passed: Pi-loop labeling, total capability matrix, credential-free renderer surface')
