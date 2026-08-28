import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { chmod, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'

/**
 * Host-owned skills（技能目錄）— one SKILL.md per skill, discovered by Pi's
 * resource loader and by nothing else (ADR-0034).
 *
 * The directory is owned by the Host process, so a skill the user writes is
 * visible to the same loader that feeds `<available_skills>` into the system
 * prompt. Renderer localStorage is a migration SOURCE only (issue 16); after
 * sync it is read-only for one release as a rollback copy.
 */

export type PiSkillStatus = 'active' | 'pinned' | 'archived'

export type PiSyncedSkill = {
  name: string
  description: string
  status: PiSkillStatus
  /** Where the SKILL.md landed, absolute. */
  filePath: string
}

export type PiSkillSyncResult =
  | { name: string; ok: true; status: PiSkillStatus; filePath: string; /** The on-disk (slugified) skill name. */ slug: string }
  | { name: string; ok: false; error: string }

export function resolvePiSkillsDir(agentDir: string | undefined): string | undefined {
  const configured = process.env.SUBAGENTS_PI_SKILLS_DIR?.trim()
  if (configured) return configured
  if (!agentDir) return undefined
  return join(agentDir, 'skills')
}

export type PiSkillResourceSnapshot = {
  root: string
  digest: string
  manifest: readonly string[]
  fileDigests?: Readonly<Record<string, string>>
}

export type PiPreflightSkillRevision = {
  id: string
  version: number
  digest: string
  body: string
  bodyBytes: number
}

export const PI_PREFLIGHT_SKILL_BODY_BUDGET_BYTES = 16 * 1024
export const PI_PREFLIGHT_SKILL_CONTEXT_BUDGET_BYTES = 24 * 1024

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return frontmatter.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, 'm'))?.[1]?.trim()
}

export function parsePreflightSkill(raw: string, exactTool?: string): PiPreflightSkillRevision | undefined {
  const normalized = raw.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) return undefined
  const boundary = normalized.indexOf('\n---\n', 4)
  if (boundary < 0) return undefined
  const frontmatter = normalized.slice(4, boundary)
  const tools = (frontmatterValue(frontmatter, 'preflight-tools') || '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tool) => tool.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  if (!tools.length || exactTool !== undefined && !tools.includes(exactTool)) return undefined
  const id = frontmatterValue(frontmatter, 'name') || ''
  const version = Number(frontmatterValue(frontmatter, 'version'))
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !Number.isSafeInteger(version) || version < 1) {
    throw new Error('Preflight Skill requires a valid name and positive integer version')
  }
  const body = normalized.slice(boundary + 5).trim()
  const bodyBytes = Buffer.byteLength(body, 'utf8')
  if (!body || bodyBytes > PI_PREFLIGHT_SKILL_BODY_BUDGET_BYTES) {
    throw new Error(`Preflight Skill ${id} exceeds its bounded body budget`)
  }
  return {
    id,
    version,
    digest: createHash('sha256').update(raw, 'utf8').digest('hex'),
    body,
    bodyBytes,
  }
}

async function readFrozenSkill(resourceView: PiSkillResourceSnapshot, relativePath: string): Promise<string | undefined> {
  if (!/^[^/]+\/SKILL\.md$/.test(relativePath.replaceAll('\\', '/'))) return undefined
  const absolute = join(resourceView.root, relativePath)
  const rel = relative(resourceView.root, absolute)
  if (rel.startsWith('..') || rel === '') throw new Error('Preflight Skill escaped the frozen Resource View')
  const info = await lstat(absolute)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) return undefined
  const raw = await readFile(absolute, 'utf8')
  const expectedDigest = resourceView.fileDigests?.[relativePath]
  if (!expectedDigest || createHash('sha256').update(raw, 'utf8').digest('hex') !== expectedDigest) {
    throw new Error(`Frozen Skill Resource View digest mismatch: ${relativePath}`)
  }
  return raw
}

/**
 * Versioned Host interface over the frozen Skill Resource View. It never
 * consults mutable source files or durable-memory rows.
 */
