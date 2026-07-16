/**
 * CodeGraph CLI bridge — https://github.com/colbymchenry/codegraph
 *
 * Compatible with CLI 0.9.x and 1.x:
 * - init / status / sync take a **positional** path (not `-p`)
 * - query / callers / callees / impact accept `-p/--path` (0.9+) and also honor `cwd`
 * - `explore` / `node` exist only on 1.x — fall back to `query` on older CLIs
 *
 * Project index: <root>/.codegraph/
 */

import fs from 'node:fs'
import path from 'node:path'
import { runBash } from './shellBridge'
import {
  executableLookupCommand,
  firstExecutablePath,
  quoteShellArg,
} from './platformProcess'

export type CodegraphStatus = {
  installed: boolean
  binaryPath: string | null
  projectRoot: string
  indexed: boolean
  indexPath: string | null
  version: string | null
  raw: string
  error?: string
}

export type CodegraphCmdResult = {
  ok: boolean
  projectRoot: string
  query: string
  output: string
  /** Parsed JSON if -j returned valid JSON */
  json?: unknown
  error?: string
  command: string
}

/** Cached capability probe: whether this binary has the `explore` subcommand (1.x+). */
let exploreSupported: boolean | null = null
let exploreProbeBin: string | null = null

async function whichCodegraph(): Promise<string | null> {
  const r = await runBash({
    command: executableLookupCommand('codegraph'),
    timeoutMs: 5000,
    tag: 'codegraph',
  })
  const p = firstExecutablePath(r.stdout)
  return r.ok && p ? p : null
}

function tryParseJson(text: string): unknown | undefined {
  const t = text.trim()
  if (!t) return undefined
  // whole stdout
  try {
    return JSON.parse(t)
  } catch {
    /* fall through */
  }
  // first { or [ block
  const start = Math.min(
    ...[t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0),
  )
  if (!Number.isFinite(start) || start < 0) return undefined
  const slice = t.slice(start)
  try {
    return JSON.parse(slice)
  } catch {
    return undefined
  }
}

function combinedOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join('\n')
}

function isUnknownCommand(text: string, cmd: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes(`unknown command '${cmd}'`) ||
    t.includes(`unknown command "${cmd}"`) ||
    t.includes(`error: unknown command '${cmd}'`) ||
    (t.includes('unknown command') && t.includes(cmd))
  )
}

function isUnknownOption(text: string, opt = '-p'): boolean {
  const t = text.toLowerCase()
  return t.includes(`unknown option '${opt}'`) || t.includes(`unknown option "${opt}"`)
}

/**
 * Probe once whether `codegraph explore` exists (1.x).
 * Older 0.9.x only has query/callers/impact/… and rejects -p on status/init/sync.
 */
async function supportsExplore(bin: string): Promise<boolean> {
  if (exploreSupported != null && exploreProbeBin === bin) return exploreSupported
  const r = await runBash({
    command: `${quoteShellArg(bin)} help`,
    timeoutMs: 8000,
    tag: 'codegraph',
  })
  const help = combinedOutput(r.stdout, r.stderr)
  // help lists subcommands; also try `explore --help` if help is sparse
  let ok = /\bexplore\b/i.test(help)
  if (!ok) {
    const e = await runBash({
      command: `${quoteShellArg(bin)} explore --help`,
      timeoutMs: 8000,
      tag: 'codegraph',
    })
    const out = combinedOutput(e.stdout, e.stderr)
    ok = e.ok || (!isUnknownCommand(out, 'explore') && /Usage:|Options:/i.test(out))
  }
  exploreSupported = ok
  exploreProbeBin = bin
  return ok
}

export async function codegraphDetect(): Promise<{
  installed: boolean
  binaryPath: string | null
  version: string | null
}> {
  const binaryPath = await whichCodegraph()
  if (!binaryPath) {
    return { installed: false, binaryPath: null, version: null }
  }
  // Avoid POSIX redirects/fallback syntax: this command also runs under cmd.exe.
  let v = await runBash({
    command: `${quoteShellArg(binaryPath)} --version`,
    timeoutMs: 8000,
    tag: 'codegraph',
  })
  if (!v.ok) {
    v = await runBash({
      command: `${quoteShellArg(binaryPath)} version`,
      timeoutMs: 8000,
      tag: 'codegraph',
    })
  }
  const version = v.stdout.trim().split(/\r?\n/)[0] || null
  return { installed: true, binaryPath, version }
}

