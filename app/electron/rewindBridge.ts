/**
 * Rewind bridge — 檔案快照與回捲(Grok Build rewind_points.jsonl 的輕量版)。
 *
 * 寫入類工具(workspace_write / delete / move)執行前,renderer 先呼叫
 * `rewind:record` 存下目標檔案的原始內容;之後可用 `rewind:restore`
 * 還原到某個時點。安全防線:
 *
 * - 還原前比對「寫入後 hash」:檔案若已被外部(使用者/其他程式)改動,
 *   預設跳過該檔並回報 conflict,不覆蓋外部編輯(hunk-tracker 的 80% 保護)
 * - 快照只存 workspace 相對路徑;絕對路徑由 caller 的 resolver 決定,
 *   restore 不會寫到 workspace 之外
 * - 每 thread 一個 JSONL,超過大小上限即停止記錄(絕不讓 run 失敗)
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export type RewindKind = 'write' | 'delete' | 'move'

export interface RewindEntry {
  id: string
  threadId: string
  runId?: string
  kind: RewindKind
  at: string
  /** workspace 相對路徑(move 時為來源) */
  relPath: string
  /** move 的目的路徑 */
  toPath?: string
  /** 操作前內容;檔案原本不存在為 null */
  before: string | null
  /** 操作後預期內容的 sha1(write 用;delete/move 為 null) */
  afterSha1: string | null
}

export interface RewindEntryMeta {
  id: string
  threadId: string
  runId?: string
  kind: RewindKind
  at: string
  relPath: string
  toPath?: string
  beforeBytes: number
  existedBefore: boolean
}

export interface RestoreReport {
  ok: boolean
  restored: string[]
  /** 外部改動而跳過的檔案 */
  conflicts: string[]
  errors: string[]
}

const MAX_LOG_BYTES = 8 * 1024 * 1024
const MAX_BEFORE_CHARS = 2 * 1024 * 1024

export function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

function safeThreadFile(baseDir: string, threadId: string): string {
  const safe = String(threadId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  return path.join(baseDir, `${safe}.jsonl`)
}

export function recordRewindEntry(
  baseDir: string,
  entry: Omit<RewindEntry, 'id' | 'at'>,
): { ok: boolean; id?: string; skipped?: string } {
  try {
    if (!entry.threadId || !entry.relPath) return { ok: false, skipped: 'missing identity' }
    fs.mkdirSync(baseDir, { recursive: true })
    const file = safeThreadFile(baseDir, entry.threadId)
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      return { ok: false, skipped: 'rewind log size cap reached' }
    }
    const full: RewindEntry = {
      ...entry,
      before:
        entry.before === null ? null : String(entry.before).slice(0, MAX_BEFORE_CHARS),
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
    }
    fs.appendFileSync(file, JSON.stringify(full) + '\n', 'utf8')
    return { ok: true, id: full.id }
  } catch (e) {
    return { ok: false, skipped: e instanceof Error ? e.message : String(e) }
  }
}

export function readRewindEntries(baseDir: string, threadId: string): RewindEntry[] {
  try {
    const file = safeThreadFile(baseDir, threadId)
    if (!fs.existsSync(file)) return []
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const out: RewindEntry[] = []
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RewindEntry
        if (parsed && parsed.id && parsed.relPath) out.push(parsed)
      } catch {
        /* skip corrupt line */
      }
    }
    return out
  } catch {
    return []
  }
}

export function listRewindEntries(baseDir: string, threadId: string): RewindEntryMeta[] {
  return readRewindEntries(baseDir, threadId).map((e) => ({
    id: e.id,
    threadId: e.threadId,
    runId: e.runId,
    kind: e.kind,
    at: e.at,
    relPath: e.relPath,
    toPath: e.toPath,
    beforeBytes: e.before === null ? 0 : Buffer.byteLength(e.before, 'utf8'),
    existedBefore: e.before !== null,
  }))
}

/**
 * 還原到 `toEntryId`(含)之前的狀態:由最新到該筆逐一反向套用。
 * 每個檔案只在「目前內容 hash === 記錄的寫入後 hash」時才覆蓋;
 * 不符即列入 conflicts(除非 force)。
 */
export function restoreRewindEntries(
  baseDir: string,
  threadId: string,
  toEntryId: string,
  resolveAbs: (relPath: string) => string,
  opts?: { force?: boolean },
): RestoreReport {
  const report: RestoreReport = { ok: true, restored: [], conflicts: [], errors: [] }
  const entries = readRewindEntries(baseDir, threadId)
  const idx = entries.findIndex((e) => e.id === toEntryId)
  if (idx < 0) {
    return { ok: false, restored: [], conflicts: [], errors: [`entry not found: ${toEntryId}`] }
  }
  // conflict/error 的快照留在 log,之後仍可 force 重試
  const keptIds = new Set<string>()
  // 反向套用:最新 → 目標(含目標)
  const toApply = entries.slice(idx).reverse()
  for (const entry of toApply) {
    try {
      const abs = resolveAbs(entry.relPath)
      if (entry.kind === 'move' && entry.toPath) {
        const absTo = resolveAbs(entry.toPath)
        if (fs.existsSync(absTo)) {
          fs.mkdirSync(path.dirname(abs), { recursive: true })
          fs.renameSync(absTo, abs)
          report.restored.push(`${entry.toPath} → ${entry.relPath}`)
        } else {
          report.conflicts.push(`${entry.toPath}（move 目的檔已不存在）`)
          keptIds.add(entry.id)
        }
        continue
      }
      // write / delete:比對外部改動
      const currentContent = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
      if (!opts?.force && entry.kind === 'write' && entry.afterSha1) {
        const currentSha = currentContent === null ? null : sha1(currentContent)
        if (currentSha !== entry.afterSha1) {
          report.conflicts.push(`${entry.relPath}（寫入後曾被外部改動,已跳過）`)
          keptIds.add(entry.id)
          continue
        }
      }
      if (entry.before === null) {
        // 原本不存在 → 刪除
        if (fs.existsSync(abs)) fs.rmSync(abs, { force: true })
        report.restored.push(`${entry.relPath}（移除新建檔）`)
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, entry.before, 'utf8')
        report.restored.push(entry.relPath)
      }
    } catch (e) {
      report.errors.push(
        `${entry.relPath}: ${e instanceof Error ? e.message : String(e)}`,
      )
      keptIds.add(entry.id)
    }
  }
  // 消費掉已回捲的紀錄;目標之前的與 conflict/error 的保留
  try {
    const remaining = entries.filter((e, i) => i < idx || keptIds.has(e.id))
    const file = safeThreadFile(baseDir, threadId)
    fs.writeFileSync(
      file,
      remaining.map((e) => JSON.stringify(e)).join('\n') + (remaining.length ? '\n' : ''),
      'utf8',
    )
  } catch (e) {
    report.errors.push(`truncate log: ${e instanceof Error ? e.message : String(e)}`)
  }
  report.ok = report.errors.length === 0
  return report
}

export function clearRewindEntries(baseDir: string, threadId: string): boolean {
  try {
    const file = safeThreadFile(baseDir, threadId)
    if (fs.existsSync(file)) fs.rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}