export async function selectFrozenPiPreflightSkills(input: {
  resourceView: PiSkillResourceSnapshot
  exactTool: string
  maxSkills?: 1 | 2
  secondSkillReason?: string
  contextBudgetBytes?: number
  /** Immutable package-owned SKILL.md revisions, never written to live resources. */
  overrides?: Readonly<Record<string, string>>
  goalContext?: string
}): Promise<PiPreflightSkillRevision[]> {
  const maxSkills = input.maxSkills || 1
  const budget = input.contextBudgetBytes || PI_PREFLIGHT_SKILL_CONTEXT_BUDGET_BYTES
  if (maxSkills === 2 && (!input.secondSkillReason?.trim() || !Number.isSafeInteger(budget)
    || budget < 1 || budget > PI_PREFLIGHT_SKILL_CONTEXT_BUDGET_BYTES)) {
    throw new Error('A second preflight Skill requires an explicit reason and hard context budget')
  }
  const matches: PiPreflightSkillRevision[] = []
  const paths = new Set([...input.resourceView.manifest, ...Object.keys(input.overrides || {}).map((id) => `${id}/SKILL.md`)])
  for (const relativePath of [...paths].sort()) {
    const id = relativePath.split('/')[0]
    const raw = input.overrides?.[id] ?? await readFrozenSkill(input.resourceView, relativePath)
    if (raw === undefined) continue
    const selected = parsePreflightSkill(raw, input.exactTool)
    if (selected && (!input.goalContext || skillMatchesGoal(selected, input.goalContext))) matches.push(selected)
  }
  const selected = matches.slice(0, maxSkills)
  if (selected.reduce((sum, skill) => sum + skill.bodyBytes, 0) > budget) {
    throw new Error('Selected preflight Skills exceed the hard context budget')
  }
  return selected
}

function skillMatchesGoal(skill: PiPreflightSkillRevision, context: string): boolean {
  const terms = `${skill.id} ${skill.body}`.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []
  const normalized = context.toLowerCase()
  return terms.some((term) => normalized.includes(term))
}

/** Host-only, bounded and symlink-free view of the files Pi may advertise. */
export async function snapshotPiSkillResources(agentDir: string | undefined, scope = 'turn'): Promise<PiSkillResourceSnapshot | undefined> {
  const source = resolvePiSkillsDir(agentDir)
  if (!source) return undefined
  const files: Array<{ relativePath: string; content: Buffer; granted: boolean }> = []
  let bytes = 0
  const visit = async (dir: string, prefix = ''): Promise<void> => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= 128) throw new Error('Skill Resource View exceeds 128 files')
      const relativePath = prefix ? join(prefix, entry.name) : entry.name
      const absolute = join(dir, entry.name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        // A random sibling directory is not a skill bundle. Only a top-level
        // directory with its own regular, non-symlink SKILL.md enters the view.
        if (!prefix) {
          try {
            const skillFile = await lstat(join(absolute, 'SKILL.md'))
            if (!skillFile.isFile() || skillFile.isSymbolicLink()) continue
          } catch { continue }
        }
        await visit(absolute, relativePath)
        continue
      }
      if (!stat.isFile()) continue
      // Root metadata is needed for pinned semantics but is never granted to tools.
      if (!prefix && entry.name !== 'skills-state.json') continue
      const content = await readFile(absolute)
      bytes += content.byteLength
      if (bytes > 2 * 1024 * 1024) throw new Error('Skill Resource View exceeds 2 MiB')
      files.push({ relativePath, content, granted: Boolean(prefix) })
    }
  }
  await visit(source)
  const hash = createHash('sha256')
  for (const file of files) hash.update(file.relativePath).update('\0').update(file.content).update('\0')
  const digest = hash.digest('hex')
  const root = join(tmpdir(), 'subagents-pi-skill-resource-view', String(process.pid), safeSegment(scope), digest)
  await mkdir(root, { recursive: true })
  for (const file of files) {
    const target = join(root, file.relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    try {
      const existing = await lstat(target)
      if (existing.isFile()) {
        const materialized = await readFile(target)
        if (!materialized.equals(file.content)) throw new Error(`Skill Resource View content drift: ${file.relativePath}`)
        await chmod(target, 0o444)
        continue
      }
    } catch { /* first materialization */ }
    await writeFile(target, file.content, { mode: 0o444 })
    await chmod(target, 0o444)
  }
  const granted = files.filter((file) => file.granted)
  return {
    root,
    digest,
    manifest: granted.map((file) => relative(root, join(root, file.relativePath))),
    fileDigests: Object.freeze(Object.fromEntries(granted.map((file) => [
      relative(root, join(root, file.relativePath)),
      createHash('sha256').update(file.content).digest('hex'),
    ]))),
  }
}