export async function codegraphStatus(projectRoot: string): Promise<CodegraphStatus> {
  const root = (projectRoot || '').trim()
  const indexPath = root ? path.join(root, '.codegraph') : null
  const indexedOnDisk = Boolean(indexPath && fs.existsSync(indexPath))

  const det = await codegraphDetect()
  if (!det.installed || !det.binaryPath) {
    return {
      installed: false,
      binaryPath: null,
      projectRoot: root,
      indexed: indexedOnDisk,
      indexPath: indexedOnDisk ? indexPath : null,
      version: null,
      raw: '',
      error:
        '未安裝 codegraph CLI。https://github.com/colbymchenry/codegraph — npm i -g @colbymchenry/codegraph',
    }
  }

  if (!root || !fs.existsSync(root)) {
    return {
      installed: true,
      binaryPath: det.binaryPath,
      projectRoot: root,
      indexed: false,
      indexPath: null,
      version: det.version,
      raw: '',
      error: '請先選擇專案目錄',
    }
  }

  // 0.9.x / 1.x: `status [path]` — never `-p` (status rejects it on 0.9).
  const r = await runBash({
    command: `${quoteShellArg(det.binaryPath)} status ${quoteShellArg(root)}`,
    cwd: root,
    timeoutMs: 30_000,
    tag: 'codegraph',
  })
  const raw = combinedOutput(r.stdout, r.stderr).slice(0, 12_000)
  const notInit = /not initialized|Not initialized/i.test(raw)
  const indexed = !notInit && (indexedOnDisk || r.ok)

  return {
    installed: true,
    binaryPath: det.binaryPath,
    projectRoot: root,
    indexed,
    indexPath: fs.existsSync(path.join(root, '.codegraph'))
      ? path.join(root, '.codegraph')
      : null,
    version: det.version,
    raw,
    error: notInit
      ? '專案尚未 codegraph init'
      : r.ok
        ? undefined
        : r.stderr || `exit ${r.code}`,
  }
}

export async function codegraphInit(projectRoot: string): Promise<{
  ok: boolean
  output: string
  error?: string
}> {
  const root = (projectRoot || '').trim()
  if (!root || !fs.existsSync(root)) {
    return { ok: false, output: '', error: '無效專案路徑' }
  }
  const det = await codegraphDetect()
  if (!det.binaryPath) return { ok: false, output: '', error: 'codegraph 未安裝' }

  // 0.9.x / 1.x: `init [path]` — never `-p`.
  const r = await runBash({
    command: `${quoteShellArg(det.binaryPath)} init ${quoteShellArg(root)}`,
    cwd: root,
    timeoutMs: 600_000,
    tag: 'codegraph',
  })
  const output = combinedOutput(r.stdout, r.stderr).slice(0, 20_000)
  return {
    ok: r.ok || fs.existsSync(path.join(root, '.codegraph')),
    output,
    error: r.ok ? undefined : r.stderr || `exit ${r.code}`,
  }
}

export async function codegraphSync(projectRoot: string): Promise<{
  ok: boolean
  output: string
  error?: string
}> {
  const root = (projectRoot || '').trim()
  if (!root || !fs.existsSync(root)) {
    return { ok: false, output: '', error: '無效專案路徑' }
  }
  const det = await codegraphDetect()
  if (!det.binaryPath) return { ok: false, output: '', error: 'codegraph 未安裝' }

  // 0.9.x / 1.x: `sync [path]` — never `-p`.
  const r = await runBash({
    command: `${quoteShellArg(det.binaryPath)} sync ${quoteShellArg(root)}`,
    cwd: root,
    timeoutMs: 300_000,
    tag: 'codegraph',
  })
  const output = combinedOutput(r.stdout, r.stderr).slice(0, 20_000)
  return {
    ok: r.ok,
    output,
    error: r.ok ? undefined : r.stderr || `exit ${r.code}`,
  }
}

