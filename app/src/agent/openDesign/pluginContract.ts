/**
 * OpenDesign Plugin Contract v1 subset — authoritative parser.
 *
 * Single source of truth for Plugin contract validation. Catalog,
 * pack management, and Task run admission must consume this result
 * instead of re-parsing fields independently.
 *
 * Design goals:
 * - Legacy manifests (no specVersion) remain loadable / selectable.
 * - v1 manifests declare specVersion, pluginKind, taskKind, mode,
 *   inputs, pipeline stages, capabilities, evals, preview, provenance.
 * - Unknown major version => incompatible (fail closed, not silent downgrade).
 * - Unknown capability / malformed stage / invalid repeat|until / invalid
 *   input schema => malformed/fail-closed with understandable reason.
 * - Unknown non-security metadata is accepted for minor-version forward compat
 *   but never grants execution authority.
 */

export const SUPPORTED_SPEC_MAJOR = 1
export const CURRENT_SPEC_VERSION = '1.0.0'

export type PluginKind = 'scenario' | 'template' | 'skill' | 'prompt' | 'craft' | 'media'
export type TaskKind =
  | 'new-generation'
  | 'refine'
  | 'extend'
  | 'import'
  | 'create'
  | 'export'
  | 'share'
  | 'deploy'
  | 'critique'
  | 'edit'
  | 'review'
export type PluginMode = 'prototype' | 'dashboard' | 'deck' | 'video' | 'hyperframes' | 'prompt' | 'landing' | 'other'

export type PluginInputType = 'string' | 'text' | 'select' | 'number' | 'boolean'

export type PluginInput = {
  name: string
  label?: string
  type: PluginInputType
  required?: boolean
  default?: string | number | boolean
  placeholder?: string
  options?: string[]
}

export type PipelineStage = {
  id: string
  atoms?: string[]
  repeat?: number | null
  until?: string | null
}

export type Pipeline = {
  stages: PipelineStage[]
}

export type Evaluation = {
  id: string
  kind?: string
  criteria?: string
  weight?: number
}

export type PreviewMeta = {
  type: string
  entry?: string
  poster?: string
  video?: string
  motion?: string
}

export type ProvenanceMeta = Record<string, unknown>

export type InteractiveSurfaceKind = 'choice' | 'form' | 'confirmation'
export type InteractiveSurfaceScope = 'run' | 'conversation' | 'project'

export type InteractiveSurfaceDeclaration = {
  id: string
  kind: InteractiveSurfaceKind
  scope: InteractiveSurfaceScope
  allowlist?: string[]
  title?: string
}

export function validateInteractiveSurfaceDeclaration(
  raw: unknown,
  opts?: { idFallback?: string },
): { ok: true; declaration: InteractiveSurfaceDeclaration } | { ok: false; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: 'surface 必須是 object。' }
  const id = cleanText(raw.id, 80) || cleanText(opts?.idFallback, 80)
  if (!id || !/^[a-zA-Z][a-zA-Z0-9._-]{1,79}$/.test(id)) return { ok: false, reason: 'surface.id 不合法。' }
  const kind = cleanText(raw.kind, 20)
  if (!['choice', 'form', 'confirmation'].includes(kind)) return { ok: false, reason: 'surface.kind 必須是 choice/form/confirmation。' }
  const scope = cleanText(raw.scope, 20) || 'run'
  if (!['run', 'conversation', 'project'].includes(scope)) return { ok: false, reason: 'surface.scope 不合法。' }
  if (raw.allowlist != null && !Array.isArray(raw.allowlist)) return { ok: false, reason: 'surface.allowlist 必須是字串陣列。' }
  const allowlist = Array.isArray(raw.allowlist) ? raw.allowlist.map((value) => cleanText(value, 64)).filter(Boolean) : []
  if (allowlist.length > 16) return { ok: false, reason: 'surface.allowlist 最多 16。' }
  if (allowlist.some((tool) => !/^[a-z_][a-z0-9_.-]{1,63}$/.test(tool))) return { ok: false, reason: 'surface.allowlist 含非法 tool。' }
  return {
    ok: true,
    declaration: {
      id,
      kind: kind as InteractiveSurfaceKind,
      scope: scope as InteractiveSurfaceScope,
      allowlist,
      title: cleanText(raw.title, 120) || undefined,
    },
  }
}

