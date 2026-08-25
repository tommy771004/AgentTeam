import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { chmod, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

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

export type PiSkillResourceSnapshot = { root: string; digest: string; manifest: string[] }

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
  return { root, digest, manifest: files.filter((file) => file.granted).map((file) => relative(root, join(root, file.relativePath))) }
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
 * One-way migration: write each renderer skill into the Host-owned directory
 * and report per-skill results (user story 32). A malformed skill is REPORTED,
 * never silently dropped. Existing files are overwritten — sync is idempotent,
 * so a retried upgrade cannot duplicate work.
 */
export async function syncPiSkillsFromRenderer(
  agentDir: string | undefined,
  payload: { name?: unknown; description?: unknown; body?: unknown; status?: unknown }[],
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
  for (const [index, candidate] of payload.entries()) {
    const fallbackName = typeof candidate?.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `skill-${index + 1}`
    try {
      const displayName = fallbackName
      const name = slugifyPiSkillName(displayName)
      const description = typeof candidate.description === 'string' ? candidate.description : ''
      const body = typeof candidate.body === 'string' ? candidate.body : ''
      const rawStatus = candidate.status === 'pinned' || candidate.status === 'archived' ? candidate.status : 'active'
      if (!description && !body) throw new Error('skill requires a description or a body')
      const previousOwner = claimed.get(name)
      if (previousOwner && previousOwner !== displayName) throw new Error(`skill slug ${name} collides between "${previousOwner}" and "${displayName}"`)
      const existing = state.skills[name]
      if (existing?.displayName && existing.displayName !== displayName && !claimed.has(name)) {
        throw new Error(`skill name collides with an existing skill: ${name}`)
      }
      claimed.set(name, displayName)
      const skillDir = join(dir, safeSegment(name))
      const filePath = join(skillDir, 'SKILL.md')
      await mkdir(skillDir, { recursive: true })
      await writeFile(filePath, serializePiSkill({ name, description, body, status: rawStatus }), 'utf8')
      state.skills[name] = { status: rawStatus, displayName }
      results.push({ name: displayName, ok: true, status: rawStatus, filePath, slug: name })
      synced.push({ name, description, status: rawStatus, filePath })
    } catch (error) {
      results.push({ name: fallbackName, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  await writeSkillsState(dir, state)
  return { skillsDir: dir, results, synced }
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