async function requireBinAndRoot(
  projectRoot: string,
): Promise<{ ok: true; bin: string; root: string } | { ok: false; error: string }> {
  const root = (projectRoot || '').trim()
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: '無效專案路徑 — 請先選擇專案' }
  }
  const det = await codegraphDetect()
  if (!det.binaryPath) {
    return {
      ok: false,
      error: 'codegraph 未安裝。npm i -g @colbymchenry/codegraph',
    }
  }
  if (!fs.existsSync(path.join(root, '.codegraph'))) {
    return {
      ok: false,
      error: '專案尚未索引。請執行 codegraph init（知識圖譜頁「建立索引」）',
    }
  }
  return { ok: true, bin: det.binaryPath, root }
}

async function runCmd(
  bin: string,
  root: string,
  args: string,
  query: string,
  timeoutMs = 120_000,
): Promise<CodegraphCmdResult> {
  const command = `${quoteShellArg(bin)} ${args}`
  const r = await runBash({
    command,
    cwd: root,
    timeoutMs,
    tag: 'codegraph',
  })
  const output = combinedOutput(r.stdout, r.stderr).trim()
  const json = tryParseJson(r.stdout || '')
  return {
    ok: r.ok && Boolean(output || json),
    projectRoot: root,
    query,
    output: (output || (json ? JSON.stringify(json, null, 2) : '')).slice(0, 80_000),
    json,
    error: r.ok ? undefined : r.stderr || `exit ${r.code}`,
    command,
  }
}

/**
 * Build query-like args. Prefer `-p` (0.9+ query/callers/impact), but if the binary
 * rejects it, retry with cwd-only (1.x often resolves via cwd).
 */
async function runWithOptionalPathFlag(
  bin: string,
  root: string,
  subcmd: string,
  rest: string,
  query: string,
  timeoutMs = 120_000,
): Promise<CodegraphCmdResult> {
  const withPath = await runCmd(
    bin,
    root,
    `${subcmd} -p ${quoteShellArg(root)} ${rest}`.trim(),
    query,
    timeoutMs,
  )
  if (withPath.ok || !isUnknownOption(withPath.error || withPath.output || '', '-p')) {
    return withPath
  }
  // Fallback: no -p, rely on cwd (and some CLIs take path as trailing positional)
  return runCmd(bin, root, `${subcmd} ${rest}`.trim(), query, timeoutMs)
}

export async function codegraphExplore(
  projectRoot: string,
  query: string,
  opts?: { maxFiles?: number },
): Promise<CodegraphCmdResult> {
  const q = (query || '').trim()
  if (!q) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: '',
      output: '',
      error: 'query 不可為空',
      command: '',
    }
  }
  const pre = await requireBinAndRoot(projectRoot)
  if (!pre.ok) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: q,
      output: '',
      error: pre.error,
      command: '',
    }
  }

  const hasExplore = await supportsExplore(pre.bin)
  if (hasExplore) {
    // 1.x: `explore <query>` — project via cwd; optional flags when present.
    // Do NOT pass `-p` (rejected on some builds / confuses global parser).
    const max =
      opts?.maxFiles && opts.maxFiles > 0
        ? ` --max-files ${Math.min(40, opts.maxFiles)}`
        : ''
    const primary = await runCmd(
      pre.bin,
      pre.root,
      `explore${max} ${quoteShellArg(q)}`,
      q,
    )
    if (primary.ok || !isUnknownCommand(primary.error || primary.output || '', 'explore')) {
      // If max-files unknown, retry without it
      if (
        !primary.ok &&
        /unknown option|unrecognized/i.test(primary.error || primary.output || '') &&
        max
      ) {
        return runCmd(pre.bin, pre.root, `explore ${quoteShellArg(q)}`, q)
      }
      return primary
    }
    // Probe was stale — fall through to query
    exploreSupported = false
  }

  // 0.9.x fallback: symbol search via `query`
  return runWithOptionalPathFlag(
    pre.bin,
    pre.root,
    'query',
    `-j -l 20 ${quoteShellArg(q)}`,
    q,
  )
}

