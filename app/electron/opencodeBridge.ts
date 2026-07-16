/**
 * OpenCode interop:
 * - Merge opencode.json / jsonc (global + project)
 * - Scan agents/*.md, commands/*.md
 * - Detect / invoke opencode CLI
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { runBash } from './shellBridge'
import {
  executableLookupCommand,
  firstExecutablePath,
  isWindows,
  quoteShellArg,
} from './platformProcess'

export type OpenCodeAgentFile = {
  id: string
  name: string
  path: string
  mode?: string
  description?: string
  model?: string
  temperature?: number
  steps?: number
  hidden?: boolean
  color?: string
  body: string
  permission?: Record<string, unknown>
  frontmatter: Record<string, unknown>
  source: 'global' | 'project'
}

export type OpenCodeCommandFile = {
  id: string
  name: string
  path: string
  description?: string
  template: string
  agent?: string
  model?: string
  source: 'global' | 'project'
}

/** App-owned OpenCode-format storage, under Electron's userData (not the external opencode CLI's ~/.config/opencode). */
function openCodeUserDataDir(): string {
  return path.join(app.getPath('userData'), 'opencode')
}

function stripJsonc(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf-8')
    return JSON.parse(stripJsonc(raw)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Minimal YAML-ish frontmatter (supports nested indent for permission) */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: raw }
  const lines = m[1].split(/\r?\n/)
  const data: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }
    const indent = line.match(/^(\s*)/)?.[1].length || 0
    if (indent > 0) {
      i++
      continue
    }
    const idx = line.indexOf(':')
    if (idx < 0) {
      i++
      continue
    }
    const key = line.slice(0, idx).trim()
    let valStr = line.slice(idx + 1).trim()
    if (!valStr) {
      // nested object
      const obj: Record<string, unknown> = {}
      i++
      while (i < lines.length) {
        const l2 = lines[i]
        const ind2 = l2.match(/^(\s*)/)?.[1].length || 0
        if (!l2.trim()) {
          i++
          continue
        }
        if (ind2 === 0) break
        const t = l2.trim()
        const j = t.indexOf(':')
        if (j < 0) {
          i++
          continue
        }
        const k2 = t.slice(0, j).trim().replace(/^["']|["']$/g, '')
        let v2: unknown = t.slice(j + 1).trim()
        if (v2 === '') {
          // deeper nest (bash patterns)
          const inner: Record<string, string> = {}
          i++
          while (i < lines.length) {
            const l3 = lines[i]
            const ind3 = l3.match(/^(\s*)/)?.[1].length || 0
            if (!l3.trim() || ind3 <= ind2) break
            const t3 = l3.trim()
            const j3 = t3.indexOf(':')
            if (j3 < 0) {
              i++
              continue
            }
            const k3 = t3.slice(0, j3).trim().replace(/^["']|["']$/g, '')
            let v3 = t3.slice(j3 + 1).trim()
            if (typeof v3 === 'string' && /^["'].*["']$/.test(v3)) v3 = v3.slice(1, -1)
            inner[k3] = v3
            i++
          }
          obj[k2] = inner
          continue
        }
        if (v2 === 'true') v2 = true
        else if (v2 === 'false') v2 = false
        else if (typeof v2 === 'string' && /^["'].*["']$/.test(v2)) v2 = v2.slice(1, -1)
        obj[k2] = v2
        i++
      }
      data[key] = obj
      continue
    }
    let val: unknown = valStr
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (typeof val === 'string' && /^["'].*["']$/.test(val)) val = val.slice(1, -1)
    else if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) val = Number(val)
    data[key] = val
    i++
  }
  return { data, body: m[2] || '' }
}

function scanAgentDir(dir: string, source: 'global' | 'project'): OpenCodeAgentFile[] {
  if (!fs.existsSync(dir)) return []
  const out: OpenCodeAgentFile[] = []
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  for (const f of files) {
    const full = path.join(dir, f)
    try {
      const raw = fs.readFileSync(full, 'utf-8')
      const { data, body } = parseFrontmatter(raw)
      const name = f.replace(/\.md$/, '')
      out.push({
        id: name,
        name: String(data.name || name),
        path: full,
        mode: data.mode != null ? String(data.mode) : undefined,
        description: data.description != null ? String(data.description) : undefined,
        model: data.model != null ? String(data.model) : undefined,
        temperature:
          typeof data.temperature === 'number'
            ? data.temperature
            : data.temperature != null
              ? Number(data.temperature)
              : undefined,
        steps:
          typeof data.steps === 'number'
            ? data.steps
            : data.maxSteps != null
              ? Number(data.maxSteps)
              : undefined,
        hidden: data.hidden === true,
        color: data.color != null ? String(data.color) : undefined,
        body: body.trim(),
        permission:
          data.permission && typeof data.permission === 'object'
            ? (data.permission as Record<string, unknown>)
            : undefined,
        frontmatter: data,
        source,
      })
    } catch {
      /* skip */
    }
  }
  return out
}

function scanCommandDir(dir: string, source: 'global' | 'project'): OpenCodeCommandFile[] {
  if (!fs.existsSync(dir)) return []
  const out: OpenCodeCommandFile[] = []
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  for (const f of files) {
    const full = path.join(dir, f)
    try {
      const raw = fs.readFileSync(full, 'utf-8')
      const { data, body } = parseFrontmatter(raw)
      const name = f.replace(/\.md$/, '')
      out.push({
        id: name,
        name: String(data.name || name),
        path: full,
        description: data.description != null ? String(data.description) : undefined,
        template: body.trim() || String(data.template || ''),
        agent: data.agent != null ? String(data.agent) : undefined,
        model: data.model != null ? String(data.model) : undefined,
        source,
      })
    } catch {
      /* skip */
    }
  }
  return out
}

export function scanOpenCodeAgents(projectRoot?: string): {
  global: OpenCodeAgentFile[]
  project: OpenCodeAgentFile[]
  dirs: string[]
  configHint?: string | null
} {
  const userDataDir = openCodeUserDataDir()
  const globalDirs = [path.join(userDataDir, 'agents')]
  const projectDirs = projectRoot
    ? [
        path.join(projectRoot, '.opencode', 'agents'),
        path.join(projectRoot, 'opencode', 'agents'),
      ]
    : []

  const global = globalDirs.flatMap((d) => scanAgentDir(d, 'global'))
  const project = projectDirs.flatMap((d) => scanAgentDir(d, 'project'))

  let configHint: string | null = null
  for (const cfg of [
    path.join(userDataDir, 'opencode.json'),
    path.join(userDataDir, 'opencode.jsonc'),
  ]) {
    if (fs.existsSync(cfg)) {
      configHint = cfg
      break
    }
  }

  return {
    global,
    project,
    dirs: [...globalDirs, ...projectDirs],
    configHint,
  }
}

export function loadOpenCodeBundle(projectRoot?: string): {
  layers: Array<{ path: string; data: Record<string, unknown> }>
  agents: OpenCodeAgentFile[]
  commands: OpenCodeCommandFile[]
  sources: string[]
} {
  const userDataDir = openCodeUserDataDir()
  const root = (projectRoot || '').trim()
  const layerPaths = [
    path.join(userDataDir, 'opencode.json'),
    path.join(userDataDir, 'opencode.jsonc'),
  ]
  if (root) {
    layerPaths.push(
      path.join(root, 'opencode.json'),
      path.join(root, 'opencode.jsonc'),
      path.join(root, '.opencode', 'opencode.json'),
      path.join(root, '.opencode', 'opencode.jsonc'),
    )
  }

  const layers: Array<{ path: string; data: Record<string, unknown> }> = []
  const sources: string[] = []
  for (const p of layerPaths) {
    const data = readJsonFile(p)
    if (data) {
      layers.push({ path: p, data })
      sources.push(p)
    }
  }

  const agentScan = scanOpenCodeAgents(root || undefined)
  const agents = [...agentScan.global, ...agentScan.project]

  const cmdDirsGlobal = [path.join(userDataDir, 'commands')]
  const cmdDirsProject = root
    ? [path.join(root, '.opencode', 'commands'), path.join(root, 'opencode', 'commands')]
    : []
  const commands = [
    ...cmdDirsGlobal.flatMap((d) => scanCommandDir(d, 'global')),
    ...cmdDirsProject.flatMap((d) => scanCommandDir(d, 'project')),
  ]

  return { layers, agents, commands, sources }
}

export type ResolvedOpenCodeInstruction = {
  entry: string
  path?: string
  text: string
  bytes: number
  sha256: string
}

function pathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function walkFiles(root: string, dir = root, out: string[] = []): string[] {
  if (out.length >= 2000) return out
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git' || name === '.subagents') continue
    const full = path.join(dir, name)
    try {
      const stat = fs.statSync(full)
      if (stat.isDirectory()) walkFiles(root, full, out)
      else if (stat.isFile()) out.push(full)
    } catch {
      /* skip inaccessible paths */
    }
  }
  return out
}

/** Resolve OpenCode instruction paths/globs under projectRoot only. */
export function resolveOpenCodeInstructions(
  projectRoot: string,
  entries: string[] | undefined,
): ResolvedOpenCodeInstruction[] {
  const root = path.resolve(projectRoot || process.cwd())
  const files = walkFiles(root)
  const out: ResolvedOpenCodeInstruction[] = []
  for (const raw of entries || []) {
    const entry = String(raw || '').trim()
    if (!entry) continue
    const fileEntry = /^\{file:(.+)\}$/i.exec(entry)?.[1]?.trim() || entry
    const normalized = fileEntry.replace(/^[./\\]+/, '').replace(/\\/g, '/')
    const candidates = normalized.includes('*')
      ? files.filter((full) => globRegex(normalized).test(path.relative(root, full).replace(/\\/g, '/')))
      : [path.resolve(root, fileEntry)]
    let matched = false
    for (const candidate of candidates.slice(0, 50)) {
      if (!pathInsideRoot(root, candidate)) continue
      try {
        const stat = fs.statSync(candidate)
        if (!stat.isFile() || stat.size > 200_000) continue
        const text = fs.readFileSync(candidate, 'utf8')
        out.push({
          entry,
          path: candidate,
          text,
          bytes: Buffer.byteLength(text, 'utf8'),
          sha256: crypto.createHash('sha256').update(text).digest('hex'),
        })
        matched = true
      } catch {
        /* treat missing entries as inline text below */
      }
    }
    if (!matched && !normalized.includes('*') && !path.extname(normalized)) {
      out.push({
        entry,
        text: entry.slice(0, 20_000),
        bytes: Buffer.byteLength(entry, 'utf8'),
        sha256: crypto.createHash('sha256').update(entry).digest('hex'),
      })
    }
  }
  return out.slice(0, 100)
}

export async function detectOpenCodeCli(): Promise<{
  found: boolean
  path: string | null
  version: string | null
}> {
  const candidates =
    isWindows
      ? ['opencode.cmd', 'opencode.exe', 'opencode']
      : ['opencode']

  for (const bin of candidates) {
    const r = await runBash({
      command: executableLookupCommand(bin),
      timeoutMs: 5000,
    })
    if (r.ok && r.stdout.trim()) {
      const p = firstExecutablePath(r.stdout)
      if (!p) continue
      const ver = await runBash({ command: `${quoteShellArg(p)} --version`, timeoutMs: 8000 })
      return {
        found: true,
        path: p,
        version: ver.stdout.trim() || ver.stderr.trim() || null,
      }
    }
  }
  return { found: false, path: null, version: null }
}

export async function runOpenCodePrompt(input: {
  prompt: string
  cwd?: string
  timeoutMs?: number
}): Promise<{ ok: boolean; output: string; error?: string }> {
  const det = await detectOpenCodeCli()
  if (!det.found || !det.path) {
    return { ok: false, output: '', error: 'opencode CLI 未安裝或不在 PATH' }
  }
  const prompt = input.prompt.slice(0, 4000)
  const binary = quoteShellArg(det.path)
  let r = await runBash({
    command: `${binary} run ${quoteShellArg(prompt)}`,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs || 120_000,
  })
  if (!r.ok) {
    r = await runBash({
      command: `${binary} ${quoteShellArg(prompt)}`,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs || 120_000,
    })
  }
  const output = (r.stdout || r.stderr || '').slice(0, 50_000)
  return {
    ok: r.ok,
    output: output || '(empty)',
    error: r.ok ? undefined : r.stderr || `exit ${r.code}`,
  }
}

export function spawnOpenCodeInteractive(_opts: { cwd?: string }): {
  ok: boolean
  message: string
} {
  return {
    ok: false,
    message:
      '互動式 opencode TUI 請在系統終端執行 `opencode`。本 App 支援 agents/*.md 掃描、opencode.json 合併與一次性 CLI 呼叫。',
  }
}
