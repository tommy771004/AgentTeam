/**
 * Auto-discover local coding CLIs and import model lists from their config caches.
 * Does NOT copy OAuth tokens / API secrets into the renderer.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { runBash } from './shellBridge'
import { scanOpenCodeAgents } from './opencodeBridge'
import { executableLookupCommand, firstExecutablePath } from './platformProcess'

export type DiscoveredModel = {
  id: string
  label: string
  /** Mapped to app thinking depths */
  depths: Array<'fast' | 'standard' | 'deep' | 'max' | 'ultra'>
  rawEfforts?: string[]
}

export type DiscoveredCli = {
  id: string
  kind: string
  name: string
  foundBinary: boolean
  binaryPath: string | null
  configPaths: string[]
  hasAuth: boolean
  authNote: string
  models: DiscoveredModel[]
  defaultModel?: string
  defaultDepth?: string
  notes: string[]
}

const ALL: DiscoveredModel['depths'] = ['fast', 'standard', 'deep', 'max', 'ultra']

function home(...parts: string[]) {
  return path.join(os.homedir(), ...parts)
}

function exists(p: string) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function readJson(p: string): unknown {
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    // strip JSONC comments loosely
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    return JSON.parse(stripped)
  } catch {
    return null
  }
}

function mapEffort(effort: string): DiscoveredModel['depths'][number] | null {
  const e = effort.toLowerCase()
  if (e === 'low' || e === 'minimal' || e === 'xlow' || e === 'fast') return 'fast'
  if (e === 'medium' || e === 'mid' || e === 'default' || e === 'normal') return 'standard'
  if (e === 'high') return 'deep'
  if (e === 'xhigh' || e === 'extra_high' || e === 'extra-high') return 'max'
  if (e === 'max' || e === 'ultra' || e === 'maximum') return 'ultra'
  return null
}

function depthsFromEfforts(levels: Array<{ effort?: string } | string>): DiscoveredModel['depths'] {
  const out = new Set<DiscoveredModel['depths'][number]>()
  for (const l of levels) {
    const effort = typeof l === 'string' ? l : l.effort || ''
    const m = mapEffort(effort)
    if (m) out.add(m)
  }
  return out.size ? [...out] : ALL
}

async function which(bin: string): Promise<string | null> {
  // also check common user bins (Windows + Unix)
  const candidates = [
    bin,
    home('.grok', 'bin', bin),
    home('.local', 'bin', bin),
    home('.npm-global', 'bin', bin),
    // OpenAI Codex real binary (PATH often has wrong npm "codex" blog package)
    home('.codex', '.sandbox-bin', bin),
    home('.codex', 'plugins', '.plugin-appserver', bin),
    home('.opencode', 'bin', bin),
    home('.cursor', 'bin', bin),
    `/usr/local/bin/${bin}`,
    `/opt/homebrew/bin/${bin}`,
  ]
  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      // try bare name and .exe on Windows
      const tries = process.platform === 'win32' && !c.endsWith('.exe') ? [c, `${c}.exe`] : [c]
      for (const t of tries) {
        try {
          if (exists(t) && fs.statSync(t).isFile()) return t
        } catch {
          /* ignore */
        }
      }
    }
  }
  const r = await runBash({
    command: executableLookupCommand(bin),
    timeoutMs: 4000,
  })
  const p = firstExecutablePath(r.stdout)
  return r.ok && p ? p : null
}

/** Prefer OpenAI Codex over unrelated npm packages named "codex". */
async function whichCodex(): Promise<string | null> {
  const preferred = [
    home('.codex', '.sandbox-bin', 'codex.exe'),
    home('.codex', '.sandbox-bin', 'codex'),
    home('.codex', 'plugins', '.plugin-appserver', 'codex.exe'),
    home('.codex', 'plugins', '.plugin-appserver', 'codex'),
    home('.local', 'bin', 'codex'),
    home('.local', 'bin', 'codex.exe'),
  ]
  for (const p of preferred) {
    if (exists(p)) {
      try {
        if (fs.statSync(p).isFile()) return p
      } catch {
        /* ignore */
      }
    }
  }
  const fromPath = await which('codex')
  if (!fromPath) return null
  // Reject known wrong package: old "codex-cli" blog generator
  const lower = fromPath.toLowerCase()
  if (lower.includes('node_modules') && lower.includes('codex-cli')) {
    return null
  }
  return fromPath
}