/** Escape a user-facing skill name into a safe single-path directory segment. */
function safeSegment(name: string): string {
  const segment = name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-')
  return segment && segment !== '.' && segment !== '..' ? segment : 'skill'
}

/**
 * Pi's loader only accepts skill names of lowercase a-z / 0-9 / hyphens, so a
 * renderer name like 「部署檢查」 must become a slug for the frontmatter. A
 * name with no ASCII at all gets a deterministic hashed slug so two runs
 * migrate to the SAME file instead of drifting apart.
 */
function slugifyPiSkillName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  const trimmed = slug.slice(0, 64).replace(/^-+|-+$/g, '')
  if (trimmed) return trimmed
  let hash = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `skill-${(hash >>> 0).toString(36)}`
}

/**
 * Serialize frontmatter + body the way Pi's loader reads them. Archived skills
 * ride Pi's own `disable-model-invocation` flag: they stay discoverable in
 * resources/list while staying out of the advertised prompt block.
 */
export function serializePiSkill(input: { name: string; description: string; body: string; status: PiSkillStatus }): string {
  const lines = [
    '---',
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
    ...(input.status === 'archived' ? ['disable-model-invocation: true'] : []),
    '---',
    '',
    input.body.replace(/\s+$/, ''),
    '',
  ]
  return lines.join('\n')
}

export type PiSkillsState = { version: 1; skills: Record<string, { status: PiSkillStatus; displayName?: string }> }

type RendererSkillCandidate = { name?: unknown; description?: unknown; body?: unknown; status?: unknown }

type SkillSyncContext = {
  dir: string
  state: PiSkillsState
  claimed: Map<string, string>
  attempted: Set<string>
}

async function readSkillsState(skillsDir: string): Promise<PiSkillsState> {
  try {
    const raw = JSON.parse(await readFile(join(skillsDir, 'skills-state.json'), 'utf8')) as PiSkillsState
    if (raw?.version === 1 && raw.skills && typeof raw.skills === 'object') return raw
  } catch {
    /* first sync or unreadable state starts fresh */
  }
  return { version: 1, skills: {} }
}

