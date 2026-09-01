import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

/**
 * Contract drift guards（契約漂移守衛）for the expand–contract effort
 * "Pi Host tool and skill parity".
 *
 * The Host owns the tool catalog and skill discovery now (ADR-0027/0034).
 * These guards make the two-catalog split impossible to rebuild quietly:
 * each one pins a removal or a freeze so only an explicit edit to THIS file
 * can move the boundary.
 */

// ── Guard 1: the renderer registration directory is FROZEN ──
const registeredDir = join(root, 'src/agent/tools/registered')
const registeredFiles = readdirSync(registeredDir).filter((file) => file.endsWith('.ts') && file !== 'index.ts').sort()
/**
 * The frozen set, written out.
 *
 * This list used to be built by re-reading the same directory for every
 * non-`workspace_` file, so both sides of the comparison grew together and the
 * guard could only ever fail on a new `workspace_*` file — the exact thing its
 * message says it catches was the one thing it could not. Adding a file here
 * is the explicit act of extending the contract.
 */
const FROZEN_REGISTERED = [
  'workspace_delete.ts',
  'workspace_diff.ts',
  'workspace_download.ts',
  'workspace_mkdir.ts',
  'workspace_move.ts',
]

assert.deepEqual(registeredFiles, [...new Set(FROZEN_REGISTERED)].sort(), 'agent/tools/registered is frozen: a NEW renderer tool registration appeared — the Host catalog is the only catalog (ADR-0028). Remove it, or extend this contract explicitly.')

// ── Guard 2: removed equivalents stay removed ──
for (const removed of ['workspace_read.ts', 'workspace_list.ts', 'workspace_grep.ts', 'workspace_glob.ts', 'workspace_write.ts', 'bash.ts', 'skill_list.ts', 'skill_load.ts', 'skill_save.ts', 'codegraph_explore.ts', 'codegraph_status.ts', 'codegraph_impact.ts', 'codegraph_callers.ts']) {
  const path = join(registeredDir, removed)
  assert.equal(existsSync(path), false, `${removed} was removed after parity evidence (ADR-0027 / issue 18); it must not return`)
}

// ── Guard 3: hermes/skills.ts authoring bridge is FROZEN and expires ──
// ADR-0034 makes Pi's resource loader the ONLY runtime skill discovery path.
// Learning/Settings still author a renderer compatibility copy and push full
// state into the Host. This is not read-only and not runtime authority; the
// exact consumers and the deliberate extension are recorded one hop away.
//
// "One release" used to be the whole plan, which is how a temporary file
// becomes permanent: nobody is reminded, so nobody removes it. The window is
// pinned to a version instead, and the build fails once the app ships past it
// — the reminder arrives by itself, at the release that was supposed to be the
// last one carrying this file.
const SKILLS_AUTHORING_BRIDGE_ENDS_BEFORE = '1.3.0'
const skillsFile = read('src/agent/hermes/skills.ts')
void skillsFile
const appVersion = String((JSON.parse(read('package.json')) as { version?: unknown }).version || '0.0.0')
const asNumbers = (version: string) => version.split('.').map((part) => Number(part) || 0)
const [appMajor, appMinor] = asNumbers(appVersion)
const [endMajor, endMinor] = asNumbers(SKILLS_AUTHORING_BRIDGE_ENDS_BEFORE)
assert.ok(
  appMajor < endMajor || (appMajor === endMajor && appMinor < endMinor),
  `hermes/skills.ts authoring compatibility expired: this build is ${appVersion}, at or past ${SKILLS_AUTHORING_BRIDGE_ENDS_BEFORE}. `
  + 'Delete the bridge after Host authoring cutover, or record a new deliberate deadline and exit evidence.',
)
const ALLOWED_SKILLS_CONSUMERS = new Set([
  // Frozen compatibility authoring/readers. Runtime discovery is not here.
  'src/App.tsx',
  'src/store/learningStore.ts',
  'src/pages/SettingsPage.tsx',
  'src/hooks/useSlashExecutor.ts',
  'src/agent/capabilities/runtime.ts',
  'src/agent/intentPreload.ts',
  'src/agent/hermes/curator.ts',
  'src/agent/hermes/learning.ts',
  'src/agent/hermes/promptBuilder.ts',
  'src/agent/hermes/plugins.ts',
  'src/agent/hermes/sessionSearch.ts',
  'src/agent/hermes/skillHostSync.ts',
])
const sourceFiles: string[] = []
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) sourceFiles.push(full)
  }
}
walk(join(root, 'src'))
walk(join(root, 'electron'))
const offenders: string[] = []
for (const file of sourceFiles) {
  const rel = file.slice(root.length + 1).replaceAll('\\', '/')
  if (rel === 'src/agent/hermes/skills.ts') continue
  const content = readFileSync(file, 'utf8')
  const importsLegacySkills = /(?:from\s+['"](?:\.\/skills(?:\.ts)?|[^'"]*hermes\/skills(?:\.ts)?)['"]|import\(\s*['"][^'"]*hermes\/skills(?:\.ts)?['"]\s*\))/.test(content)
  if (importsLegacySkills && !ALLOWED_SKILLS_CONSUMERS.has(rel)) {
    offenders.push(rel)
  }
}
assert.deepEqual(offenders, [], `hermes/skills gained a new consumer: ${offenders.join(', ')}. Skills are Pi resources (ADR-0034) — do not re-couple the renderer.`)
assert.equal(ALLOWED_SKILLS_CONSUMERS.size, 12, 'authoring bridge consumer inventory changed; update the explicit compatibility decision')
assert.equal(existsSync(join(root, '..', '.scratch/hermes-skills-authoring-compatibility.md')), true, 'Hermes skill authoring extension must retain its exit plan')