/** Cursor Agent CLI only — never the Cursor IDE `cursor` binary. */
async function whichCursorAgent(): Promise<string | null> {
  return (
    (await which('cursor-agent')) ||
    (await which('agent')) ||
    null
  )
}

function parseCodexModels(): { models: DiscoveredModel[]; defaultModel?: string; defaultDepth?: string } {
  const cache = home('.codex', 'models_cache.json')
  const config = home('.codex', 'config.toml')
  const models: DiscoveredModel[] = []
  if (exists(cache)) {
    const data = readJson(cache) as {
      models?: Array<{
        slug?: string
        display_name?: string
        supported_reasoning_levels?: Array<{ effort?: string }>
      }>
    } | null
    for (const m of data?.models || []) {
      if (!m.slug) continue
      models.push({
        id: m.slug,
        label: m.display_name || m.slug,
        depths: depthsFromEfforts(m.supported_reasoning_levels || []),
        rawEfforts: (m.supported_reasoning_levels || []).map((x) => x.effort || '').filter(Boolean),
      })
    }
  }
  let defaultModel: string | undefined
  let defaultDepth: string | undefined
  if (exists(config)) {
    try {
      const toml = fs.readFileSync(config, 'utf-8')
      const mm = toml.match(/^\s*model\s*=\s*"([^"]+)"/m)
      const dd = toml.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)
      if (mm) defaultModel = mm[1]
      if (dd) defaultDepth = mapEffort(dd[1]) || dd[1]
    } catch {
      /* ignore */
    }
  }
  return { models, defaultModel, defaultDepth }
}

function parseGrokModels(): DiscoveredModel[] {
  const cache = home('.grok', 'models_cache.json')
  if (!exists(cache)) return []
  const data = readJson(cache) as { models?: Record<string, unknown> } | null
  const models: DiscoveredModel[] = []
  const map = data?.models
  if (!map || typeof map !== 'object') return []
  for (const id of Object.keys(map)) {
    models.push({
      id,
      label: id,
      depths: ALL,
    })
  }
  return models
}

/** Pretty label for Claude model ids / aliases */
function claudeModelLabel(id: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim()
  const aliases: Record<string, string> = {
    sonnet: 'Sonnet (latest)',
    opus: 'Opus (latest)',
    haiku: 'Haiku (latest)',
    fable: 'Fable (latest)',
    best: 'Best available',
  }
  if (aliases[id]) return aliases[id]
  // claude-opus-4-8 → Opus 4.8 · claude-fable-5[1m] → Fable 5 (1M)
  let s = id.replace(/^claude-/, '')
  const ctx1m = /\[1m\]/i.test(s)
  s = s.replace(/\[1m\]/gi, '')
  s = s.replace(/-(\d{8})(?:-v\d+)?$/, '') // drop date stamps
  s = s.replace(/-v\d+$/, '')
  const parts = s.split('-').filter(Boolean)
  if (parts.length) {
    const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    const rest = parts.slice(1).join('.')
    return `${family}${rest ? ` ${rest}` : ''}${ctx1m ? ' (1M)' : ''}`
  }
  return id
}

function isPlausibleClaudeModelId(id: string): boolean {
  const mid = id.trim()
  if (!mid || mid.length > 80) return false
  if (/\.(md|json|js|ts)$/i.test(mid)) return false
  if (/[/\\]/.test(mid)) return false
  if (/mythos/i.test(mid)) return false // org-only tier; not general picker
  // family aliases accepted by `claude --model`
  if (/^(sonnet|opus|haiku|fable|best)$/i.test(mid)) return true
  // full ids e.g. claude-sonnet-5, claude-opus-4-8, claude-fable-5[1m]
  if (/^claude-(opus|sonnet|haiku|fable)(-[a-z0-9.]+)+(?:\[[^\]]+\])?$/i.test(mid)) {
    // reject incomplete trailing hyphen fragments from binary scrape
    if (mid.endsWith('-') || mid.endsWith('.')) return false
    // require at least one digit (drops bare "claude-fable")
    if (!/\d/.test(mid)) return false
    return true
  }
  return false
}

