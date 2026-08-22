import { create } from 'zustand'
import {
  appendSnapshot,
  computeRevisionDiff,
  computeRevisionLineDiff,
  computeSnapshotFile,
  findSnapshot,
  isSafeSnapshotPath,
  snapshotCopyPath,
  SUBDESIGN_SNAPSHOT_MAX_FILES,
  type SubDesignArtifactSnapshotIndex,
} from '../agent/subdesign/artifactSnapshots.ts'
import { validateSubDesignArtifactManifest } from '../agent/subdesign/artifactManifest.ts'
import { persistSubDesignMetadata } from '../agent/subdesign/metadata.ts'
import type { SubDesignArtifact } from '../agent/subdesign/types.ts'

const STORAGE_KEY = 'subagents.subdesign.artifacts.v1'
const SNAPSHOT_STORAGE_KEY = 'subagents.subdesign.artifact-snapshots.v1'

function loadArtifacts(): SubDesignArtifact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const result = validateSubDesignArtifactManifest(item)
        return result.ok ? result.manifest : null
      })
      .filter((item): item is SubDesignArtifact => Boolean(item))
      .slice(0, 80)
  } catch {
    return []
  }
}

function loadSnapshots(): SubDesignArtifactSnapshotIndex {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as SubDesignArtifactSnapshotIndex
  } catch {
    return {}
  }
}

function persist(artifacts: SubDesignArtifact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(artifacts.slice(0, 80)))
  } catch {
    /* localStorage is optional in browser preview. */
  }
}

function persistSnapshots(snapshots: SubDesignArtifactSnapshotIndex) {
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots))
  } catch {
    /* localStorage is optional in browser preview. */
  }
}

function workspaceTools() {
  return typeof window === 'undefined' ? undefined : window.subagents?.tools
}

export type SnapshotResult = { ok: true; files: number } | { ok: false; reason: string }
export type RestoreResult = { ok: true; artifact: SubDesignArtifact } | { ok: false; errors: string[] }

interface SubDesignArtifactStore {
  artifacts: SubDesignArtifact[]
  snapshots: SubDesignArtifactSnapshotIndex
  projectRoot: string
  setProjectRoot: (root: string) => void
  hydrateCanonical: (items: unknown[]) => void
  register: (input: unknown, defaults?: { briefId?: string }, projectRoot?: string) =>
    | { ok: true; artifact: SubDesignArtifact }
    | { ok: false; errors: string[] }
  remove: (id: string) => void
  findByBriefId: (briefId: string) => SubDesignArtifact[]
  findById: (id: string) => SubDesignArtifact | null
  captureSnapshot: (artifactId: string, projectRoot?: string) => Promise<SnapshotResult>
  diffRevisions: (artifactId: string, revisionA: number, revisionB: number, projectRoot?: string) => Promise<
    | { ok: true; diff: ReturnType<typeof computeRevisionDiff> }
    | { ok: false; reason: string }
  >
  restoreRevision: (artifactId: string, revision: number, projectRoot?: string) => Promise<RestoreResult>
}

