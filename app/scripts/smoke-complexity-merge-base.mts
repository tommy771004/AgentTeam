import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveComplexityBaseline, runComplexityGate } from './check-complexity-regression.mts'

const appRoot = path.resolve(import.meta.dirname, '..')
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'complexity-merge-base-'))
const fixtureApp = path.join(fixtureRoot, 'app')
const fixtureSource = path.join(fixtureApp, 'src')

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: fixtureRoot, encoding: 'utf8' }).trim()
}

function commit(message: string): string {
  git(['add', '.'])
  git(['commit', '-m', message])
  return git(['rev-parse', 'HEAD'])
}

try {
  mkdirSync(fixtureSource, { recursive: true })
  git(['init', '--initial-branch=main'])
  git(['config', 'user.email', 'complexity-fixture@example.invalid'])
  git(['config', 'user.name', 'Complexity Fixture'])

  writeFileSync(path.join(fixtureSource, 'early.ts'), 'export function early(value: number) { return value }\n')
  const baseSha = commit('base')
  git(['checkout', '-q', '-b', 'feature'])

  const branches = Array.from({ length: 22 }, (_, index) => `  if (value === ${index}) return ${index}`).join('\n')
  writeFileSync(path.join(fixtureSource, 'early.ts'), `export function early(value: number) {\n${branches}\n  return -1\n}\n`)
  commit('introduce earlier complexity regression')

  writeFileSync(path.join(fixtureSource, 'tip.ts'), 'export const tip = true\n')
  commit('unrelated tip commit')

  git(['checkout', '-q', 'main'])
  writeFileSync(path.join(fixtureSource, 'base-only.ts'), 'export const baseOnly = true\n')
  const prBaseSha = commit('advance base branch independently')
  git(['checkout', '-q', 'feature'])

  assert.throws(
    () => resolveComplexityBaseline({
      env: { GITHUB_EVENT_NAME: 'pull_request', COMPLEXITY_BASE_REF: 'HEAD^' },
      repoRoot: fixtureRoot,
    }),
    /COMPLEXITY_PR_BASE_SHA.*refusing to fall back to HEAD\^/,
    'PR qualification must fail closed when the base SHA is absent even if a local override exists',
  )
  const baseline = resolveComplexityBaseline({
    argument: 'HEAD^',
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      COMPLEXITY_BASE_REF: 'HEAD^',
      COMPLEXITY_PR_BASE_SHA: prBaseSha,
    },
    repoRoot: fixtureRoot,
  })
  assert.equal(baseline.policy, 'pr-merge-base')
  assert.equal(baseline.ref, baseSha)

  const mergeBaseResult = runComplexityGate({
    appRoot: fixtureApp,
    baseRef: baseline.ref,
    oxlintBin: path.join(appRoot, 'node_modules/.bin/oxlint'),
    repoRoot: fixtureRoot,
  })
  assert.match(mergeBaseResult.regressions.join('\n'), /early.*new complexity/i)

  const formerBehavior = runComplexityGate({
    appRoot: fixtureApp,
    baseRef: 'HEAD^',
    oxlintBin: path.join(appRoot, 'node_modules/.bin/oxlint'),
    repoRoot: fixtureRoot,
  })
  assert.deepEqual(formerBehavior.regressions, [], 'HEAD^ counterexample misses the regression from the earlier commit')

  assert.deepEqual(
    resolveComplexityBaseline({ env: { COMPLEXITY_BASE_REF: baseSha }, repoRoot: fixtureRoot }),
    { ref: baseSha, policy: 'environment' },
    'local baseline remains explicit and overridable',
  )
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log('complexity merge-base qualification catches regressions hidden before the tip commit')