/**
 * Claude Code model picker cache lives in ~/.claude.json:
 *   additionalModelOptionsCache: [{ value, label, description }]
 * Settings often only store the *current* model — that was why we only saw one.
 * Also scrape the installed `claude` binary for model ids the CLI accepts.
 */
function parseClaudeModels(binaryPath?: string | null): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>()
  const push = (id: string | undefined | null, label?: string) => {
    const mid = (id || '').trim()
    if (!mid || !isPlausibleClaudeModelId(mid)) return
    const prev = byId.get(mid)
    const nextLabel = claudeModelLabel(mid, label)
    if (!prev) {
      byId.set(mid, { id: mid, label: nextLabel, depths: ALL })
    } else if (label && prev.label === prev.id) {
      byId.set(mid, { ...prev, label: nextLabel })
    }
  }

  // 1) settings.json — current model only
  const settingsCandidates = [
    home('.claude', 'settings.json'),
    home('.claude', 'settings.local.json'),
    home('.config', 'claude', 'settings.json'),
  ]
  for (const p of settingsCandidates) {
    if (!exists(p)) continue
    const data = readJson(p) as {
      model?: string
      defaultModel?: string
      models?: Array<string | { id?: string; name?: string; model?: string; label?: string }>
    } | null
    if (!data) continue
    push(data.model)
    push(data.defaultModel)
    if (Array.isArray(data.models)) {
      for (const m of data.models) {
        if (typeof m === 'string') push(m)
        else if (m && typeof m === 'object') {
          push(m.id || m.model || m.name, m.label || m.name)
        }
      }
    }
  }

  // 2) ~/.claude.json — model picker cache + projects
  const root = home('.claude.json')
  if (exists(root)) {
    const data = readJson(root) as Record<string, unknown> | null
    if (data) {
      if (typeof data.model === 'string') push(data.model)
      if (typeof data.defaultModel === 'string') push(data.defaultModel)
      if (typeof data.orgModelDefaultCache === 'string') push(data.orgModelDefaultCache)

      // Primary catalog source (what Claude Code shows in the model switcher)
      const opts = data.additionalModelOptionsCache
      if (Array.isArray(opts)) {
        for (const item of opts) {
          if (!item || typeof item !== 'object') continue
          const o = item as { value?: string; label?: string; description?: string }
          push(o.value, o.label || o.description)
        }
      }

      // Allowlist / access cache (string ids or objects)
      const access = data.modelAccessCache
      if (Array.isArray(access)) {
        for (const item of access) {
          if (typeof item === 'string') push(item)
          else if (item && typeof item === 'object') {
            const o = item as { id?: string; model?: string; value?: string; label?: string }
            push(o.id || o.model || o.value, o.label)
          }
        }
      }

      const projects = data.projects as Record<string, { model?: string }> | undefined
      if (projects && typeof projects === 'object') {
        for (const proj of Object.values(projects)) {
          if (proj?.model) push(proj.model)
        }
      }
    }
  }

  // 3) history / session artifacts (models actually used)
  try {
    const hist = home('.claude', 'history.jsonl')
    if (exists(hist)) {
      const raw = fs.readFileSync(hist, 'utf-8')
      const re = /"model"\s*:\s*"([^"]+)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(raw))) push(m[1])
    }
  } catch {
    /* ignore */
  }
  try {
    const sessDir = home('.claude', 'sessions')
    if (exists(sessDir)) {
      for (const name of fs.readdirSync(sessDir).slice(0, 40)) {
        if (!name.endsWith('.json')) continue
        const j = readJson(path.join(sessDir, name)) as { model?: string } | null
        if (j?.model) push(j.model)
      }
    }
  } catch {
    /* ignore */
  }

  // 4) Scan installed claude binary for model ids the CLI knows about
  //    (settings only keep the *selected* model — binary has the full set)
  const binModels = extractClaudeModelsFromBinary(binaryPath)
  for (const m of binModels) push(m.id, m.label)

  // 5) Family aliases always work with `claude --model <alias>` when binary exists
  if (binaryPath || byId.size) {
    for (const a of ['sonnet', 'opus', 'haiku', 'fable'] as const) {
      // only add alias if we already know that family exists in discovery
      const familyHit = [...byId.keys()].some((id) =>
        id === a || id.toLowerCase().includes(`claude-${a}`) || id.toLowerCase().includes(`${a}-`),
      )
      if (familyHit || binaryPath) push(a)
    }
  }

  // Prefer: aliases + non-dated full ids first
  const list = [...byId.values()]
  list.sort((a, b) => {
    const score = (id: string) => {
      if (/^(sonnet|opus|haiku|fable)$/i.test(id)) return 0
      if (/\[\d+m\]/i.test(id)) return 1
      if (/-\d{8}/.test(id)) return 3
      if (/-v\d+$/.test(id)) return 2
      return 1
    }
    const d = score(a.id) - score(b.id)
    if (d !== 0) return d
    return a.id.localeCompare(b.id)
  })
  return list
}

