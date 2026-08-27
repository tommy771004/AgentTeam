import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Issue 16 — a skill that fails to migrate is REPORTED, not dropped.
 *
 * The Host always built a per-skill report. The renderer read only
 * `results.every(ok)` and discarded the rest, so a malformed skill vanished:
 * no entry, no error, and the boot loop retried twenty times in silence. The
 * assertions below cover the two halves that failure had — the outcome must
 * survive into a store, and the store must be rendered where skills live.
 */

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

console.log('smoke-skill-migration-report')

const { failedSkillMigrations } = await import('../src/store/skillMigrationStore.ts')

test('failures are extracted from a mixed report, successes are not', () => {
  const failures = failedSkillMigrations({
    at: '2026-08-25T00:00:00.000Z',
    skillsDir: '/tmp/skills',
    complete: false,
    outcomes: [
      { name: 'good', ok: true, slug: 'good' },
      { name: 'broken', ok: false, error: 'frontmatter is missing a name' },
      { name: 'also-broken', ok: false, error: 'body is empty' },
    ],
  })
  assert.deepEqual(failures, [
    { name: 'broken', error: 'frontmatter is missing a name' },
    { name: 'also-broken', error: 'body is empty' },
  ], 'each failure keeps the reason it failed, which is the actionable part')
})

test('an all-success report yields no diagnostic', () => {
  assert.deepEqual(failedSkillMigrations({
    at: '2026-08-25T00:00:00.000Z', skillsDir: '/tmp/skills', complete: true,
    outcomes: [{ name: 'good', ok: true, slug: 'good' }],
  }), [])
  assert.deepEqual(failedSkillMigrations(undefined), [], 'no report is not an error state')
})

test('the bootstrap publishes every attempt, not just the complete one', () => {
  const app = read('src/App.tsx')
  const syncOwner = read('src/agent/hermes/skillHostSync.ts')
  const bootstrap = app.slice(app.indexOf('function SkillsMigrationBootstrap'))
  assert.match(syncOwner, /setReport\(/, 'the serialized Host sync publishes every per-skill outcome')
  // The sync owner publishes before resolving. The bootstrap must await it,
  // then read the published report, and only then decide migration completion.
  const syncAt = bootstrap.indexOf('await syncSkillsToHost()')
  const readReportAt = bootstrap.indexOf('getState().report')
  const completeGateAt = bootstrap.indexOf('if (complete)')
  assert.ok(syncAt !== -1 && readReportAt !== -1 && completeGateAt !== -1)
  assert.ok(syncAt < readReportAt && readReportAt < completeGateAt,
    'the serialized sync report is read BEFORE the completion gate, so a partial migration still reports')
  assert.match(bootstrap, /unreachable: true/,
    'exhausting the retry budget is itself reported — "Host unreachable" and "migrated fine" must not look alike')
})

test('the report is rendered where skills live', () => {
  const page = read('src/pages/LearningPage.tsx')
  assert.match(page, /SkillMigrationDiagnostics/, 'the Skills section renders the diagnostic')
  assert.match(page, /failedSkillMigrations/, 'it lists the failures rather than only a count')
  // A diagnostic that interrupts is a different product decision; this one is
  // read on arrival, like a doctor report. Scoped to the component — the page
  // has unrelated confirmations elsewhere.
  const component = page.slice(page.indexOf('function SkillMigrationDiagnostics'))
  assert.doesNotMatch(component, /window\.alert|\bconfirm\(/, 'the diagnostic never interrupts the user')
  assert.match(component, /failure\.error/, 'each failing skill shows its own reason')
})

console.log(`\n${passed} tests passed`)
