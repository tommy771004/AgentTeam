import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/**
 * Durable main-process mirror of the renderer's run journal.
 *
 * Why this exists: the renderer journal lives in localStorage, which browsers
 * may evict under quota pressure and which has no crash-consistent write. A
 * run admitted minutes before a hard crash deserves better than "maybe". This
 * store mirrors the journal's serialized state into userData with the same
 * guarantees the compaction checkpoint store already provides (temp file +
 * rename, mode 0600), plus two additions learned from hermes-agent's delivery
 * ledger:
 *
 * - **Checksum**: a torn write is detectable instead of silently quarantining
 *   a half-journal.
 * - **Owner stamp**: every snapshot records the main-process pid and boot
 *   time, so a reader can tell who wrote it and when. Electron runs one main
 *   process per profile, so a mirror found at startup always describes this
 *   boot's earlier history — exactly what a renderer whose localStorage was
 *   evicted needs to recover.
 *
 * The mirrored payload is opaque here: this store never inspects entries. The
 * renderer journal remains the schema owner (bounded metadata only — never
 * prompts, payloads, or credentials), and this file only adds durability.
 */

export type JournalMirrorOwner = { pid: number; bootedAt: string }

type JournalMirrorRecord = {
  version: 1
  /** Serialized journal state; schema owned by src/agent/runJournal.ts. */
  state: string
  owner: JournalMirrorOwner
  /** sha256 of `state`, so a torn or hand-edited file is rejected on read. */
  checksum: string
  savedAt: string
}

export type JournalMirrorSaveResult = { ok: boolean; error?: string }

const MAX_STATE_BYTES = 512_000

function checksumOf(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

function parseRecord(raw: string | null): JournalMirrorRecord | null {
  if (!raw || raw.length > MAX_STATE_BYTES + 2_048) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value.version !== 1 || typeof value.state !== 'string') return null
    if (typeof value.checksum !== 'string' || checksumOf(value.state) !== value.checksum) return null
    const owner = value.owner as JournalMirrorOwner | undefined
    if (!owner || typeof owner.bootedAt !== 'string' || !Number.isFinite(Number(owner.pid))) return null
    return {
      version: 1,
      state: value.state,
      owner: { pid: Number(owner.pid), bootedAt: String(owner.bootedAt) },
      checksum: value.checksum,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    }
  } catch {
    return null
  }
}

function writeFileAtomic(file: string, payload: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tempPath = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, payload, { mode: 0o600 })
  fs.renameSync(tempPath, file)
}

export class JournalMirrorStore {
  private readonly file: string
  private readonly backupFile: string
  readonly owner: JournalMirrorOwner

  constructor(rootDir: string, now: () => Date = () => new Date()) {
    this.file = path.join(rootDir, 'run-journal-mirror.json')
    this.backupFile = path.join(rootDir, 'run-journal-mirror.backup.json')
    this.owner = { pid: process.pid, bootedAt: now().toISOString() }
  }

  /**
   * Persist one renderer journal snapshot. The previous good snapshot moves to
   * the backup slot first, mirroring the renderer's own double-buffer scheme.
   */
  save(state: string): JournalMirrorSaveResult {
    if (typeof state !== 'string' || !state || state.length > MAX_STATE_BYTES) {
      return { ok: false, error: 'journal mirror state must be a non-empty bounded string' }
    }
    try {
      let previous: string | null = null
      try {
        previous = fs.readFileSync(this.file, 'utf8')
      } catch {
        previous = null
      }
      const record: JournalMirrorRecord = {
        version: 1,
        state,
        owner: this.owner,
        checksum: checksumOf(state),
        savedAt: new Date().toISOString(),
      }
      const payload = JSON.stringify(record)
      if (previous) {
        try {
          writeFileAtomic(this.backupFile, previous)
        } catch {
          /* losing the older snapshot must not block the newer write */
        }
      }
      writeFileAtomic(this.file, payload)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'journal mirror write failed' }
    }
  }

  /**
   * Read the newest valid snapshot, falling back to the backup when the
   * primary is absent or fails its checksum. Returns null when neither is
   * usable — callers treat that as "nothing durable to recover".
   */
  read(): { state: string; owner: JournalMirrorOwner; savedAt: string; fromBackup: boolean } | null {
    try {
      const primary = parseRecord(fs.readFileSync(this.file, 'utf8'))
      if (primary) return { state: primary.state, owner: primary.owner, savedAt: primary.savedAt, fromBackup: false }
    } catch {
      /* fall through to backup */
    }
    try {
      const backup = parseRecord(fs.readFileSync(this.backupFile, 'utf8'))
      if (backup) return { state: backup.state, owner: backup.owner, savedAt: backup.savedAt, fromBackup: true }
    } catch {
      /* no durable copy exists */
    }
    return null
  }
}