export type V1Manifest = {
  specVersion: string
  name?: string
  title?: string
  version?: string
  kind: PluginKind
  taskKind?: string
  mode?: string
  inputs?: PluginInput[]
  pipeline?: Pipeline | null
  capabilities: string[]
  evals?: Evaluation[]
  preview?: PreviewMeta | null
  provenance?: ProvenanceMeta | null
  surfaces?: InteractiveSurfaceDeclaration[]
  raw: unknown
}

export type LegacyManifest = {
  specVersion: null
  raw: unknown
  name?: string
  title?: string
  version?: string
}

export type PluginContractSuccess =
  | {
      ok: true
      kind: 'legacy'
      manifest: LegacyManifest
      warnings: string[]
      compatible: true
      executionStatus: 'legacy-compatible'
    }
  | {
      ok: true
      kind: 'v1'
      manifest: V1Manifest
      warnings: string[]
      compatible: true
      executionStatus: 'v1-compatible'
    }

export type PluginContractFailure =
  | {
      ok: false
      kind: 'incompatible'
      reason: string
      field?: string
      specVersion?: string
      raw: unknown
    }
  | {
      ok: false
      kind: 'malformed'
      reason: string
      field?: string
      raw: unknown
    }

export type PluginContractResult = PluginContractSuccess | PluginContractFailure

const KNOWN_PLUGIN_KINDS = new Set<string>([
  'scenario',
  'template',
  'skill',
  'prompt',
  'craft',
  'media',
])

const KNOWN_TASK_KINDS = new Set<string>([
  'new-generation',
  'refine',
  'extend',
  'import',
  'create',
  'export',
  'share',
  'deploy',
  'critique',
  'edit',
  'review',
])

const KNOWN_CAPABILITIES = new Set<string>([
  'prompt:inject',
  'fs:read',
  'fs:write',
  'subprocess',
  'bash',
  'network',
  'mcp',
  'connector',
  'media:video-generate',
  'media:video',
  'media:image-generate',
  'media:audio-generate',
])

const KNOWN_ATOMS = new Set<string>([
  'file-write',
  'live-artifact',
  'media-video',
  'media-image',
  'media-audio',
  'prompt-inject',
  'capture',
  'lint',
  'critique',
  'file-read',
  'workspace-write',
])

const INPUT_TYPES = new Set<string>(['string', 'text', 'select', 'number', 'boolean'])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cleanText(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function semverMajor(spec: string): number | null {
  const m = spec.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!m) return null
  return Number(m[1])
}