/**
 * Extract Claude model identifiers embedded in the local CLI binary.
 * Filters to stable ids (drops dated / incomplete scrape fragments).
 */
function extractClaudeModelsFromBinary(binaryPath?: string | null): DiscoveredModel[] {
  if (!binaryPath || !exists(binaryPath)) return []
  let real = binaryPath
  try {
    real = fs.realpathSync(binaryPath)
  } catch {
    /* keep as-is */
  }
  try {
    const st = fs.statSync(real)
    // skip absurdly large files
    if (!st.isFile() || st.size > 250 * 1024 * 1024) return []
    const buf = fs.readFileSync(real)
    // Match model-like ascii strings in the binary
    const re =
      /claude-(?:opus|sonnet|haiku|fable)(?:-[a-z0-9.]+)*(?:\[[0-9]+m\])?/gi
    const found = new Set<string>()
    const text = buf.toString('latin1')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const id = m[0]
      if (!isPlausibleClaudeModelId(id)) continue
      // Drop pure family stubs like "claude-opus-4" if we also have finer versions —
      // keep them for now; UI can show all.
      if (/-\d{8}/.test(id)) continue // dated snapshots clutter the picker
      if (/-v\d+$/i.test(id)) continue
      if (id.endsWith('-fast')) continue
      found.add(id)
    }
    return [...found].map((id) => ({
      id,
      label: claudeModelLabel(id),
      depths: ALL,
    }))
  } catch {
    return []
  }
}

function parseOpenCodeConfig(): { models: DiscoveredModel[]; path: string | null } {
  const userDataDir = path.join(app.getPath('userData'), 'opencode')
  const paths = [
    // app-owned OpenCode-format config first (doesn't require opencode CLI installed) …
    path.join(userDataDir, 'opencode.json'),
    path.join(userDataDir, 'opencode.jsonc'),
    // … plus the external opencode CLI's own global config, if present, as a bonus source.
    home('.config', 'opencode', 'opencode.jsonc'),
    home('.config', 'opencode', 'opencode.json'),
    home('.opencode', 'opencode.json'),
  ]
  let cfgPath: string | null = null
  let data: Record<string, unknown> | null = null
  for (const p of paths) {
    if (exists(p)) {
      cfgPath = p
      data = readJson(p) as Record<string, unknown> | null
      break
    }
  }
  const models: DiscoveredModel[] = []
  if (data) {
    // common shapes: model, provider, agent.*.model, models{}
    if (typeof data.model === 'string') {
      models.push({ id: data.model, label: data.model, depths: ALL })
    }
    const provider = data.provider as Record<string, { models?: Record<string, unknown> }> | undefined
    if (provider && typeof provider === 'object') {
      for (const [prov, val] of Object.entries(provider)) {
        const ms = val?.models
        if (ms && typeof ms === 'object') {
          for (const mid of Object.keys(ms)) {
            models.push({ id: `${prov}/${mid}`, label: `${prov}/${mid}`, depths: ALL })
          }
        }
      }
    }
  }
  // agents md models
  try {
    const scanned = scanOpenCodeAgents()
    for (const a of [...scanned.global, ...scanned.project]) {
      if (a.model) models.push({ id: a.model, label: a.model, depths: ALL })
    }
  } catch {
    /* ignore */
  }
  // dedupe
  const seen = new Set<string>()
  const uniq = models.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
  return { models: uniq, path: cfgPath }
}