// ── Guard 4: piTurnContext carries no skill branch ──
const turnContext = read('src/agent/piTurnContext.ts')
assert.doesNotMatch(turnContext, /skillsStore|matchForObjective|selectSkillsForObjective/, 'piTurnContext must not resolve skills renderer-side (issue 18)')
assert.match(turnContext, /Skills are Pi resources/, 'the reason for the removal stays on record where the code lives')

// ── Guard 5: the guidance agents read must not contradict these guards ──
// A contributor following CLAUDE.md was previously told to add new tools to
// `tools/registered/` — the directory Guard 1 freezes. Documentation that
// disagrees with the gate is worse than no documentation: it sends people
// into a build failure and makes the gate look wrong.
const guidance = readFileSync(join(root, '..', 'CLAUDE.md'), 'utf8')
const toolsSection = guidance.slice(guidance.indexOf('**Tools.**'))
assert.notEqual(guidance.indexOf('**Tools.**'), -1, 'CLAUDE.md still documents how tools are added')
assert.match(
  toolsSection.slice(0, 1_200),
  /piExtensionPacks/,
  'CLAUDE.md must send a new tool to the Host extension packs, which is where new tools actually go',
)
assert.match(
  toolsSection.slice(0, 1_200),
  /FROZEN|frozen/,
  'CLAUDE.md must say the renderer registration directory is frozen, because Guard 1 enforces exactly that',
)


// ── Guard 6: every Settings field must have a consumer ──
// A field the UI writes and nothing reads is a promise the product does not
// keep. It has happened twice: `toolsEnabled` and friends were claimed by the
// Host and then never sent (piProduction.ts documents it), and the Git
// preferences kept their UI after their only consumer was deleted with the
// renderer `bash` tool — a user could switch force-push off and still be
// force-pushed. This makes that class of drift a build failure.
const DEFAULTS_SOURCE = read('src/agent/llm.ts')
const defaultsBlock = DEFAULTS_SOURCE.slice(DEFAULTS_SOURCE.indexOf('DEFAULT_LLM_SETTINGS'))
const settingKeys = [...new Set(
  [...defaultsBlock.slice(0, defaultsBlock.indexOf('\n}')).matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)]
    .map((match) => match[1]),
)]
assert.ok(settingKeys.length > 20, `settings key scan found only ${settingKeys.length} keys — the scan, not the settings, is broken`)
// Where a field is DECLARED, defaulted, or merely rendered does not count as
// consuming it; a consumer is code that reads it to decide something.
const DECLARATION_SITES = new Set([
  'src/agent/types.ts',
  'src/pages/SettingsPage.tsx',
  'src/store/settingsStore.ts',
])
/**
 * `agent/llm.ts` holds the defaults literal AND real consuming logic, so
 * excluding the whole file reported live settings as orphans — this guard's
 * first draft did exactly that, and `llmRetryMaxAttempts` /
 * `llmCircuitBreakerEnabled` were on the debt list while `llm.ts` was reading
 * them two lines below the defaults. Only the defaults literal is excluded.
 */