async function writeSkillsState(skillsDir: string, state: PiSkillsState): Promise<void> {
  await writeFile(join(skillsDir, 'skills-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function syncRendererSkill(
  context: SkillSyncContext,
  candidate: RendererSkillCandidate,
  index: number,
): Promise<{ result: PiSkillSyncResult; synced?: PiSyncedSkill }> {
  const fallbackName = typeof candidate?.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : `skill-${index + 1}`
  try {
    const name = slugifyPiSkillName(fallbackName)
    context.attempted.add(name)
    const description = typeof candidate.description === 'string' ? candidate.description : ''
    const body = typeof candidate.body === 'string' ? candidate.body : ''
    const status: PiSkillStatus = candidate.status === 'pinned' || candidate.status === 'archived'
      ? candidate.status
      : 'active'
    if (!description && !body) throw new Error('skill requires a description or a body')
    const previousOwner = context.claimed.get(name)
    if (previousOwner && previousOwner !== fallbackName) {
      throw new Error(`skill slug ${name} collides between "${previousOwner}" and "${fallbackName}"`)
    }
    const existing = context.state.skills[name]
    if (existing?.displayName && existing.displayName !== fallbackName && !context.claimed.has(name)) {
      throw new Error(`skill name collides with an existing skill: ${name}`)
    }
    context.claimed.set(name, fallbackName)
    const skillDir = join(context.dir, safeSegment(name))
    const filePath = join(skillDir, 'SKILL.md')
    await mkdir(skillDir, { recursive: true })
    await writeFile(filePath, serializePiSkill({ name, description, body, status }), 'utf8')
    context.state.skills[name] = { status, displayName: fallbackName }
    return {
      result: { name: fallbackName, ok: true, status, filePath, slug: name },
      synced: { name, description, status, filePath },
    }
  } catch (error) {
    return {
      result: { name: fallbackName, ok: false, error: error instanceof Error ? error.message : String(error) },
    }
  }
}

/** The pinned names the turn should expand up front (issue 16). */
export async function loadPinnedPiSkills(agentDir: string | undefined): Promise<string[]> {
  const state = await readSkillsStateSafely(agentDir)
  return Object.entries(state.skills).filter(([, meta]) => meta.status === 'pinned').map(([name]) => name)
}

async function readSkillsStateSafely(agentDir: string | undefined): Promise<PiSkillsState> {
  const dir = resolvePiSkillsDir(agentDir)
  if (!dir) return { version: 1, skills: {} }
  return readSkillsState(dir)
}

/** Split Pi-style frontmatter off a SKILL.md body. */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return raw
  return raw.slice(raw.indexOf('\n', end + 1) + 1)
}

/**
 * Full bodies for every pinned skill, read from the same directory Pi's
 * loader discovers.
 *
 * Pinned is the one case catalog-only advertisement does not cover: the user
 * pinned the skill precisely so it applies whether or not this objective
 * happens to match its keywords (user story 4), so its body is expanded up
 * front — the way Pi's own `/skill:<name>` expansion works, and through the
 * SAME files on disk, never a second discovery path.
 */
export async function loadPinnedPiSkillBodies(agentDir: string | undefined, skillsDir?: string): Promise<Array<{ name: string; body: string }>> {
  const dir = skillsDir || resolvePiSkillsDir(agentDir)
  if (!dir) return []
  const state = await readSkillsState(dir)
  const bodies: Array<{ name: string; body: string }> = []
  for (const [name, meta] of Object.entries(state.skills)) {
    if (meta.status !== 'pinned') continue
    try {
      const raw = await readFile(join(dir, safeSegment(name), 'SKILL.md'), 'utf8')
      const body = stripFrontmatter(raw).trim()
      if (body) bodies.push({ name: meta.displayName || name, body: `### 技能：${meta.displayName || name}\n\n${body}` })
    } catch {
      /* a missing file must not fail the turn; the loader reports its own diagnostic */
    }
  }
  return bodies
}

/**
 * Full-state sync: the payload is the renderer's WHOLE skill list, so every
 * call both writes each skill into the Host-owned directory AND removes Host
 * copies the renderer no longer has (deleted or renamed — a rename changes the
 * slug; if the NEW name fails to write, the OLD copy still goes, because the
 * renderer list is authoritative and the collision is reported). Without the removal half, a skill deleted in the 技能庫 would keep
 * being advertised and auto-loaded forever. A malformed skill is REPORTED,
 * never silently dropped; its slug still counts as attempted so a transient
 * failure cannot be mistaken for a deletion. Existing files are overwritten —
 * sync is idempotent, so a retried upgrade cannot duplicate work.
 */
export async function syncPiSkillsFromRenderer(
  agentDir: string | undefined,
  payload: RendererSkillCandidate[],
): Promise<{ skillsDir: string; results: PiSkillSyncResult[]; synced: PiSyncedSkill[] }> {
  const dir = resolvePiSkillsDir(agentDir)
  if (!dir) throw new Error('Pi skills directory is not available')
  await mkdir(dir, { recursive: true })
  const state = await readSkillsState(dir)
  const results: PiSkillSyncResult[] = []
  const synced: PiSyncedSkill[] = []
  // Slugs claimed during this run, so two different display names colliding
  // on one slug is REPORTED instead of one silently overwriting the other.
  const claimed = new Map<string, string>()
  // Slugs the payload ATTEMPTED, including ones whose write later failed —
  // reconciliation may only remove what the payload no longer mentions.
  const attempted = new Set<string>()
  const context: SkillSyncContext = { dir, state, claimed, attempted }
  for (const [index, candidate] of payload.entries()) {
    const outcome = await syncRendererSkill(context, candidate, index)
    results.push(outcome.result)
    if (outcome.synced) synced.push(outcome.synced)
  }
  // Removal pass: state entries absent from the payload were deleted (or
  // renamed) on the renderer side. Only entries THIS path wrote before are
  // eligible — a hand-placed file with no state entry is left alone, which is
  // also what keeps diagnostics for hand-written broken skills meaningful.
  for (const stale of Object.keys(state.skills)) {
    if (attempted.has(stale)) continue
    delete state.skills[stale]
    await rm(join(dir, safeSegment(stale)), { recursive: true, force: true })
  }
  await writeSkillsState(dir, state)
  return { skillsDir: dir, results, synced }
}

/** Renderer hydration cap — same spirit as the snapshot view's file bounds. */
const PI_SKILL_FILE_MAX_BYTES = 64 * 1024

/**
 * Read every discoverable skill back OUT of the Host-owned directory.
 *
 * The renderer skill store must never push a full-state sync built from an
 * unhydrated list（that would reconcile real skills away）, so the Electron
 * production branch projects the Host directory INTO the renderer at boot:
 * Pi owns the resource (ADR-0034), the 技能庫 UI is a read-write projection.
 * Hand-placed root-level files stay out on purpose — the loader already
 * reports them as diagnostics, and they are not renderer-managed state.
 */
export async function readPiSkillFiles(agentDir: string | undefined): Promise<Array<{ path: string; raw: string }>> {
  const dir = resolvePiSkillsDir(agentDir)
  if (!dir) return []
  const files: Array<{ path: string; raw: string }> = []
  let skillDirs: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return [] // directory not created yet — nothing to hydrate
  }
  for (const name of skillDirs) {
    const filePath = join(dir, name, 'SKILL.md')
    try {
      const info = await lstat(filePath)
      if (!info.isFile() || info.size > PI_SKILL_FILE_MAX_BYTES) continue
      files.push({ path: filePath, raw: await readFile(filePath, 'utf8') })
    } catch {
      /* directory without a readable SKILL.md is not a renderer-managed skill */
    }
  }
  return files
}

