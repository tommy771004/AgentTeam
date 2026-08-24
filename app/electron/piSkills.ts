import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

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
  | { name: string; ok: true; status: PiSkillStatus; filePath: string }
  | { name: string; ok: false; error: string }

export function resolvePiSkillsDir(agentDir: string | undefined): string | undefined {
  const configured = process.env.SUBAGENTS_PI_SKILLS_DIR?.trim()
  if (configured) return configured
  if (!agentDir) return undefined
  return join(agentDir, 'skills')
}

/** Escape a user-facing skill name into a safe single-path directory segment. */
function safeSegment(name: string): string {
  const segment = name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-')
  return segment && segment !== '.' && segment !== '..' ? segment : 'skill'
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

export type PiSkillsState = { version: 1; skills: Record<string, { status: PiSkillStatus }> }

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
  const dir = resolvePiSkillsDir(agentDir)
  if (!dir) return []
  const state = await readSkillsState(dir)
  return Object.entries(state.skills).filter(([, meta]) => meta.status === 'pinned').map(([name]) => name)
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
  for (const [index, candidate] of payload.entries()) {
    const fallbackName = typeof candidate?.name === 'string' && candidate.name.trim() ? candidate.name.trim() : `skill-${index + 1}`
    try {
      const name = fallbackName
      const description = typeof candidate.description === 'string' ? candidate.description : ''
      const body = typeof candidate.body === 'string' ? candidate.body : ''
      const rawStatus = candidate.status === 'pinned' || candidate.status === 'archived' ? candidate.status : 'active'
      if (!name || (!description && !body)) throw new Error('skill requires a description or a body')
      const skillDir = join(dir, safeSegment(name))
      const filePath = join(skillDir, 'SKILL.md')
      await mkdir(skillDir, { recursive: true })
      await writeFile(filePath, serializePiSkill({ name, description, body, status: rawStatus }), 'utf8')
      state.skills[name] = { status: rawStatus }
      results.push({ name, ok: true, status: rawStatus, filePath })
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