const llmSource = read('src/agent/llm.ts')
const llmDefaultsAt = llmSource.indexOf('DEFAULT_LLM_SETTINGS')
const llmWithoutDefaults = llmSource.slice(0, llmDefaultsAt) + llmSource.slice(llmSource.indexOf('\n}', llmDefaultsAt))
const consumerText = (file: string): string => {
  const rel = file.slice(root.length + 1).replaceAll('\\', '/')
  if (DECLARATION_SITES.has(rel)) return ''
  if (rel === 'src/agent/llm.ts') return llmWithoutDefaults
  return readFileSync(file, 'utf8')
}
/**
 * Empty, and it should stay that way (issue 21 is done).
 *
 * It once held seven names. Two were this guard's own false positives — it
 * excluded all of `agent/llm.ts`, which holds the defaults AND real consuming
 * logic. Of the five that were real: `ambientSuggestions` named a feature that
 * had never been built, so it was built; `llmParseEnabled` named one the Pi
 * migration deliberately replaced, so it was removed rather than revived; and
 * the two classifier fields reached a module that existed but was never called
 * on the outbound path, so the pass was wired in.
 *
 * A new entry here is a promise the product does not keep. Prefer wiring or
 * removing the field over adding its name.
 */
const KNOWN_UNCONSUMED_SETTINGS = new Set<string>([])
/**
 * Fields that are DELIBERATELY unconsumed, with the reason on record.
 *
 * This guard asks "does anything read it", which cannot tell a forgotten
 * switch from a field kept on purpose. `concurrentRunsEnabled` is the latter:
 * `settingsStore` force-sets it to true and says why — cross-thread execution
 * is an invariant now, not an opt-in, and the field survives only so an older
 * exported settings bundle still loads. It has no UI, so it is not a control
 * the user can move. Wiring it would restore the app-wide single-run lock that
 * was deliberately removed.
 */
const INTENTIONALLY_UNCONSUMED_SETTINGS = new Set([
  'concurrentRunsEnabled',
])
const unconsumed = settingKeys
  .filter((key) => !KNOWN_UNCONSUMED_SETTINGS.has(key) && !INTENTIONALLY_UNCONSUMED_SETTINGS.has(key))
  .filter((key) => !sourceFiles.some((file) => new RegExp(`\\b${key}\\b`).test(consumerText(file))))
assert.deepEqual(unconsumed, [], `these Settings fields are written by the UI and read by nothing: ${unconsumed.join(', ')}. Either wire them to behaviour or remove them (issue 18).`)
// The debt list must shrink, never quietly grow stale: a field that gained a
// consumer has to leave the list, or the list stops describing reality.
const revived = [...KNOWN_UNCONSUMED_SETTINGS]
  .filter((key) => sourceFiles.some((file) => new RegExp(`\\b${key}\\b`).test(consumerText(file))))
assert.deepEqual(revived, [], `these fields now HAVE consumers and must be removed from KNOWN_UNCONSUMED_SETTINGS: ${revived.join(', ')}`)