function hasCodexAuth(): boolean {
  const auth = home('.codex', 'auth.json')
  if (!exists(auth)) return false
  try {
    const j = readJson(auth) as { tokens?: unknown; OPENAI_API_KEY?: string | null }
    if (j?.tokens) return true
    if (j?.OPENAI_API_KEY) return true
  } catch {
    /* ignore */
  }
  return exists(auth)
}

function hasGrokAuth(): boolean {
  return exists(home('.grok', 'auth.json'))
}

function hasClaudeAuth(): boolean {
  return (
    exists(home('.claude')) ||
    exists(home('.config', 'claude')) ||
    Boolean(process.env.ANTHROPIC_API_KEY)
  )
}

export async function discoverLocalClis(): Promise<{
  clis: DiscoveredCli[]
  summary: string
}> {
  const clis: DiscoveredCli[] = []

  // Codex (OpenAI) — prefer ~/.codex binaries over npm name collisions
  {
    const binaryPath = await whichCodex()
    const { models, defaultModel, defaultDepth } = parseCodexModels()
    const configPaths = [home('.codex', 'auth.json'), home('.codex', 'config.toml'), home('.codex', 'models_cache.json')].filter(exists)
    const hasAuth = hasCodexAuth()
    clis.push({
      id: 'codex',
      kind: 'codex',
      name: 'Codex CLI',
      foundBinary: Boolean(binaryPath),
      binaryPath,
      configPaths,
      hasAuth,
      authNote: hasAuth
        ? '偵測到 ~/.codex 登入狀態（ChatGPT/OAuth）。本 App 不會複製 token；可匯入模型清單。'
        : '未偵測到 Codex 登入',
      models,
      defaultModel,
      defaultDepth,
      notes: [
        binaryPath
          ? `binary: ${binaryPath}`
          : '未找到 OpenAI Codex（略過 npm codex-cli 部落格套件；請安裝官方 Codex CLI）',
        models.length ? `models_cache: ${models.length} 個模型` : '無 models_cache.json',
        'headless: codex exec --json（勿用互動 TUI）',
      ],
    })
  }

  // Claude — settings + ~/.claude.json picker cache + binary-embedded ids
  {
    const binaryPath = (await which('claude')) || (await which('claude-code'))
    const configPaths = [
      home('.claude'),
      home('.claude.json'),
      home('.config', 'claude'),
    ].filter(exists)
    const hasAuth = hasClaudeAuth()
    const models = parseClaudeModels(binaryPath)
    clis.push({
      id: 'anthropic',
      kind: 'anthropic',
      name: 'Claude Code',
      foundBinary: Boolean(binaryPath),
      binaryPath,
      configPaths,
      hasAuth,
      authNote: hasAuth
        ? '偵測到 Claude 設定目錄。需本機已 login；本 App 不讀取 secret 檔。'
        : '未偵測到 Claude 設定',
      models,
      defaultModel: models.find((m) => m.id.startsWith('claude-') && !/-\d{8}/.test(m.id))?.id,
      notes: [
        binaryPath ? `binary: ${binaryPath}` : 'PATH 中無 claude',
        `config: ${configPaths.map((p) => path.basename(p)).join(', ') || 'none'}`,
        models.length
          ? `discovered models: ${models.length}（含 settings / additionalModelOptionsCache / binary）`
          : '無本機模型可匯入 — 請先在 Claude Code 登入或選過模型',
      ],
    })
  }

  // Grok — models only from ~/.grok/models_cache.json
  {
    const binaryPath = (await which('grok')) || (exists(home('.grok', 'bin', 'grok')) ? home('.grok', 'bin', 'grok') : null)
    const models = parseGrokModels()
    const hasAuth = hasGrokAuth()
    clis.push({
      id: 'grok',
      kind: 'custom',
      name: 'Grok CLI',
      foundBinary: Boolean(binaryPath),
      binaryPath,
      configPaths: [home('.grok', 'auth.json'), home('.grok', 'models_cache.json')].filter(exists),
      hasAuth,
      authNote: hasAuth
        ? '偵測到 ~/.grok 登入。本 App 不複製 token；可匯入模型 id。'
        : '未偵測到 Grok 登入',
      models,
      notes: [
        binaryPath ? `binary: ${binaryPath}` : '無 grok binary',
        models.length ? `models_cache: ${models.length}` : '無 models_cache 可匯入',
      ],
    })
  }

  // OpenCode — models only from opencode.json(c) / agents
  {
    const binaryPath = await which('opencode')
    const { models, path: cfgPath } = parseOpenCodeConfig()
    const agents = scanOpenCodeAgents()
    clis.push({
      id: 'opencode',
      kind: 'opencode',
      name: 'OpenCode CLI',
      foundBinary: Boolean(binaryPath),
      binaryPath,
      configPaths: [cfgPath, ...agents.dirs].filter(Boolean) as string[],
      hasAuth: Boolean(binaryPath || cfgPath || agents.global.length),
      authNote: cfgPath
        ? `已找到 ${cfgPath}（可匯入模型）`
        : '未找到 opencode.jsonc',
      models,
      notes: [
        binaryPath ? `binary: ${binaryPath}` : 'PATH 無 opencode',
        `agents.md: ${agents.global.length + agents.project.length}`,
        models.length ? `discovered models: ${models.length}` : '設定中無模型可匯入',
      ],
    })
  }

  // Cursor Agent CLI only — never IDE `cursor.exe` (would open editor, hang headless)
  {
    const binaryPath = await whichCursorAgent()
    clis.push({
      id: 'cursor',
      kind: 'cursor',
      name: 'Cursor CLI',
      foundBinary: Boolean(binaryPath),
      binaryPath,
      configPaths: [],
      hasAuth: Boolean(binaryPath),
      authNote: binaryPath
        ? '偵測到 Cursor Agent CLI（模型請手輸或由 CLI 預設）'
        : '未安裝 cursor-agent / agent（勿用 IDE 的 cursor 指令）',
      models: [],
      notes: [
        binaryPath ? `binary: ${binaryPath}` : '無 cursor-agent binary',
        'headless: agent -p --output-format stream-json',
      ],
    })
  }

  const found = clis.filter((c) => c.foundBinary || c.hasAuth)
  const summary = [
    `已掃描 ${clis.length} 個 CLI 來源，${found.length} 個可授權`,
    ...found.map((c) => `· ${c.name}: binary=${c.foundBinary ? 'yes' : 'no'} auth=${c.hasAuth} models=${c.models.length}`),
  ].join('\n')

  return { clis, summary }
}