function validateInput(raw: unknown, index: number): { ok: true; input: PluginInput } | { ok: false; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: `inputs[${index}] 必須是 object。` }
  const name = cleanText(raw.name, 64)
  if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
    return { ok: false, reason: `inputs[${index}].name 不合法（需為字母開頭的 identifier）。` }
  }
  const type = String(raw.type || '').trim()
  if (!INPUT_TYPES.has(type)) {
    return { ok: false, reason: `inputs[${index}].type 不合法：${type || '(空)'}。` }
  }
  const label = cleanText(raw.label, 120) || undefined
  const required = raw.required === true ? true : raw.required === false ? false : undefined
  const placeholder = cleanText(raw.placeholder, 200) || undefined
  let options: string[] | undefined
  if (raw.options != null) {
    if (!Array.isArray(raw.options)) return { ok: false, reason: `inputs[${index}].options 必須是字串陣列。` }
    options = raw.options.map((v) => cleanText(v, 120)).filter(Boolean)
    if (type === 'select' && options.length === 0) {
      return { ok: false, reason: `inputs[${index}] type=select 需要至少一個 option。` }
    }
    if (options.length > 32) options = options.slice(0, 32)
  } else if (type === 'select') {
    return { ok: false, reason: `inputs[${index}] type=select 需要 options。` }
  }
  let def: string | number | boolean | undefined
  if (raw.default != null) {
    if (type === 'number' && typeof raw.default === 'number' && Number.isFinite(raw.default)) def = raw.default
    else if (type === 'boolean' && typeof raw.default === 'boolean') def = raw.default
    else if ((type === 'string' || type === 'text' || type === 'select') && typeof raw.default === 'string') def = cleanText(raw.default, 500)
    else if (type === 'number' && typeof raw.default === 'string' && raw.default.trim() !== '' && Number.isFinite(Number(raw.default))) def = Number(raw.default)
    else def = undefined
  }
  if (type === 'select' && typeof def === 'string' && options && !options.includes(def)) {
    return { ok: false, reason: `inputs[${index}].default 必須是 options 之一。` }
  }
  return {
    ok: true,
    input: {
      name,
      label,
      type: type as PluginInputType,
      required,
      default: def,
      placeholder,
      options,
    },
  }
}

function validateStage(raw: unknown, index: number): { ok: true; stage: PipelineStage } | { ok: false; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: `pipeline.stages[${index}] 必須是 object。` }
  const id = cleanText(raw.id, 80)
  if (!id || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)) {
    return { ok: false, reason: `pipeline.stages[${index}].id 不合法（需為 identifier）。` }
  }
  let atoms: string[] | undefined
  if (raw.atoms != null) {
    if (!Array.isArray(raw.atoms)) return { ok: false, reason: `pipeline.stages[${index}].atoms 必須是字串陣列。` }
    atoms = raw.atoms.map((v) => cleanText(v, 64)).filter(Boolean)
    if (atoms.length === 0) return { ok: false, reason: `pipeline.stages[${index}].atoms 不可為空。` }
    if (atoms.length > 16) atoms = atoms.slice(0, 16)
    for (const a of atoms) {
      if (!/^[a-z][a-z0-9-]*$/.test(a)) return { ok: false, reason: `pipeline.stages[${index}].atoms 含不合法 atom：${a}` }
      if (!KNOWN_ATOMS.has(a)) {
        // Unknown atom is allowed as forward-compat warning, but we note it
        // For execution authority, unknown atoms do NOT grant capability, so we keep them as data
      }
    }
  }
  let repeat: number | null = null
  if (raw.repeat != null) {
    if (typeof raw.repeat === 'number') {
      if (!Number.isInteger(raw.repeat) || raw.repeat < 1 || raw.repeat > 100) {
        return { ok: false, reason: `pipeline.stages[${index}].repeat 需為 1–100 的整數。` }
      }
      repeat = raw.repeat
    } else if (isObject(raw.repeat) && typeof raw.repeat.count === 'number') {
      const c = raw.repeat.count as number
      if (!Number.isInteger(c) || c < 1 || c > 100) {
        return { ok: false, reason: `pipeline.stages[${index}].repeat.count 需為 1–100。` }
      }
      repeat = c
    } else if (typeof raw.repeat === 'string') {
      const n = Number(raw.repeat)
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return { ok: false, reason: `pipeline.stages[${index}].repeat 字串需為 1–100。` }
      }
      repeat = n
    } else {
      return { ok: false, reason: `pipeline.stages[${index}].repeat 格式不合法。` }
    }
  }
  let until: string | null = null
  if (raw.until != null) {
    if (typeof raw.until !== 'string' || !raw.until.trim()) {
      return { ok: false, reason: `pipeline.stages[${index}].until 必須是非空字串。` }
    }
    until = raw.until.trim().slice(0, 500)
    if (isObject(raw.repeat) && (raw.repeat as Record<string, unknown>).until != null && typeof (raw.repeat as Record<string, unknown>).until !== 'string') {
      return { ok: false, reason: `pipeline.stages[${index}].repeat.until 必須是字串。` }
    }
  }
  if (isObject(raw.repeat) && (raw.repeat as Record<string, unknown>).until != null) {
    const ru = cleanText((raw.repeat as Record<string, unknown>).until, 500)
    if (!ru) return { ok: false, reason: `pipeline.stages[${index}].repeat.until 不可為空。` }
    until = ru
  }
  return { ok: true, stage: { id, atoms, repeat, until } }
}

