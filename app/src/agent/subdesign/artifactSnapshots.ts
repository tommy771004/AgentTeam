import { sha256Hex } from './pluginSnapshot.ts'

/**
 * Artifact revision snapshots（append-only）。每個 revision 的快照是檔案路徑
 * 與 sha256 的清單；還原以舊快照建立「新 revision」，歷史不可改寫。
 */
export type SubDesignArtifactSnapshotFile = {
  path: string
  sha256: string
}

export type SubDesignArtifactSnapshot = {
  revision: number
  createdAt: string
  files: SubDesignArtifactSnapshotFile[]
}

/** 以 artifactId 為鍵的快照索引。舊資料缺索引時視為無快照，restore 對其停用但不報錯。 */
export type SubDesignArtifactSnapshotIndex = Record<string, SubDesignArtifactSnapshot[]>

export const SUBDESIGN_SNAPSHOT_MAX_FILES = 60
const SAFE_PATH = /^(?!\/)(?!\.\.)(?!.*(^|\/)\.\.(?:\/|$))[a-zA-Z0-9._\-/]{1,600}$/

/** 快照本體（含內容）存放的 project-relative 根目錄。 */
export const SUBDESIGN_SNAPSHOT_ROOT = '.subagents/subdesign/snapshots'

export function isSafeSnapshotPath(value: string): boolean {
  return SAFE_PATH.test(value)
}

export function snapshotCopyPath(artifactId: string, revision: number, filePath: string): string {
  return `${SUBDESIGN_SNAPSHOT_ROOT}/${artifactId}/r${revision}/${filePath}`
}

export async function computeSnapshotFile(path: string, content: string): Promise<SubDesignArtifactSnapshotFile> {
  return { path, sha256: await sha256Hex(content) }
}

export function findSnapshot(
  index: SubDesignArtifactSnapshotIndex,
  artifactId: string,
  revision: number,
): SubDesignArtifactSnapshot | null {
  return index[artifactId]?.find((snapshot) => snapshot.revision === revision) || null
}

export function appendSnapshot(
  index: SubDesignArtifactSnapshotIndex,
  artifactId: string,
  snapshot: SubDesignArtifactSnapshot,
): SubDesignArtifactSnapshotIndex {
  const existing = index[artifactId] || []
  const next = [...existing.filter((item) => item.revision !== snapshot.revision), snapshot]
  // 每個 artifact 只保留最近 N 個快照，避免專案資料夾無限膨脹。
  return { ...index, [artifactId]: next.slice(-12) }
}

export type RevisionDiffFile = {
  path: string
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  rows: RevisionDiffRow[]
}

export type RevisionDiffLine = {
  lineNumber: number
  content: string
}

export type RevisionDiffRow = {
  kind: 'context' | 'added' | 'removed' | 'changed'
  left?: RevisionDiffLine
  right?: RevisionDiffLine
}

export type RevisionDiffResult = {
  revisionA: number
  revisionB: number
  files: RevisionDiffFile[]
}

type LineOperation = {
  kind: 'context' | 'added' | 'removed'
  left?: RevisionDiffLine
  right?: RevisionDiffLine
}

const MAX_LCS_CELLS = 4_000_000

function contentLines(content: string): string[] {
  if (!content) return []
  return content.replace(/\r\n?/g, '\n').split('\n')
}

function positionalLineOperations(left: string[], right: string[]): LineOperation[] {
  const rows: LineOperation[] = []
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftContent = left[index]
    const rightContent = right[index]
    if (leftContent !== undefined && rightContent !== undefined && leftContent === rightContent) {
      rows.push({
        kind: 'context',
        left: { lineNumber: index + 1, content: leftContent },
        right: { lineNumber: index + 1, content: rightContent },
      })
    } else {
      if (leftContent !== undefined) rows.push({ kind: 'removed', left: { lineNumber: index + 1, content: leftContent } })
      if (rightContent !== undefined) rows.push({ kind: 'added', right: { lineNumber: index + 1, content: rightContent } })
    }
  }
  return rows
}

