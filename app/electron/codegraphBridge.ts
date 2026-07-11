/**
 * CodeGraph CLI bridge — https://github.com/colbymchenry/codegraph
 *
 * Uses local `codegraph` binary (v1.x flags: -p/--path, -j/--json).
 * Project index: <root>/.codegraph/
 */

import fs from 'node:fs'
import path from 'node:path'
import { runBash } from './shellBridge'

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

function shellQuote(s: string): string {
  if (process.platform === 'win32') {
    return `"${s
      .replace(/%/g, '%%')
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\*)$/g, '$1$1')}"`
  }
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function whichCodegraph(): Promise<string | null> {
  const r = await runBash({
    command:
      process.platform === 'win32' ? 'where codegraph' : 'command -v codegraph',
    timeoutMs: 5000,
    tag: 'codegraph',
  })
  const p = r.stdout.trim().split(/\r?\n/)[0] || null
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
    command: `${shellQuote(binaryPath)} --version`,
    timeoutMs: 8000,
    tag: 'codegraph',
  })
  if (!v.ok) {
    v = await runBash({
      command: `${shellQuote(binaryPath)} version`,
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
  const indexed = Boolean(indexPath && fs.existsSync(indexPath))

  const det = await codegraphDetect()
  if (!det.installed || !det.binaryPath) {
    return {
      installed: false,
      binaryPath: null,
      projectRoot: root,
      indexed,
      indexPath: indexed ? indexPath : null,
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

  const r = await runBash({
    command: `${shellQuote(det.binaryPath)} status -p ${shellQuote(root)}`,
    cwd: root,
    timeoutMs: 30_000,
    tag: 'codegraph',
  })
  const raw = [r.stdout, r.stderr].filter(Boolean).join('\n').slice(0, 12_000)
  const notInit = /not initialized|Not initialized/i.test(raw)

  return {
    installed: true,
    binaryPath: det.binaryPath,
    projectRoot: root,
    indexed: !notInit && (indexed || r.ok),
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

  const r = await runBash({
    command: `${shellQuote(det.binaryPath)} init -p ${shellQuote(root)}`,
    cwd: root,
    timeoutMs: 600_000,
    tag: 'codegraph',
  })
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n').slice(0, 20_000)
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

  const r = await runBash({
    command: `${shellQuote(det.binaryPath)} sync -p ${shellQuote(root)}`,
    cwd: root,
    timeoutMs: 300_000,
    tag: 'codegraph',
  })
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n').slice(0, 20_000)
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
  const command = `${shellQuote(bin)} ${args}`
  const r = await runBash({
    command,
    cwd: root,
    timeoutMs,
    tag: 'codegraph',
  })
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n\n').trim()
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
  const max =
    opts?.maxFiles && opts.maxFiles > 0
      ? ` --max-files ${Math.min(40, opts.maxFiles)}`
      : ''
  return runCmd(
    pre.bin,
    pre.root,
    `explore -p ${shellQuote(pre.root)}${max} ${shellQuote(q)}`,
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
  const kind = opts?.kind ? ` -k ${shellQuote(opts.kind)}` : ''
  const limit = ` -l ${opts?.limit && opts.limit > 0 ? Math.min(50, opts.limit) : 15}`
  const json = opts?.json === false ? '' : ' -j'
  return runCmd(
    pre.bin,
    pre.root,
    `query -p ${shellQuote(pre.root)}${kind}${limit}${json} ${shellQuote(q)}`,
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
  const limit = ` -l ${opts?.limit && opts.limit > 0 ? Math.min(50, opts.limit) : 20}`
  const json = opts?.json === false ? '' : ' -j'
  return runCmd(
    pre.bin,
    pre.root,
    `callers -p ${shellQuote(pre.root)}${limit}${json} ${shellQuote(q)}`,
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
  const limit = ` -l ${opts?.limit && opts.limit > 0 ? Math.min(50, opts.limit) : 20}`
  const json = opts?.json === false ? '' : ' -j'
  return runCmd(
    pre.bin,
    pre.root,
    `callees -p ${shellQuote(pre.root)}${limit}${json} ${shellQuote(q)}`,
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
  const depth = ` -d ${opts?.depth && opts.depth > 0 ? Math.min(8, opts.depth) : 2}`
  const json = opts?.json === false ? '' : ' -j'
  return runCmd(
    pre.bin,
    pre.root,
    `impact -p ${shellQuote(pre.root)}${depth}${json} ${shellQuote(q)}`,
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
  const file = opts?.file ? ` -f ${shellQuote(opts.file)}` : ''
  return runCmd(
    pre.bin,
    pre.root,
    `node -p ${shellQuote(pre.root)}${file} ${shellQuote(q)}`,
    q,
  )
}