/**
 * Apply discovery into CliProviderConfig[] (no secrets)
 */
export function applyDiscoveryToProviders(
  current: Array<Record<string, unknown>>,
  discovery: DiscoveredCli[],
): Array<Record<string, unknown>> {
  const byId = new Map(current.map((p) => [String(p.id), { ...p }]))
  for (const d of discovery) {
    const existing = byId.get(d.id) || {
      id: d.id,
      kind: d.kind,
      name: d.name,
      enabled: false,
      authorized: false,
      models: [],
    }
    // Always take models from this scan (including empty) — no hardcoded catalogs.
    const models = d.models.map((m) => ({
      id: m.id,
      label: m.label,
      depths: m.depths,
    }))
    byId.set(d.id, {
      ...existing,
      name: d.name,
      kind: d.kind,
      cliBinary: d.binaryPath || existing.cliBinary || d.id,
      enabled: Boolean(existing.enabled) || d.foundBinary || d.hasAuth,
      authorized: Boolean(existing.authorized) || d.hasAuth || d.foundBinary,
      models,
    })
  }
  // keep order of current + any new
  const ids = [...new Set([...current.map((p) => String(p.id)), ...discovery.map((d) => d.id)])]
  return ids.map((id) => byId.get(id)!).filter(Boolean)
}