function parseV1(rawObj: Record<string, unknown>, warnings: string[]): PluginContractResult {
  const specVersionRaw = rawObj.specVersion ?? rawObj.spec_version
  const specVersion = cleanText(specVersionRaw, 40)
  const major = semverMajor(specVersion)
  if (major == null) {
    return { ok: false, kind: 'malformed', reason: `specVersion 格式不合法：${specVersion || '(空)'}`, field: 'specVersion', raw: rawObj }
  }
  if (major !== SUPPORTED_SPEC_MAJOR) {
    return {
      ok: false,
      kind: 'incompatible',
      reason: `不支援的 specVersion ${specVersion}（目前僅支援 v${SUPPORTED_SPEC_MAJOR}.x）。請更新應用程式或選擇相容版本。`,
      field: 'specVersion',
      specVersion,
      raw: rawObj,
    }
  }
  if (major === 1 && specVersion !== CURRENT_SPEC_VERSION) {
    warnings.push(`specVersion ${specVersion} 為 v1 相容版本，已接受（目前標示 ${CURRENT_SPEC_VERSION}）。`)
  }

  // od object may be at top-level od or directly on raw
  const odRaw = isObject(rawObj.od) ? rawObj.od : isObject(rawObj.plugin) ? rawObj.plugin : null
  const od = (odRaw || rawObj) as Record<string, unknown>

  // plugin kind
  const kindRaw = cleanText(od.kind ?? rawObj.kind ?? od.pluginKind, 64)
  let kind: PluginKind = 'scenario'
  if (kindRaw) {
    if (!KNOWN_PLUGIN_KINDS.has(kindRaw)) {
      return { ok: false, kind: 'malformed', reason: `未知的 plugin kind：${kindRaw}`, field: 'od.kind', raw: rawObj }
    }
    kind = kindRaw as PluginKind
  } else {
    warnings.push('未宣告 od.kind，已預設為 scenario。')
  }

  // taskKind
  const taskKindRaw = cleanText(od.taskKind ?? od.task_kind ?? rawObj.taskKind, 64)
  let taskKind: string | undefined
  if (taskKindRaw) {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(taskKindRaw)) {
      return { ok: false, kind: 'malformed', reason: `taskKind 格式不合法：${taskKindRaw}`, field: 'od.taskKind', raw: rawObj }
    }
    if (!KNOWN_TASK_KINDS.has(taskKindRaw)) {
      warnings.push(`未知的 taskKind：${taskKindRaw}，已保留為 metadata，不授予額外權限。`)
    }
    taskKind = taskKindRaw
  }

  // mode
  const modeRaw = cleanText(od.mode ?? rawObj.mode, 64)
  let mode: string | undefined
  if (modeRaw) {
    if (!/^[a-z0-9-]{1,64}$/.test(modeRaw)) {
      return { ok: false, kind: 'malformed', reason: `mode 格式不合法：${modeRaw}`, field: 'od.mode', raw: rawObj }
    }
    mode = modeRaw
  }

  // inputs
  let inputs: PluginInput[] | undefined
  const inputsRaw = od.inputs ?? rawObj.inputs
  if (inputsRaw != null) {
    if (!Array.isArray(inputsRaw)) return { ok: false, kind: 'malformed', reason: 'inputs 必須是陣列。', field: 'od.inputs', raw: rawObj }
    if (inputsRaw.length > 32) return { ok: false, kind: 'malformed', reason: 'inputs 最多 32 項。', field: 'od.inputs', raw: rawObj }
    inputs = []
    const seen = new Set<string>()
    for (let i = 0; i < inputsRaw.length; i++) {
      const r = validateInput(inputsRaw[i], i)
      if (!r.ok) return { ok: false, kind: 'malformed', reason: r.reason, field: `od.inputs[${i}]`, raw: rawObj }
      if (seen.has(r.input.name)) return { ok: false, kind: 'malformed', reason: `inputs 重複 name：${r.input.name}`, field: `od.inputs[${i}].name`, raw: rawObj }
      seen.add(r.input.name)
      inputs.push(r.input)
    }
  }

  // pipeline
  let pipeline: Pipeline | null = null
  const pipelineRaw = od.pipeline ?? rawObj.pipeline
  if (pipelineRaw != null) {
    if (!isObject(pipelineRaw)) return { ok: false, kind: 'malformed', reason: 'pipeline 必須是 object。', field: 'od.pipeline', raw: rawObj }
    const stagesRaw = pipelineRaw.stages
    if (!Array.isArray(stagesRaw)) return { ok: false, kind: 'malformed', reason: 'pipeline.stages 必須是陣列。', field: 'od.pipeline.stages', raw: rawObj }
    if (stagesRaw.length === 0) return { ok: false, kind: 'malformed', reason: 'pipeline.stages 不可為空。', field: 'od.pipeline.stages', raw: rawObj }
    if (stagesRaw.length > 16) return { ok: false, kind: 'malformed', reason: 'pipeline.stages 最多 16 項。', field: 'od.pipeline.stages', raw: rawObj }
    const stages: PipelineStage[] = []
    const seenStage = new Set<string>()
    for (let i = 0; i < stagesRaw.length; i++) {
      const r = validateStage(stagesRaw[i], i)
      if (!r.ok) return { ok: false, kind: 'malformed', reason: r.reason, field: `od.pipeline.stages[${i}]`, raw: rawObj }
      if (seenStage.has(r.stage.id)) return { ok: false, kind: 'malformed', reason: `pipeline stage id 重複：${r.stage.id}`, field: `od.pipeline.stages[${i}].id`, raw: rawObj }
      seenStage.add(r.stage.id)
      stages.push(r.stage)
    }
    pipeline = { stages }
  }

  // capabilities
  let capabilities: string[] = []
  const capsRaw = od.capabilities ?? rawObj.capabilities
  if (capsRaw != null) {
    if (!Array.isArray(capsRaw)) return { ok: false, kind: 'malformed', reason: 'capabilities 必須是字串陣列。', field: 'od.capabilities', raw: rawObj }
    if (capsRaw.length > 32) return { ok: false, kind: 'malformed', reason: 'capabilities 最多 32 項。', field: 'od.capabilities', raw: rawObj }
    for (let i = 0; i < capsRaw.length; i++) {
      const c = cleanText(capsRaw[i], 80)
      if (!c) return { ok: false, kind: 'malformed', reason: `capabilities[${i}] 為空。`, field: `od.capabilities[${i}]`, raw: rawObj }
      if (!KNOWN_CAPABILITIES.has(c)) {
        return { ok: false, kind: 'malformed', reason: `未知 capability：${c}（此版本不授予該權限）`, field: `od.capabilities[${i}]`, raw: rawObj }
      }
      capabilities.push(c)
    }
    capabilities = [...new Set(capabilities)]
  }

  // evals
  let evals: Evaluation[] | undefined
  const evalsRaw = od.evals ?? od.evaluations ?? rawObj.evals ?? rawObj.evaluations
  if (evalsRaw != null) {
    if (!Array.isArray(evalsRaw)) return { ok: false, kind: 'malformed', reason: 'evals 必須是陣列。', field: 'od.evals', raw: rawObj }
    if (evalsRaw.length > 32) return { ok: false, kind: 'malformed', reason: 'evals 最多 32 項。', field: 'od.evals', raw: rawObj }
    evals = []
    for (let i = 0; i < evalsRaw.length; i++) {
      const e = evalsRaw[i]
      if (!isObject(e)) return { ok: false, kind: 'malformed', reason: `evals[${i}] 必須是 object。`, field: `od.evals[${i}]`, raw: rawObj }
      const id = cleanText(e.id, 80)
      if (!id || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)) return { ok: false, kind: 'malformed', reason: `evals[${i}].id 不合法。`, field: `od.evals[${i}].id`, raw: rawObj }
      evals.push({
        id,
        kind: cleanText(e.kind, 40) || undefined,
        criteria: cleanText(e.criteria ?? e.description, 500) || undefined,
        weight: typeof e.weight === 'number' && Number.isFinite(e.weight) ? Math.max(0, Math.min(1, e.weight)) : undefined,
      })
    }
  }

  // preview
  let preview: PreviewMeta | null = null
  const previewRaw = od.preview ?? rawObj.preview
  if (previewRaw != null) {
    if (!isObject(previewRaw)) return { ok: false, kind: 'malformed', reason: 'preview 必須是 object。', field: 'od.preview', raw: rawObj }
    const type = cleanText(previewRaw.type, 40)
    if (!type || !/^[a-z][a-z0-9-]*$/.test(type)) return { ok: false, kind: 'malformed', reason: `preview.type 不合法：${type || '(空)'}`, field: 'od.preview.type', raw: rawObj }
    preview = {
      type,
      entry: cleanText(previewRaw.entry, 500) || undefined,
      poster: cleanText(previewRaw.poster, 1000) || undefined,
      video: cleanText(previewRaw.video, 1000) || undefined,
      motion: cleanText(previewRaw.motion, 40) || undefined,
    }
  }

  // provenance
  let provenance: ProvenanceMeta | null = null
  const provenanceRaw = od.provenance ?? rawObj.provenance
  if (provenanceRaw != null) {
    if (!isObject(provenanceRaw)) return { ok: false, kind: 'malformed', reason: 'provenance 必須是 object。', field: 'od.provenance', raw: rawObj }
    provenance = provenanceRaw
  }

  // surfaces — interactive MCP Apps surfaces
  let surfaces: InteractiveSurfaceDeclaration[] | undefined
  const surfacesRaw = (od as Record<string, unknown>).surfaces ?? (od as Record<string, unknown>).interactiveSurfaces ?? rawObj.surfaces
  if (surfacesRaw != null) {
    if (!Array.isArray(surfacesRaw)) return { ok: false, kind: 'malformed', reason: 'surfaces 必須是陣列。', field: 'od.surfaces', raw: rawObj }
    if (surfacesRaw.length > 8) return { ok: false, kind: 'malformed', reason: 'surfaces 最多 8 項。', field: 'od.surfaces', raw: rawObj }
    surfaces = []
    const seenIds = new Set<string>()
    for (let i = 0; i < surfacesRaw.length; i++) {
      const parsedSurface = validateInteractiveSurfaceDeclaration(surfacesRaw[i])
      if (!parsedSurface.ok) return { ok: false, kind: 'malformed', reason: `surfaces[${i}]：${parsedSurface.reason}`, field: `od.surfaces[${i}]`, raw: rawObj }
      if (seenIds.has(parsedSurface.declaration.id)) return { ok: false, kind: 'malformed', reason: `surfaces id 重複：${parsedSurface.declaration.id}`, field: `od.surfaces[${i}].id`, raw: rawObj }
      seenIds.add(parsedSurface.declaration.id)
      surfaces.push(parsedSurface.declaration)
    }
  }

  // Accept unknown non-security metadata: we already ignore extra fields; collect warnings if extra keys present that look like capabilities?
  // No further checks: unknown fields do not grant authority.

  const manifest: V1Manifest = {
    specVersion,
    name: cleanText(rawObj.name, 200) || undefined,
    title: cleanText(rawObj.title ?? od.title, 200) || undefined,
    version: cleanText(rawObj.version, 80) || undefined,
    kind,
    taskKind,
    mode,
    inputs,
    pipeline,
    capabilities,
    evals,
    preview,
    provenance,
    surfaces,
    raw: rawObj,
  }

  return { ok: true, kind: 'v1', manifest, warnings, compatible: true, executionStatus: 'v1-compatible' }
}

