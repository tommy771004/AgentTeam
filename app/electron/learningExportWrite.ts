/**
 * Scoped write for learning-loop exports (ticket 04).
 *
 * Confinement is enforced here rather than at the IPC handler so it is
 * testable: traversal, absolute paths and symlink escapes must all be refused
 * before any byte is written.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isSafeLearningExportPath } from '../src/agent/hermes/learningExport.ts'

export type LearningExportWriteResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string; exists?: boolean; path?: string }

/**
 * Resolve `child` against `root` with symlinks followed. `path.resolve` alone
 * is not enough: a symlinked directory inside the project resolves lexically to
 * an inside path while physically pointing outside it.
 */
function realPathWithin(root: string, target: string): string | null {
  const realRoot = fs.realpathSync(root)
  // Walk to the deepest existing ancestor — the leaf usually does not exist yet.
  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) return null
    existing = parent
  }
  const realExisting = fs.realpathSync(existing)
  const remainder = path.relative(existing, target)
  const resolved = remainder ? path.resolve(realExisting, remainder) : realExisting
  const rel = path.relative(realRoot, resolved)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return resolved
}

export function writeLearningExport(input: {
  relativePath?: string
  content?: string
  projectRoot?: string
  overwrite?: boolean
}, resolveRoot: (override?: unknown) => string): LearningExportWriteResult {
  const relativePath = String(input.relativePath || '').replace(/\\/g, '/')
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[/\\]/.test(relativePath)) {
    return { ok: false, error: 'learning export path 不可為絕對路徑。' }
  }
  if (!isSafeLearningExportPath(relativePath)) {
    return { ok: false, error: 'learning export path 必須位於 .subagents/ 下。' }
  }
  const root = resolveRoot(input.projectRoot)
  const target = path.resolve(root, relativePath)
  const real = realPathWithin(root, target)
  if (!real) {
    return { ok: false, error: 'learning export path 逸出 project root（含 symlink）。' }
  }
  if (fs.existsSync(real) && input.overwrite !== true) {
    return { ok: false, exists: true, path: relativePath, error: '檔案已存在；請明確選擇覆寫。' }
  }
  const content = String(input.content || '')
  fs.mkdirSync(path.dirname(real), { recursive: true })
  fs.writeFileSync(real, content, 'utf8')
  return { ok: true, path: relativePath, bytes: Buffer.byteLength(content, 'utf8') }
}
