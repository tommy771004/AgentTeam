import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appRoot, '..')
const read = (path: string) => readFile(resolve(repoRoot, path), 'utf8')

const [appReadme, rootReadme, devState, index, spec, qualification, report] = await Promise.all([
  read('app/README.md'),
  read('README.md'),
  read('DEV_STATE.md'),
  read('.scratch/INDEX.md'),
  read('.scratch/release-qualification-hardening/spec.md'),
  read('.scratch/release-qualification-hardening/qualification.md'),
  read('app/release-evidence/paid-beta-qualification.md'),
])

for (const vocabulary of ['compile success', 'deterministic qualification', 'platform qualification', 'release-ready', 'Paid Beta GO']) {
  assert.match(`${appReadme}\n${rootReadme}\n${devState}`, new RegExp(vocabulary, 'i'), `missing readiness term: ${vocabulary}`)
}
assert.match(appReadme, /plain-browser[\s\S]{0,160}(?:UI|degraded preview)[\s\S]{0,160}(?:does not|不)[\s\S]{0,160}production Pi[\s\S]{0,40}Core Host/i)
assert.match(spec, /^Status: resolved$/m)
assert.match(report, /^# Paid Beta Release Qualification: NO-GO$/m)
assert.match(report, /Criteria: 0\/49 passed/)
assert.match(report, /Automated repository hardening: BLOCKED \(0\/6\)/)
assert.match(report, /External release evidence: BLOCKED/)
assert.match(devState, /Paid Beta[^\n]*NO-GO（0\/49）/)
assert.match(index, /release-qualification-hardening[^\n]*resolved（20\/20 tickets done/)
assert.match(index, /release-qualification-hardening\/qualification\.md/)

const issueDir = resolve(repoRoot, '.scratch/release-qualification-hardening/issues')
const issues = (await readdir(issueDir)).filter((name) => /^\d\d-.*\.md$/.test(name)).sort()
assert.equal(issues.length, 20)
for (const [position, issue] of issues.entries()) {
  const body = await readFile(resolve(issueDir, issue), 'utf8')
  assert.match(body, /\*\*Status:\*\* (?:resolved|已完成)/, `${issue} is not resolved`)
  assert.match(qualification, new RegExp(`issues/${String(position + 1).padStart(2, '0')}-`), `${issue} lacks one-hop rollup evidence`)
}

console.log('release hardening rollup keeps readiness vocabulary, links, and Paid Beta NO-GO truthful')
