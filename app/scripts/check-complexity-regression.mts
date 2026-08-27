import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

type OxlintDiagnostic = {
  filename: string
  message: string
}

type OxlintReport = {
  diagnostics?: OxlintDiagnostic[]
}

const appRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appRoot, '..')
const oxlintBin = resolve(appRoot, 'node_modules/.bin/oxlint')
const baseRef = process.argv[2] || process.env.COMPLEXITY_BASE_REF || 'HEAD^'
const sourcePattern = /^(?:app\/)?(?:src|electron|scripts)\/.*\.(?:[cm]?[jt]sx?)$/

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

function changedSourceFiles(): string[] {
  return git(['diff', '--name-only', '--diff-filter=ACMR', baseRef, '--'])
    .split('\n')
    .filter((path) => sourcePattern.test(path))
}

function runOxlint(files: string[]): OxlintReport {
  if (files.length === 0) return { diagnostics: [] }
  const result = spawnSync(oxlintBin, [
    '-c', resolve(appRoot, '.oxlintrc.json'),
    '-A', 'all',
    '-D', 'complexity',
    '-f', 'json',
    ...files,
  ], { cwd: appRoot, encoding: 'utf8' })
  const output = result.stdout.trim()
  if (!output) {
    throw new Error(result.stderr.trim() || 'oxlint produced no JSON report')
  }
  return JSON.parse(output) as OxlintReport
}

function diagnosticBuckets(report: OxlintReport, root: string): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  for (const diagnostic of report.diagnostics || []) {
    const match = diagnostic.message.match(/^(.*?) has a complexity of (\d+)\./)
    if (!match) continue
    const file = relative(root, diagnostic.filename).replaceAll('\\', '/')
    const key = `${file}::${match[1]}`
    const values = buckets.get(key) || []
    values.push(Number(match[2]))
    buckets.set(key, values)
  }
  for (const values of buckets.values()) values.sort((left, right) => left - right)
  return buckets
}

function materializeBase(files: string[], targetRoot: string): string[] {
  const materialized: string[] = []
  for (const repoPath of files) {
    const source = spawnSync('git', ['show', `${baseRef}:${repoPath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    if (source.status !== 0) continue // Added files have no baseline allowance.
    const appPath = repoPath.startsWith('app/') ? repoPath.slice(4) : repoPath
    const target = join(targetRoot, appPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source.stdout)
    materialized.push(target)
  }
  return materialized
}

const changed = changedSourceFiles()
if (changed.length === 0) {
  console.log(`complexity gate: no changed source files against ${baseRef}`)
  process.exit(0)
}

const currentFiles = changed.map((path) => resolve(repoRoot, path))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'subagents-complexity-'))

try {
  const baseFiles = materializeBase(changed, temporaryRoot)
  const current = diagnosticBuckets(runOxlint(currentFiles), appRoot)
  const baseline = diagnosticBuckets(runOxlint(baseFiles), temporaryRoot)
  const regressions: string[] = []

  for (const [key, currentValues] of current) {
    const remainingAllowances = [...(baseline.get(key) || [])]
    for (const value of currentValues) {
      const allowanceIndex = remainingAllowances.findIndex((allowed) => allowed >= value)
      if (allowanceIndex >= 0) {
        remainingAllowances.splice(allowanceIndex, 1)
        continue
      }
      const previous = remainingAllowances.pop()
      regressions.push(previous === undefined
        ? `${key}: new complexity ${value} (max 20)`
        : `${key}: ${previous} -> ${value}`)
    }
  }

  if (regressions.length > 0) {
    console.error(`complexity gate failed against ${baseRef}:`)
    regressions.forEach((regression) => console.error(`- ${regression}`))
    process.exitCode = 1
  } else {
    console.log(`complexity gate passed against ${baseRef} (${changed.length} changed source files)`)
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