export const useSubDesignArtifactStore = create<SubDesignArtifactStore>((set, get) => ({
  artifacts: loadArtifacts(),
  snapshots: loadSnapshots(),
  projectRoot: '',

  setProjectRoot: (root) => set({ projectRoot: root }),

  hydrateCanonical: (items) => {
    const artifacts = items
      .map((item) => {
        const result = validateSubDesignArtifactManifest(item)
        return result.ok ? result.manifest : null
      })
      .filter((item): item is SubDesignArtifact => Boolean(item))
      .slice(0, 80)
    set({ artifacts })
    persist(artifacts)
  },

  register: (input, defaults, projectRoot) => {
    const result = validateSubDesignArtifactManifest(input, defaults)
    if (!result.ok) return result
    const existing = get().artifacts.find((item) => item.id === result.manifest.id)
    const artifact = existing
      ? { ...result.manifest, createdAt: existing.createdAt, revision: Math.max(existing.revision + 1, result.manifest.revision), updatedAt: new Date().toISOString() }
      : result.manifest
    const artifacts = [artifact, ...get().artifacts].slice(0, 80)
    set({ artifacts })
    persist(artifacts)
    persistSubDesignMetadata('artifact', artifact, projectRoot || get().projectRoot)
    // Register 成功即自動快照（fire-and-forget）；無 workspace API 時靜默略過。
    void get().captureSnapshot(artifact.id, projectRoot || get().projectRoot)
    return { ok: true, artifact }
  },

  remove: (id) => {
    const artifacts = get().artifacts.filter((item) => item.id !== id)
    set({ artifacts })
    persist(artifacts)
  },

  findByBriefId: (briefId) => get().artifacts.filter((item) => item.briefId === briefId),

  findById: (id) => get().artifacts.find((item) => item.id === id) || null,

  captureSnapshot: async (artifactId, projectRoot) => {
    const artifact = get().findById(artifactId)
    if (!artifact) return { ok: false, reason: `找不到 artifact：${artifactId}` }
    const api = workspaceTools()
    if (!api?.workspaceRead || !api?.workspaceWrite) return { ok: false, reason: '快照需要 Electron workspace API。' }
    const paths = [artifact.entry, ...artifact.supportingFiles].filter(isSafeSnapshotPath).slice(0, SUBDESIGN_SNAPSHOT_MAX_FILES)
    const files = []
    for (const filePath of paths) {
      const result = await api.workspaceRead(filePath, projectRoot)
      if (!result.ok || typeof result.content !== 'string') continue
      // 快照本體（內容）寫入 project-relative 目錄；restore/diff 由此讀取歷史內容。
      const copyPath = snapshotCopyPath(artifact.id, artifact.revision, filePath)
      const copied = await api.workspaceWrite(copyPath, result.content, projectRoot)
      if (!copied.ok) return { ok: false, reason: `快照寫入失敗：${copyPath} ${copied.error || ''}` }
      files.push(await computeSnapshotFile(filePath, result.content))
    }
    if (!files.some((file) => file.path === artifact.entry)) {
      return { ok: false, reason: `快照無法讀取 entry：${artifact.entry}` }
    }
    const snapshot = { revision: artifact.revision, createdAt: new Date().toISOString(), files }
    const snapshots = appendSnapshot(get().snapshots, artifactId, snapshot)
    set({ snapshots })
    persistSnapshots(snapshots)
    return { ok: true, files: files.length }
  },

  restoreRevision: async (artifactId, revision, projectRoot) => {
    const artifact = get().findById(artifactId)
    if (!artifact) return { ok: false, errors: [`找不到 artifact：${artifactId}`] }
    const snapshot = findSnapshot(get().snapshots, artifactId, revision)
    if (!snapshot) return { ok: false, errors: ['這個 revision 沒有快照，無法還原。'] }
    const api = workspaceTools()
    if (!api?.workspaceRead || !api?.workspaceWrite) return { ok: false, errors: ['還原需要 Electron workspace API。'] }
    for (const file of snapshot.files) {
      // 從快照本體讀回該 revision 的歷史內容，再寫回原始路徑。
      const historical = await api.workspaceRead(snapshotCopyPath(artifactId, revision, file.path), projectRoot)
      if (!historical.ok || typeof historical.content !== 'string') {
        return { ok: false, errors: [`快照內容遺失：${file.path}`] }
      }
      const write = await api.workspaceWrite(file.path, historical.content, projectRoot)
      if (!write.ok) return { ok: false, errors: [`還原寫入失敗：${file.path} ${write.error || ''}`] }
    }
    const result = get().register(
      {
        ...artifact,
        revision: undefined,
        status: artifact.status === 'streaming' ? 'complete' : artifact.status,
      },
      { briefId: artifact.briefId },
      projectRoot,
    )
    if (!result.ok) return result
    return { ok: true, artifact: result.artifact }
  },

  diffRevisions: async (artifactId, revisionA, revisionB, projectRoot) => {
    try {
      const diff = computeRevisionDiff(get().snapshots, artifactId, revisionA, revisionB)
      const snapshotA = findSnapshot(get().snapshots, artifactId, revisionA)
      const snapshotB = findSnapshot(get().snapshots, artifactId, revisionB)
      if (!snapshotA || !snapshotB) return { ok: false, reason: '這個 revision 沒有快照，無法比較。' }
      const api = workspaceTools()
      if (!api?.workspaceRead) return { ok: false, reason: '版本比較需要 Electron workspace API。' }
      const pathsA = new Set(snapshotA.files.map((file) => file.path))
      const pathsB = new Set(snapshotB.files.map((file) => file.path))
      const readHistorical = async (revision: number, filePath: string): Promise<string> => {
        const historical = await api.workspaceRead(snapshotCopyPath(artifactId, revision, filePath), projectRoot || get().projectRoot)
        if (!historical.ok || typeof historical.content !== 'string') {
          throw new Error(`快照內容遺失：${filePath}（revision ${revision}）`)
        }
        return historical.content
      }
      const files = []
      for (const file of diff.files) {
        if (file.status === 'unchanged') {
          files.push(file)
          continue
        }
        const [leftContent, rightContent] = await Promise.all([
          pathsA.has(file.path) ? readHistorical(revisionA, file.path) : Promise.resolve(''),
          pathsB.has(file.path) ? readHistorical(revisionB, file.path) : Promise.resolve(''),
        ])
        files.push({
          ...file,
          rows: computeRevisionLineDiff(leftContent, rightContent),
        })
      }
      return { ok: true, diff: { ...diff, files } }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  },
}))