export async function codegraphQuery(
  projectRoot: string,
  search: string,
  opts?: { kind?: string; limit?: number; json?: boolean },
): Promise<CodegraphCmdResult> {
  const q = (search || '').trim()
  const pre = await requireBinAndRoot(projectRoot)
  if (!pre.ok || !q) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: q,
      output: '',
      error: !pre.ok ? pre.error : 'search 不可為空',
      command: '',
    }
  }
  const kind = opts?.kind ? `-k ${quoteShellArg(opts.kind)} ` : ''
  const limit = `-l ${opts?.limit && opts.limit > 0 ? Math.min(50, opts.limit) : 15}`
  const json = opts?.json === false ? '' : ' -j'
  return runWithOptionalPathFlag(
    pre.bin,
    pre.root,
    'query',
    `${kind}${limit}${json} ${quoteShellArg(q)}`.trim(),
    q,
  )
}

export async function codegraphCallers(
  projectRoot: string,
  symbol: string,
  opts?: { limit?: number; json?: boolean },
): Promise<CodegraphCmdResult> {
  const q = (symbol || '').trim()
  const pre = await requireBinAndRoot(projectRoot)
  if (!pre.ok || !q) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: q,
      output: '',
      error: !pre.ok ? pre.error : 'symbol 不可為空',
      command: '',
    }
  }
  const limit = `-l ${opts?.limit && opts.limit > 0 ? Math.min(50, opts.limit) : 20}`
  const json = opts?.json === false ? '' : ' -j'
  return runWithOptionalPathFlag(
    pre.bin,
    pre.root,
    'callers',
    `${limit}${json} ${quoteShellArg(q)}`.trim(),
    q,
  )
}

export async function codegraphCallees(
  projectRoot: string,
  symbol: string,
  opts?: { limit?: number; json?: boolean },
): Promise<CodegraphCmdResult> {
  const q = (symbol || '').trim()
  const pre = await requireBinAndRoot(projectRoot)
  if (!pre.ok || !q) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: q,
      output: '',
      error: !pre.ok ? pre.error : 'symbol 不可為空',
      command: '',
    }
  }
  const limit = `-l ${opts?.limit && opts.limit > 0 ? Math.min(50, opts.limit) : 20}`
  const json = opts?.json === false ? '' : ' -j'
  return runWithOptionalPathFlag(
    pre.bin,
    pre.root,
    'callees',
    `${limit}${json} ${quoteShellArg(q)}`.trim(),
    q,
  )
}

export async function codegraphImpact(
  projectRoot: string,
  symbol: string,
  opts?: { depth?: number; json?: boolean },
): Promise<CodegraphCmdResult> {
  const q = (symbol || '').trim()
  const pre = await requireBinAndRoot(projectRoot)
  if (!pre.ok || !q) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: q,
      output: '',
      error: !pre.ok ? pre.error : 'symbol 不可為空',
      command: '',
    }
  }
  const depth = `-d ${opts?.depth && opts.depth > 0 ? Math.min(8, opts.depth) : 2}`
  const json = opts?.json === false ? '' : ' -j'
  return runWithOptionalPathFlag(
    pre.bin,
    pre.root,
    'impact',
    `${depth}${json} ${quoteShellArg(q)}`.trim(),
    q,
  )
}

export async function codegraphNode(
  projectRoot: string,
  name: string,
  opts?: { file?: string },
): Promise<CodegraphCmdResult> {
  const q = (name || '').trim()
  const pre = await requireBinAndRoot(projectRoot)
  if (!pre.ok || !q) {
    return {
      ok: false,
      projectRoot: projectRoot || '',
      query: q,
      output: '',
      error: !pre.ok ? pre.error : 'name 不可為空',
      command: '',
    }
  }

  // 1.x: `node <symbol|file>`; 0.9.x: fall back to query
  const file = opts?.file ? `-f ${quoteShellArg(opts.file)} ` : ''
  const primary = await runCmd(
    pre.bin,
    pre.root,
    `node ${file}${quoteShellArg(q)}`.trim(),
    q,
  )
  if (primary.ok || !isUnknownCommand(primary.error || primary.output || '', 'node')) {
    // If -f unknown, retry without file filter
    if (
      !primary.ok &&
      file &&
      isUnknownOption(primary.error || primary.output || '', '-f')
    ) {
      return runCmd(pre.bin, pre.root, `node ${quoteShellArg(q)}`, q)
    }
    return primary
  }

  return runWithOptionalPathFlag(
    pre.bin,
    pre.root,
    'query',
    `-j -l 15 ${quoteShellArg(q)}`,
    q,
  )
}
