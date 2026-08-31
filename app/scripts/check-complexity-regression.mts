import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
const sourcePattern = /^(?:app\/)?(?:src|electron|scripts)\/.*\.(?:[cm]?[jt]sx?)$/

export type ComplexityBaseline = {
  ref: string
  policy: 'argument' | 'environment' | 'pr-merge-base' | 'local-head-parent'
}

type ComplexityGateOptions = {
  appRoot?: string
  baseRef: string
  oxlintBin?: string
  repoRoot?: string
}

export type ComplexityGateResult = {
  changed: string[]
  regressions: string[]
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

export function resolveComplexityBaseline(options: {
  argument?: string
  env?: NodeJS.ProcessEnv
  repoRoot?: string
} = {}): ComplexityBaseline {
  const root = options.repoRoot || repoRoot
  const env = options.env || process.env
  const argument = options.argument?.trim()
  if (argument) return { ref: argument, policy: 'argument' }

  const configured = env.COMPLEXITY_BASE_REF?.trim()
  if (configured) return { ref: configured, policy: 'environment' }

  if (env.GITHUB_EVENT_NAME === 'pull_request' || env.GITHUB_EVENT_NAME === 'pull_request_target') {
    const prBaseSha = env.COMPLEXITY_PR_BASE_SHA?.trim()
    if (!prBaseSha) {
      throw new Error('PR complexity qualification requires COMPLEXITY_PR_BASE_SHA; refusing to fall back to HEAD^')
    }
    return { ref: git(root, ['merge-base', 'HEAD', prBaseSha]), policy: 'pr-merge-base' }
  }

  return { ref: 'HEAD^', policy: 'local-head-parent' }
}

function changedSourceFiles(root: string, baseRef: string): string[] {
  return git(root, ['diff', '--name-only', '--diff-filter=ACMR', baseRef, '--'])
    .split('\n')
    .filter((path) => sourcePattern.test(path))
}

function runOxlint(files: string[], root: string, binary: string, config: string): OxlintReport {
  if (files.length === 0) return { diagnostics: [] }
  const result = spawnSync(binary, [
    '-c', config,
    '-A', 'all',
    '-D', 'complexity',
    '-f', 'json',
    ...files,
  ], { cwd: root, encoding: 'utf8' })
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

function materializeBase(files: string[], targetRoot: string, root: string, baseRef: string): string[] {
  const materialized: string[] = []
  for (const repoPath of files) {
    const source = spawnSync('git', ['show', `${baseRef}:${repoPath}`], {
      cwd: root,
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

export function runComplexityGate(options: ComplexityGateOptions): ComplexityGateResult {
  const selectedAppRoot = options.appRoot || appRoot
  const selectedRepoRoot = options.repoRoot || repoRoot
  const selectedOxlintBin = options.oxlintBin || oxlintBin
  const config = resolve(appRoot, '.oxlintrc.json')
  const changed = changedSourceFiles(selectedRepoRoot, options.baseRef)
  if (changed.length === 0) return { changed, regressions: [] }

  const currentFiles = changed.map((path) => resolve(selectedRepoRoot, path))
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'subagents-complexity-'))

  try {
    const baseFiles = materializeBase(changed, temporaryRoot, selectedRepoRoot, options.baseRef)
    const current = diagnosticBuckets(
      runOxlint(currentFiles, selectedAppRoot, selectedOxlintBin, config),
      selectedAppRoot,
    )
    const baseline = diagnosticBuckets(
      runOxlint(baseFiles, temporaryRoot, selectedOxlintBin, config),
      temporaryRoot,
    )
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
    return { changed, regressions }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function main(): void {
  const baseline = resolveComplexityBaseline({ argument: process.argv[2] })
  console.log(`complexity baseline: ${baseline.policy} -> ${baseline.ref}`)
  const { changed, regressions } = runComplexityGate({ baseRef: baseline.ref })
  if (regressions.length > 0) {
    console.error(`complexity gate failed against ${baseline.ref}:`)
    regressions.forEach((regression) => console.error(`- ${regression}`))
    process.exitCode = 1
  } else if (changed.length === 0) {
    console.log(`complexity gate: no changed source files against ${baseline.ref}`)
  } else {
    console.log(`complexity gate passed against ${baseline.ref} (${changed.length} changed source files)`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