function lcsLineOperations(left: string[], right: string[]): LineOperation[] {
  const columns = right.length + 1
  if ((left.length + 1) * columns > MAX_LCS_CELLS) return positionalLineOperations(left, right)
  const table = new Uint32Array((left.length + 1) * columns)
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const offset = leftIndex * columns + rightIndex
      table[offset] = left[leftIndex] === right[rightIndex]
        ? table[(leftIndex + 1) * columns + rightIndex + 1] + 1
        : Math.max(table[(leftIndex + 1) * columns + rightIndex], table[offset + 1])
    }
  }
  const operations: LineOperation[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      operations.push({
        kind: 'context',
        left: { lineNumber: leftIndex + 1, content: left[leftIndex] },
        right: { lineNumber: rightIndex + 1, content: right[rightIndex] },
      })
      leftIndex += 1
      rightIndex += 1
    } else if (table[(leftIndex + 1) * columns + rightIndex] >= table[leftIndex * columns + rightIndex + 1]) {
      operations.push({ kind: 'removed', left: { lineNumber: leftIndex + 1, content: left[leftIndex] } })
      leftIndex += 1
    } else {
      operations.push({ kind: 'added', right: { lineNumber: rightIndex + 1, content: right[rightIndex] } })
      rightIndex += 1
    }
  }
  while (leftIndex < left.length) {
    operations.push({ kind: 'removed', left: { lineNumber: leftIndex + 1, content: left[leftIndex] } })
    leftIndex += 1
  }
  while (rightIndex < right.length) {
    operations.push({ kind: 'added', right: { lineNumber: rightIndex + 1, content: right[rightIndex] } })
    rightIndex += 1
  }
  return operations
}

/** Pair one contiguous edit block into side-by-side rows suitable for the Studio. */
export function computeRevisionLineDiff(leftContent: string, rightContent: string): RevisionDiffRow[] {
  const operations = lcsLineOperations(contentLines(leftContent), contentLines(rightContent))
  const rows: RevisionDiffRow[] = []
  let index = 0
  while (index < operations.length) {
    const operation = operations[index]
    if (operation.kind === 'context') {
      rows.push(operation)
      index += 1
      continue
    }
    const removed: RevisionDiffLine[] = []
    const added: RevisionDiffLine[] = []
    while (index < operations.length && operations[index].kind !== 'context') {
      const edit = operations[index]
      if (edit.kind === 'removed' && edit.left) removed.push(edit.left)
      if (edit.kind === 'added' && edit.right) added.push(edit.right)
      index += 1
    }
    const paired = Math.min(removed.length, added.length)
    for (let pair = 0; pair < paired; pair += 1) {
      rows.push({ kind: 'changed', left: removed[pair], right: added[pair] })
    }
    for (const line of removed.slice(paired)) rows.push({ kind: 'removed', left: line })
    for (const line of added.slice(paired)) rows.push({ kind: 'added', right: line })
  }
  return rows
}

/**
 * 兩個 revision 的逐檔差異。以快照索引中的 sha256 比對（快照本體目錄保存
 * 兩份歷史內容），先回傳逐檔狀態；store 再從快照副本補上行級內容。
 */
export function computeRevisionDiff(
  index: SubDesignArtifactSnapshotIndex,
  artifactId: string,
  revisionA: number,
  revisionB: number,
): RevisionDiffResult {
  const snapshotA = findSnapshot(index, artifactId, revisionA)
  const snapshotB = findSnapshot(index, artifactId, revisionB)
  if (!snapshotA || !snapshotB) throw new Error('這個 revision 沒有快照，無法比較。')
  const files = new Map<string, RevisionDiffFile>()
  const shaByPathA = new Map(snapshotA.files.map((file) => [file.path, file.sha256]))
  for (const file of snapshotB.files) {
    const shaA = shaByPathA.get(file.path)
    if (shaA == null) files.set(file.path, { path: file.path, status: 'added', rows: [] })
    else files.set(file.path, { path: file.path, status: shaA === file.sha256 ? 'unchanged' : 'changed', rows: [] })
  }
  for (const file of snapshotA.files) {
    if (!files.has(file.path)) files.set(file.path, { path: file.path, status: 'removed', rows: [] })
  }
  return {
    revisionA,
    revisionB,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  }
}
