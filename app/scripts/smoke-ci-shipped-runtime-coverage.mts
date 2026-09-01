import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const workflowPath = resolve(repositoryRoot, '.github/workflows/ci.yml')
const workflow = await readFile(workflowPath, 'utf8')
const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}

function eventPaths(source: string, event: 'push' | 'pull_request'): string[] {
  const eventStart = source.search(new RegExp(`^  ${event}:\\s*$`, 'm'))
  assert.notEqual(eventStart, -1, `CI workflow must declare ${event}`)
  const tail = source.slice(eventStart)
  const nextEvent = tail.slice(1).search(/^  [a-zA-Z_]+:\s*$/m)
  const eventSource = nextEvent < 0 ? tail : tail.slice(0, nextEvent + 1)
  const pathsStart = eventSource.search(/^    paths:\s*$/m)
  assert.notEqual(pathsStart, -1, `${event} must declare blocking path coverage`)
  return [...eventSource.slice(pathsStart).matchAll(/^      - '([^']+)'\s*$/gm)].map((match) => match[1])
}

function pathMatches(pattern: string, changedPath: string): boolean {
  if (!pattern.endsWith('/**')) return pattern === changedPath
  const root = pattern.slice(0, -3)
  return changedPath === root || changedPath.startsWith(`${root}/`)
}

function jobSource(source: string, jobName: string): string {
  const jobsStart = source.search(/^jobs:\s*$/m)
  assert.notEqual(jobsStart, -1, 'CI workflow jobs section is missing')
  const jobsSource = source.slice(jobsStart)
  const jobs = [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)]
  const index = jobs.findIndex((match) => match[1] === jobName)
  assert.notEqual(index, -1, `CI workflow job is missing: ${jobName}`)
  return jobsSource.slice(jobs[index].index, jobs[index + 1]?.index ?? jobsSource.length)
}

function assertBlockingJob(source: string, jobName: string): void {
  assert.doesNotMatch(source, /^    if:\s*/m, `${jobName} must not be conditionally skipped`)
  assert.doesNotMatch(source, /continue-on-error:\s*true/, `${jobName} and its required steps must remain blocking`)
}

function assertBlockingStep(source: string, jobName: string, command: string): void {
  const steps = [...source.matchAll(/^      - name:.*$/gm)]
  const stepSources = steps.map((step, index) => source.slice(step.index, steps[index + 1]?.index ?? source.length))
  const matches = stepSources.filter((step) => step.includes(command))
  assert.equal(matches.length, 1, `${jobName} must have exactly one required step for: ${command}`)
  assert.doesNotMatch(matches[0], /^        if:\s*/m, `${jobName} required step must not be conditionally skipped: ${command}`)
  assert.doesNotMatch(matches[0], /^        continue-on-error:\s*true/m, `${jobName} required step must remain blocking: ${command}`)
}

function resolveNpmScript(scripts: Record<string, string>, scriptName: string, visiting = new Set<string>()): string {
  assert.ok(!visiting.has(scriptName), `npm script cycle while resolving macOS CI contract: ${scriptName}`)
  const command = scripts[scriptName]
  assert.ok(command, `npm script referenced by macOS CI contract is missing: ${scriptName}`)
  const nextVisiting = new Set(visiting).add(scriptName)
  const nested = [...command.matchAll(/(?:^|&&|;)\s*npm run ([a-zA-Z0-9:_-]+)/g)]
    .map((match) => resolveNpmScript(scripts, match[1], nextVisiting))
  return [command, ...nested].join('\n')
}

const coverageFixtures = [
  ['ordinary app source', 'app/src/App.tsx'],
  ['vendored Pi runtime', 'vendor/pi/packages/agent/src/agent-loop.ts'],
  ['vendored Pi pin', 'vendor/pi/PI_UPSTREAM_PIN.json'],
  ['vendored Pi patch ledger', 'vendor/pi/PI_CORE_PATCH_LEDGER.md'],
  ['release workflow authority', '.github/workflows/release.yml'],
  ['release signing authority', 'docs/RELEASE_SIGNING_SETUP.md'],
  ['security authority', 'docs/SECURITY_BASELINE.md'],
  ['architecture decision authority', 'docs/adr/0044-pin-pi-releases-and-sync-upstream-through-gated-prs.md'],
  ['agent architecture guidance', 'CLAUDE.md'],
] as const

