import { persistSubDesignMetadata, readSubDesignMetadata } from './metadata.ts'
import {
  SNAPSHOT_VERSION,
  snapshotContainsNoRawToken,
  type PluginResolvedSnapshot,
} from './pluginSnapshot.ts'

function isPluginResolvedSnapshot(value: unknown): value is PluginResolvedSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<PluginResolvedSnapshot>
  return snapshot.version === SNAPSHOT_VERSION
    && typeof snapshot.snapshotId === 'string'
    && typeof snapshot.pluginId === 'string'
    && typeof snapshot.contentHash === 'string'
    && typeof snapshot.capabilityFingerprint === 'string'
    && Array.isArray(snapshot.requestedCapabilities)
    && Array.isArray(snapshot.grantedCapabilities)
    && Array.isArray(snapshot.grantDecisions)
    && typeof snapshot.projectRelativePath === 'string'
    && snapshotContainsNoRawToken(snapshot as PluginResolvedSnapshot)
}

export async function persistPluginSnapshot(snapshot: PluginResolvedSnapshot, projectRoot?: string): Promise<boolean> {
  if (!projectRoot) return false
  if (!isPluginResolvedSnapshot(snapshot)) throw new Error('OpenDesign snapshot 格式不合法。')
  return persistSubDesignMetadata('open-design-snapshot', snapshot, projectRoot)
}

export async function loadPluginSnapshots(projectRoot?: string): Promise<PluginResolvedSnapshot[]> {
  const metadata = await readSubDesignMetadata(projectRoot)
  if (!metadata) return []
  return metadata.openDesignSnapshots.filter(isPluginResolvedSnapshot)
}

export async function findPluginSnapshot(pluginId: string, projectRoot?: string): Promise<PluginResolvedSnapshot | null> {
  const snapshots = await loadPluginSnapshots(projectRoot)
  return snapshots.find((snapshot) => snapshot.pluginId === pluginId) ?? null
}
