import { constants } from 'node:fs'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, relative } from 'node:path'
import type { InstructionSnapshot } from './instructionResolver.ts'

export type InstructionSourceOpenFailureCode =
  | 'invalid_path'
  | 'missing'
  | 'unsafe_source'
  | 'not_current_source'
  | 'stale_source'
  | 'unreadable'
  | 'open_failed'

export class InstructionSourceOpenError extends Error {
  readonly code: InstructionSourceOpenFailureCode
  readonly cause?: unknown

  constructor(code: InstructionSourceOpenFailureCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'InstructionSourceOpenError'
    this.code = code
    this.cause = cause
  }
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function within(root: string, target: string): boolean {
  const relation = relative(root, target)
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

export type OpenInstructionSourceInput = {
  projectRoot: string
  workPath?: string
  path: string
  resolveCurrent: (input: { projectRoot: string; workPath?: string }) => Promise<InstructionSnapshot>
  shellOpen: (canonicalPath: string) => Promise<string>
}

/**
 * Open only a source proven by a fresh Host projection.  The file is
 * canonicalized and reread immediately before shell handoff so a stale or
 * symlink-swapped renderer path cannot escape the current project boundary.
 */
export async function openInstructionSource(input: OpenInstructionSourceInput): Promise<{ ok: true; path: string }> {
  if (!input.projectRoot || !input.path || !isAbsolute(input.path)) {
    throw new InstructionSourceOpenError('invalid_path', 'instruction source path 必須是絕對路徑。')
  }
  let canonicalRoot: string
  let canonicalTarget: string
  try {
    canonicalRoot = await realpath(input.projectRoot)
  } catch (error) {
    throw new InstructionSourceOpenError('missing', '目前 project root 不存在。', error)
  }
  try {
    canonicalTarget = await realpath(input.path)
  } catch (error) {
    throw new InstructionSourceOpenError('missing', 'instruction source 已不存在。', error)
  }
  if (!within(canonicalRoot, canonicalTarget)) {
    throw new InstructionSourceOpenError('unsafe_source', 'instruction source 不在目前 canonical project boundary 內。')
  }

  let snapshot: InstructionSnapshot
  try {
    snapshot = await input.resolveCurrent({ projectRoot: input.projectRoot, workPath: input.workPath || input.projectRoot })
  } catch (error) {
    throw new InstructionSourceOpenError('not_current_source', '目前 Host projection 無法重新取得，請重新掃描後再開啟 source。', error)
  }
  if (snapshot.projectIdentity !== canonicalRoot) {
    throw new InstructionSourceOpenError('not_current_source', 'project projection 已切換，請重新掃描後再開啟 source。')
  }
  const source = snapshot.sources.find((candidate) => candidate.scope === 'project' && candidate.path === canonicalTarget)
  if (!source) throw new InstructionSourceOpenError('not_current_source', 'source 不在目前 Host projection 中。')
  if (!source.openable || source.metadataStatus !== 'content') {
    throw new InstructionSourceOpenError('unreadable', 'source metadata 尚未證明檔案可安全讀取。')
  }

  let body: string
  try {
    await access(canonicalTarget, constants.R_OK)
    const info = await stat(canonicalTarget)
    if (!info.isFile()) throw new Error('source 不是一般檔案。')
    body = await readFile(canonicalTarget, 'utf8')
  } catch (error) {
    throw new InstructionSourceOpenError('unreadable', 'instruction source 無法讀取。', error)
  }
  if (hash(body) !== source.hash || Buffer.byteLength(body) !== source.bytes) {
    throw new InstructionSourceOpenError('stale_source', 'instruction source 在 projection 後已變更，請重新掃描。')
  }
  let shellError: string
  try {
    shellError = await input.shellOpen(canonicalTarget)
  } catch (error) {
    throw new InstructionSourceOpenError('open_failed', '系統編輯器無法開啟 instruction source。', error)
  }
  if (shellError) throw new InstructionSourceOpenError('open_failed', shellError)
  return { ok: true, path: canonicalTarget }
}