for (const event of ['push', 'pull_request'] as const) {
  const paths = eventPaths(workflow, event)
  for (const [label, changedPath] of coverageFixtures) {
    assert.ok(
      paths.some((pattern) => pathMatches(pattern, changedPath)),
      `${event} must trigger blocking CI for ${label}: ${changedPath}`,
    )
  }
}

const verify = jobSource(workflow, 'verify')
assertBlockingJob(verify, 'verify')
assert.match(verify, /os: \[ubuntu-latest, windows-latest\]/, 'common verification stays explicitly Linux + Windows')
assert.match(verify, /npm run qualify:deterministic[\s\S]*npm run build[\s\S]*npm run smoke:ci/, 'common jobs run deterministic qualification, compile, then stable smoke')
assert.doesNotMatch(verify, /smoke-pi-bwrap-builtin-shell/, 'the common matrix must not duplicate Linux kernel evidence')
for (const command of ['npm run qualify:deterministic', 'npm run build', 'npm run smoke:ci']) {
  assertBlockingStep(verify, 'verify', command)
}

const piRuntime = jobSource(workflow, 'pi-runtime')
assertBlockingJob(piRuntime, 'pi-runtime')
assert.match(piRuntime, /runs-on: ubuntu-latest/, 'Pi compatibility has one stable Linux owner')
assert.match(piRuntime, /apt-get install -y bubblewrap[\s\S]*bwrap --version[\s\S]*npm run qualify:pi-runtime-contract/, 'the Pi owner provisions and proves its Linux sandbox dependency before qualification')
assert.match(piRuntime, /npm run qualify:pi-runtime-contract/, 'the shipped Pi runtime uses its owning compatibility qualification')
assertBlockingStep(piRuntime, 'pi-runtime', 'npm run qualify:pi-runtime-contract')

const macosRuntime = jobSource(workflow, 'macos-runtime')
assertBlockingJob(macosRuntime, 'macos-runtime')
assert.match(macosRuntime, /runs-on: macos-15/, 'macOS runtime evidence comes from a current native runner')
assert.match(macosRuntime, /npm run qualify:macos-runtime-contract/, 'macOS job runs the bounded platform runtime contract')
assertBlockingStep(macosRuntime, 'macos-runtime', 'npm run qualify:macos-runtime-contract')
assert.doesNotMatch(
  macosRuntime,
  /electron-builder|npm run dist(?::|\s)|npm run verify:mac-signature|codesign|notari|stapler|APPLE_ID|CSC_LINK|release-signing|release-promotion|upload-artifact/i,
  'PR macOS evidence must not package, sign, notarize, publish, or masquerade as release evidence',
)

const expectedMacosContract = 'npm run build:pi-host && node --experimental-strip-types scripts/smoke-platform.mts && node --experimental-strip-types scripts/smoke-pi-seatbelt-builtin-shell.mts && node --experimental-strip-types scripts/smoke-pi-adr0047-real-turn-denial.mts && node --experimental-strip-types scripts/smoke-outbound-shell-evidence.mts'
const macosContract = packageJson.scripts?.['qualify:macos-runtime-contract']
assert.equal(macosContract, expectedMacosContract, 'macOS CI contract stays on the reviewed unsigned runtime allowlist')
const resolvedMacosContract = resolveNpmScript(packageJson.scripts ?? {}, 'qualify:macos-runtime-contract')
assert.doesNotMatch(
  resolvedMacosContract,
  /electron-builder|npm run dist(?::|\s)|npm run verify:mac-signature|codesign|notari|stapler|publish/i,
  'the resolved macOS package-script graph must not package, sign, notarize, or publish',
)
assert.doesNotMatch(
  workflow,
  /release-promotion\.mjs --publish|UPDATE_(?:BETA|STABLE)_PUBLISH_URL|UPDATE_PUBLISH_TOKEN/,
  'CI qualification never owns customer-facing publication',
)

console.log('CI shipped-runtime coverage: app, Pi vendor/pin, authority contracts, and platform-only evidence are blocking')