export function parseOpenDesignPluginManifest(value: unknown): PluginContractResult {
  if (!isObject(value)) {
    // Legacy edge: if raw is string maybe SKILL.md raw? Treat as legacy if it looks like markdown
    if (typeof value === 'string' && value.trim()) {
      return {
        ok: true,
        kind: 'legacy',
        manifest: { specVersion: null, raw: value, name: undefined, title: undefined, version: undefined },
        warnings: ['僅含文字/SKILL.md，已視為 legacy。'],
        compatible: true,
        executionStatus: 'legacy-compatible',
      }
    }
    return { ok: false, kind: 'malformed', reason: 'manifest 必須是 JSON object。', raw: value }
  }
  const rawObj = value as Record<string, unknown>

  // Detect legacy: no specVersion and no od.pipeline/capabilities etc that require v1
  const hasSpecVersion = rawObj.specVersion != null || rawObj.spec_version != null
  if (!hasSpecVersion) {
    // Check if it has od with v1-like fields but missing specVersion -> legacy still, but warn
    const hasV1Keys = Boolean(
      isObject(rawObj.od) &&
        ((rawObj.od as Record<string, unknown>).pipeline != null ||
          (rawObj.od as Record<string, unknown>).capabilities != null ||
          (rawObj.od as Record<string, unknown>).inputs != null),
    )
    if (hasV1Keys) {
      return {
        ok: false,
        kind: 'malformed',
        reason: '缺少 specVersion，無法判斷契約版本（v1 需要 specVersion）。',
        field: 'specVersion',
        raw: value,
      }
    }
    // Legacy: accept any object with at least name/title or SKILL.md style
    const warnings: string[] = []
    // Unknown fields in legacy are fine
    return {
      ok: true,
      kind: 'legacy',
      manifest: {
        specVersion: null,
        raw: value,
        name: cleanText(rawObj.name, 200) || undefined,
        title: cleanText(rawObj.title ?? rawObj.name, 200) || undefined,
        version: cleanText(rawObj.version, 80) || undefined,
      },
      warnings,
      compatible: true,
      executionStatus: 'legacy-compatible',
    }
  }

  const warnings: string[] = []
  // detect unknown top-level keys that are ignored but record warning for debuggability
  const knownTopKeys = new Set([
    'specVersion',
    'spec_version',
    '$schema',
    'name',
    'title',
    'title_i18n',
    'description',
    'description_i18n',
    'version',
    'publishedAt',
    'license',
    'author',
    'homepage',
    'plugin',
    'tags',
    'compat',
    'od',
    'kind',
    'taskKind',
    'mode',
    'inputs',
    'pipeline',
    'capabilities',
    'evals',
    'evaluations',
    'preview',
    'provenance',
    'surfaces',
    'interactiveSurfaces',
  ])
  for (const k of Object.keys(rawObj)) {
    if (!knownTopKeys.has(k)) {
      warnings.push(`忽略未知的 top-level 欄位：${k}`)
    }
  }

  return parseV1(rawObj, warnings)
}

export function contractResultToDisplay(result: PluginContractResult): { executable: boolean; label: string; reason?: string } {
  if (result.ok) {
    if (result.kind === 'legacy') {
      return { executable: true, label: '可執行（legacy）', reason: undefined }
    }
    return { executable: true, label: `可執行（v${result.manifest.specVersion}）` }
  }
  if (result.kind === 'incompatible') {
    return { executable: false, label: '不相容', reason: result.reason }
  }
  return { executable: false, label: '格式錯誤', reason: result.reason }
}

export function isLegacyContract(result: PluginContractResult): boolean {
  return result.ok && result.kind === 'legacy'
}

export function isV1Compatible(result: PluginContractResult): boolean {
  return result.ok && result.kind === 'v1'
}
