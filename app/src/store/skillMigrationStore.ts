import { create } from 'zustand'

/**
 * What the one-way skill migration actually did, per skill.
 *
 * The Host has always produced this report; the renderer used to read only
 * `results.every(ok)` and throw the rest away, so a skill that failed to
 * migrate vanished — no error, no entry, and the boot loop simply retried
 * twenty times and gave up in silence (issue 16).
 *
 * The shape follows the doctor pattern: a failing item stays IN the list with
 * the reason it failed, instead of disappearing from it. Nothing here
 * interrupts the user — it is read where skills live, when they look.
 */

export type SkillMigrationOutcome =
  | { name: string; ok: true; slug: string }
  | { name: string; ok: false; error: string }

export type SkillMigrationReport = {
  /** When the last attempt finished. */
  at: string
  /** The Host-owned directory the skills were written into. */
  skillsDir: string
  outcomes: SkillMigrationOutcome[]
  /** True once every skill migrated; the boot bootstrap stops retrying then. */
  complete: boolean
  /** Set when the attempt budget ran out before the Host bridge answered. */
  unreachable?: boolean
}

type SkillMigrationState = {
  report?: SkillMigrationReport
  setReport: (report: SkillMigrationReport) => void
  clear: () => void
}

const STORAGE_KEY = 'subagents.skillsMigration.report.v1'

function load(): SkillMigrationReport | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as SkillMigrationReport
    return Array.isArray(parsed?.outcomes) ? parsed : undefined
  } catch {
    // A corrupt report must not stop the app from starting; losing the
    // diagnostic is recoverable, a boot failure is not.
    return undefined
  }
}

function persist(report: SkillMigrationReport | undefined): void {
  try {
    if (report) localStorage.setItem(STORAGE_KEY, JSON.stringify(report))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage is unavailable in some contexts; the in-memory report still shows */
  }
}

export const useSkillMigrationStore = create<SkillMigrationState>((set) => ({
  report: load(),
  setReport: (report) => {
    persist(report)
    set({ report })
  },
  clear: () => {
    persist(undefined)
    set({ report: undefined })
  },
}))

/** The skills that did not migrate, in report order. */
export function failedSkillMigrations(report: SkillMigrationReport | undefined): Array<{ name: string; error: string }> {
  return (report?.outcomes || [])
    .filter((outcome): outcome is Extract<SkillMigrationOutcome, { ok: false }> => !outcome.ok)
    .map((outcome) => ({ name: outcome.name, error: outcome.error }))
}
