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
}

export type RevisionDiffResult = {
  revisionA: number
  revisionB: number
  files: RevisionDiffFile[]
}

/**
 * 兩個 revision 的逐檔差異。以快照索引中的 sha256 比對（快照本體目錄保存
 * 兩份歷史內容），回傳 UI-ready 的結構化差異；行級檢視由 UI 以 path 讀取。
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
    if (shaA == null) files.set(file.path, { path: file.path, status: 'added' })
    else files.set(file.path, { path: file.path, status: shaA === file.sha256 ? 'unchanged' : 'changed' })
  }
  for (const file of snapshotA.files) {
    if (!files.has(file.path)) files.set(file.path, { path: file.path, status: 'removed' })
  }
  return {
    revisionA,
    revisionB,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  }
}
