/** Deterministic contract smoke for the manual Codex/Claude qualification. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseClaudeAuthStatus, parseCodexLoginStatus } from '../src/agent/externalCliAuth.ts'

const script = resolve(import.meta.dirname, 'qualify-external-cli-real.mts')
const baseEnv = { ...process.env, SUBAGENTS_EXTERNAL_CLI_QUALIFICATION_FIXTURE: '1' }

assert.equal(parseCodexLoginStatus({ status: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' }), true)
assert.equal(parseCodexLoginStatus({ status: 1, stdout: 'Logged in using ChatGPT\n', stderr: 'login failed' }), false)
assert.equal(parseCodexLoginStatus({ status: 0, stdout: 'login required', stderr: '' }), false)
assert.equal(parseClaudeAuthStatus({ status: 0, stdout: '{"loggedIn":true}', stderr: '' }), true)
assert.equal(parseClaudeAuthStatus({ status: 1, stdout: '{"loggedIn":true}', stderr: '' }), false)

function runFixture(scenario: string) {
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script], {
    env: { ...baseEnv, SUBAGENTS_EXTERNAL_CLI_QUALIFICATION_FIXTURE_SCENARIO: scenario },
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { ...result, elapsedMs: Date.now() - startedAt }
}

type FixtureReport = {
  qualificationMode: string
  evidenceRoot: string
  providers: Array<{
    provider: string
    status: string
    code: string
    installed: boolean
    attempted: boolean
    stage: string
    authUsable: boolean
    unqualified: boolean
    exitCode?: number | null
    diagnostic?: 'auth/login' | 'network' | 'quota' | 'argv-usage' | 'provider-error' | 'unknown'
    markerCounts?: { expected: number; forbidden: number; qualification: number }
    instructionDelivery?: { mode: string; exactSnapshot: boolean; effectiveHash: string; limitationReason?: string; sourceSummary: Array<{ status: string; bytes: number; hashAvailable: boolean }> }
    argv?: { args: string[] }
    reason?: { code: string; stage: string }
  }>
}

function readScenario(result: ReturnType<typeof runFixture>): FixtureReport {
  assert.equal(result.error, undefined)
  assert.ok(result.stdout, result.stderr)
  const report = JSON.parse(result.stdout) as FixtureReport
  assert.equal(report.qualificationMode, 'fixture')
  const json = readFileSync(resolve(report.evidenceRoot, 'real-cli-qualification.json'), 'utf8')
  const markdown = readFileSync(resolve(report.evidenceRoot, 'real-cli-qualification.md'), 'utf8')
  for (const body of [json, markdown, result.stdout]) {
    assert.equal(/QUALIFIED_(?:CODEX|CLAUDE)|NATIVE_(?:AGENTS|CLAUDE)_(?:CODEX|CLAUDE)/i.test(body), false, 'fixture evidence remains metadata-only')
    assert.equal(/(?:api[_ -]?key|authorization|bearer)\s*[=:"']/i.test(body), false, 'fixture evidence contains no credential body')
  }
  rmSync(report.evidenceRoot, { recursive: true, force: true })
  return report
}

const passed = runFixture('pass')
assert.equal(passed.status, 0, passed.stderr)
const passReport = readScenario(passed)
assert.equal(passReport.providers.length, 2)
for (const provider of passReport.providers) {
  assert.equal(provider.status, 'qualified')
  assert.equal(provider.code, 'qualified')
  assert.equal(provider.installed, true)
  assert.equal(provider.attempted, true)
  assert.equal(provider.authUsable, true)
  assert.equal(provider.unqualified, false)
  assert.equal(provider.stage, 'complete')
  assert.equal(provider.exitCode, 0)
  assert.equal(provider.diagnostic, 'unknown')
  assert.deepEqual(provider.markerCounts, { expected: 1, forbidden: 0, qualification: 1 })
  assert.equal(provider.instructionDelivery?.mode, 'native')
  assert.equal(provider.instructionDelivery?.exactSnapshot, false)
  assert.match(provider.instructionDelivery?.effectiveHash || '', /^[a-f0-9]{64}$/)
  assert.match(provider.instructionDelivery?.limitationReason || '', /native discovery/)
  assert.ok(provider.instructionDelivery?.sourceSummary.some((source) => source.status === 'applied' && source.bytes > 0 && source.hashAvailable))
  assert.ok(provider.argv?.args.every((arg) => !/AGENTS\.md|CLAUDE\.md|QUALIFIED_|NATIVE_/.test(arg)))
}

// A provider that is installed and auth-usable but fails the native proof is
// an actual qualification failure, not a blocked/pass result.
const nativeFailure = runFixture('native-failure')
assert.equal(nativeFailure.status, 1, nativeFailure.stdout)
const failureReport = readScenario(nativeFailure)
assert.ok(failureReport.providers.every((provider) => provider.status === 'failed' && provider.code === 'native_discovery_unproven' && provider.unqualified))
assert.ok(failureReport.providers.every((provider) => provider.exitCode === 0 && provider.diagnostic === 'unknown'))

const blockedAuth = runFixture('blocked-auth')
assert.equal(blockedAuth.status, 0, blockedAuth.stderr)
const blockedAuthReport = readScenario(blockedAuth)
assert.ok(blockedAuthReport.providers.every((provider) => provider.status === 'blocked' && provider.code === 'auth_unavailable' && provider.installed && !provider.attempted && !provider.authUsable && provider.unqualified))

const blockedInstall = runFixture('blocked-not-installed')
assert.equal(blockedInstall.status, 0, blockedInstall.stderr)
const blockedInstallReport = readScenario(blockedInstall)
assert.ok(blockedInstallReport.providers.every((provider) => provider.status === 'blocked' && provider.code === 'provider_not_installed' && !provider.installed && !provider.attempted && !provider.authUsable && provider.unqualified))

const fastSettle = runFixture('fast-settle')
assert.equal(fastSettle.status, 1, fastSettle.stdout)
assert.ok(fastSettle.elapsedMs < 10_000, `fast-settle fixture must not wait for the checkpoint deadline (${fastSettle.elapsedMs}ms)`)
const fastSettleReport = readScenario(fastSettle)
assert.ok(fastSettleReport.providers.every((provider) => provider.status === 'failed' && provider.code === 'active_checkpoint_unobserved' && provider.unqualified && provider.reason?.code === 'active_checkpoint_unobserved'))

const rejectedRunArgv = runFixture('reject-runargv')
assert.equal(rejectedRunArgv.status, 1, rejectedRunArgv.stdout)
assert.ok(rejectedRunArgv.elapsedMs < 10_000, `rejecting runArgv fixture must settle without waiting for the checkpoint deadline (${rejectedRunArgv.elapsedMs}ms)`)
const rejectedReport = readScenario(rejectedRunArgv)
assert.ok(rejectedReport.providers.every((provider) => provider.status === 'failed' && provider.code === 'active_checkpoint_unobserved' && provider.exitCode === null && provider.diagnostic === 'provider-error' && provider.reason?.code === 'active_checkpoint_unobserved'))
console.log('external CLI real qualification fixture passed: production admission/adapter, native proof, metadata-only record, restart and blocked exit contract')