/** Remove one skill's file and its pin/archive record. */
export async function deletePiSkill(agentDir: string | undefined, name: string): Promise<boolean> {
  const dir = resolvePiSkillsDir(agentDir)
  if (!dir) return false
  const state = await readSkillsState(dir)
  if (!state.skills[name]) return false
  delete state.skills[name]
  await writeSkillsState(dir, state)
  return true
}

/**
 * The system-prompt block that expands pinned skill bodies up front, or an
 * empty string when nothing is pinned.
 */
export async function buildPinnedPiSkillsPromptBlock(agentDir: string | undefined, skillsDir?: string): Promise<string> {
  const bodies = await loadPinnedPiSkillBodies(agentDir, skillsDir)
  if (!bodies.length) return ''
  return `## 已釘選技能\n\n以下技能由使用者釘選，無論當前任務是否提及關鍵字都必須套用：\n\n${bodies.map((skill) => skill.body).join('\n\n')}`
}

/* ── Loader discovery capture ─────────────────────────────────────────── */

export type PiDiscoveredSkill = { name: string; description: string; filePath: string; disableModelInvocation: boolean }

type DiscoveredSkills = {
  skills: PiDiscoveredSkill[]
  diagnostics: Array<{ path: string; severity?: unknown; message: unknown }>
  capturedAt: number
}

let discovered: DiscoveredSkills = { skills: [], diagnostics: [], capturedAt: 0 }

/**
 * What the resource loader found on its last reload. The protocol reads this
 * to fill `resources/list` — before this existed the registry was never
 * populated and resources/list answered an empty array no matter what the
 * user had written (issue 02).
 */
export function discoveredPiSkills(): DiscoveredSkills {
  return discovered
}

/** Test seam. */
export function resetDiscoveredPiSkills(): void {
  discovered = { skills: [], diagnostics: [], capturedAt: 0 }
}

export function captureDiscoveredPiSkills(loaded: unknown): void {
  if (!loaded || typeof loaded !== 'object') return
  const skills = Array.isArray((loaded as { skills?: unknown }).skills) ? (loaded as { skills: unknown[] }).skills : []
  const diagnostics = Array.isArray((loaded as { diagnostics?: unknown }).diagnostics) ? (loaded as { diagnostics: unknown[] }).diagnostics : []
  discovered = {
    skills: skills.map((skill) => {
      const candidate = skill as Partial<PiDiscoveredSkill>
      return {
        name: typeof candidate.name === 'string' ? candidate.name : '',
        description: typeof candidate.description === 'string' ? candidate.description : '',
        filePath: typeof candidate.filePath === 'string' ? candidate.filePath : '',
        disableModelInvocation: candidate.disableModelInvocation === true,
      }
    }),
    diagnostics: diagnostics.map((diagnostic) => {
      const entry = diagnostic as { path?: unknown; message?: unknown; severity?: unknown }
      return {
        path: typeof entry.path === 'string' ? entry.path : '',
        severity: entry.severity,
        message: entry.message,
      }
    }),
    capturedAt: Date.now(),
  }
}