// ── Guard 7: durable memory has exactly one production owner ──
// Ticket 15 closes the expand-contract window. The old renderer IPC and Host
// memory/* surface returned whole collections and made it possible to rebuild
// a second owner beside DurableMemoryStore. Migration may still READ schema
// 1/2 JSON, but production snapshots and callable protocols cannot carry it.
assert.equal(existsSync(join(root, 'electron/piMemoryExtension.ts')), false, 'PiMemoryExtension was the JSON/in-memory owner and must not return')
const legacyMemoryChannels = [
  'pi-host:memory:list',
  'pi-host:memory:add',
  'pi-host:memory:delete',
  'pi-host:memory:clear',
  'pi-host:memory:recall',
]
const productionMemoryBoundary = [
  'electron/main.ts',
  'electron/preload.ts',
  'electron/piHostSupervisor.ts',
  'electron/piHostProtocol.ts',
].map((file) => read(file)).join('\n')
for (const channel of legacyMemoryChannels) {
  assert.doesNotMatch(productionMemoryBoundary, new RegExp(channel.replaceAll('/', '\\/')), `${channel} is a retired whole-bundle memory owner`)
}
const hostStateSource = read('electron/piHostState.ts')
assert.doesNotMatch(hostStateSource, /^\s*memories\??:\s*PiMemory\[\]/m, 'production PiHostSnapshot cannot contain live memory bodies')
assert.doesNotMatch(read('electron/piHostProtocol.ts'), /result:\s*\{[^\n]*memories\b/, 'Pi Host responses cannot masquerade as the retired memory collection protocol')

// ── Guard 7b: protocol domains pass the deletion test ──
// Sessions, run management and tools used to be implemented as branches in
// the already-wide request dispatcher. Their domain modules are now the only
// public route: deleting one removes the capability instead of revealing a
// second fallback branch in handlePiHostRequest.
const piHostProtocol = read('electron/piHostProtocol.ts')
const requestDispatcher = piHostProtocol.slice(
  piHostProtocol.indexOf('export function handlePiHostRequest('),
  piHostProtocol.indexOf('export type PiHostDispatchOutcome'),
)
const protocolDomains = [
  ['Session', 'electron/piHostSessionDomain.ts', 'handlePiHostSessionDomain', 'sessions/', undefined],
  ['Run', 'electron/piHostRunDomain.ts', 'handlePiHostRunDomain', 'runs/', 'handleRunRequest'],
  ['Tool', 'electron/piHostToolDomain.ts', 'handlePiHostToolDomain', 'tools/', undefined],
  ['Turn', 'electron/piHostTurnDomain.ts', 'handlePiHostTurnDomain', 'turn/', undefined],
] as const
for (const [label, file, owner, prefix, routerHelper] of protocolDomains) {
  assert.match(piHostProtocol, new RegExp(`from './${file.slice('electron/'.length, -3)}\\.ts'`), `${label} domain must be imported by the protocol router`)
  const routeOwner = routerHelper
    ? piHostProtocol.slice(piHostProtocol.indexOf(`function ${routerHelper}(`), piHostProtocol.indexOf(`function ${routerHelper === 'handleRunRequest' ? 'handleAgentRequest' : 'handlePiHostRequest'}(`))
    : requestDispatcher
  if (routerHelper) assert.match(requestDispatcher, new RegExp(`\\b${routerHelper}\\(`), `${label} router helper must remain reachable from the main dispatcher`)
  assert.match(routeOwner, new RegExp(`\\b${owner}\\(`), `${label} domain must own its protocol route`)
  assert.match(read(file), new RegExp(prefix.replace('/', '\\/')), `${label} domain must name the capability it deletes`)
}
assert.doesNotMatch(requestDispatcher, /if \(input\.method === '(?:sessions|runs|tools|turn|approvals)\//, 'session/run/tool/turn method branches must not return to the main dispatcher')

// ── Guard 7c: hardening prefactors have one real production owner ──
// These are intentional deletion/ownership assertions. Their behavior belongs
// to shipped-module smokes; this guard only proves the seam is actually used.
const prefactorOwners = [
  ['src/agent/taskRunAdmission.ts', 'src/agent/taskRunCoordinator.ts', 'decideInitialTaskRunAdmission'],
  ['electron/piHostTurnDomain.ts', 'electron/piHostProtocol.ts', 'handlePiHostTurnDomain'],
  ['electron/externalCliProviderParsers.ts', 'electron/localCliRunner.ts', 'parseProviderJsonEvent'],
  ['src/agent/startupRecoveryPhases.ts', 'src/App.tsx', 'createStartupRecoveryPhaseTracker'],
] as const
for (const [module, owner, symbol] of prefactorOwners) {
  assert.equal(existsSync(join(root, module)), true, `${module} is the declared hardening seam`)
  assert.match(read(owner), new RegExp(`\\b${symbol}\\b`), `${owner} must remain the production owner of ${symbol}`)
}


// ── Guard 8: a test file must be reachable from a gate ──
// A test nobody runs is not a test. `smoke-pi-parity-removal` — the parity
// evidence that authorized deleting six renderer tools — sat unreferenced and
// rotted, and it took writing a new assertion to notice (issue 20). This
// measures FILES reachable from `npm run smoke` / `build` / `dist*`, not npm
// script names, because an alias can exist while its file is already run
// inline.
const packageScripts = JSON.parse(read('package.json')).scripts as Record<string, string>
const expandScript = (name: string, seen = new Set<string>()): string => {
  if (seen.has(name)) return ''
  seen.add(name)
  let body = packageScripts[name] || ''
  for (const referenced of body.match(/npm run [A-Za-z0-9:_-]+/g) || []) {
    body += ` ${expandScript(referenced.slice('npm run '.length), seen)}`
  }
  // Cross-platform environment wrappers cannot be expressed as inline shell
  // assignments. Their explicit target argument is still part of the static
  // npm-script graph and must remain visible to the orphan-test guard.
  for (const wrapped of body.matchAll(/scripts\/run-[A-Za-z0-9._-]+\.mts((?: [A-Za-z0-9:_-]+)+)/g)) {
    for (const target of wrapped[1].trim().split(/\s+/)) body += ` ${expandScript(target, seen)}`
  }
  return body
}
const gateBody = ['smoke', 'check']
  .filter((name) => packageScripts[name])
  .map((name) => expandScript(name))
  .join(' ')
const runByGate = new Set((gateBody.match(/scripts\/[A-Za-z0-9._-]+\.(?:mts|mjs)/g) || [])
  .map((path) => path.slice('scripts/'.length)))
const testFiles = readdirSync(join(root, 'scripts'))
  .filter((file) => /^smoke-.*\.(mts|mjs)$/.test(file) || file.startsWith('qualify-'))
/** Release/credential qualifications are intentionally invoked by an operator.
 * Every deterministic smoke still has to be reachable from the main gate.
 */
const MANUAL_QUALIFICATION_TESTS = new Set([
  'qualify-pi-host.mts',
  'qualify-pi-sync.mts',
  'qualify-release.mts',
  // ADR-0052 ticket 06: real-credential qualification — needs a machine with
  // Codex/Claude CLI login, so it stays out of the chain by that ticket's own
  // decision (「兩者需真機憑證，不進 smoke chain」); manual runners:
  // npm run qualify:subscription-snapshot / qualify:subscription-e2e /
  // qualify:subscription-oauth-rotation.
  'qualify-subscription-e2e.mts',
  'qualify-subscription-oauth-rotation-e2e.mts',
  'qualify-subscription-snapshot.mts',
  // Real shipped CLI binaries require machine-local installs, provider login,
  // and network access. Keep the qualification explicit and out of build.
  'qualify-external-cli-real.mts',
])
const newOrphans = testFiles.filter((file) => !runByGate.has(file) && !MANUAL_QUALIFICATION_TESTS.has(file))
assert.deepEqual(newOrphans, [], `these test files are not reachable from any gate, so nothing runs them: ${newOrphans.join(', ')}. Wire them into npm run smoke (issue 20).`)
const nowGated = [...MANUAL_QUALIFICATION_TESTS].filter((file) => runByGate.has(file))
assert.deepEqual(nowGated, [], `these files are now gated and must be removed from MANUAL_QUALIFICATION_TESTS: ${nowGated.join(', ')}`)

console.log('Pi contract drift guards passed: registrations frozen, equivalents removed, skills discovery single-owner, guidance agrees with the gate, settings fields have consumers, every automated test is gated and manual qualifications are explicit')
