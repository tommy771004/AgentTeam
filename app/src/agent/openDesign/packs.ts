import type { PluginManifest } from '../hermes/plugins.ts'
import type { OpenDesignCatalogRecord, OpenDesignExecutionStatus } from './catalog.ts'

export type OpenDesignPackKind = 'template' | 'skill' | 'design-system' | 'prompt' | 'craft' | 'media'
export type OpenDesignTrustState = 'bundled' | 'community-reviewed' | 'local-user' | 'remote-unverified'

export type OpenDesignContentPackManifest = {
  id: string
  name: string
  version: string
  kind: OpenDesignPackKind
  enabled: boolean
  trustState: OpenDesignTrustState
  sourcePath: string
  sourceUrl: string
  upstreamCommit: string
  digest: string
  licensePaths: string[]
  assetPaths: string[]
  entryPaths: string[]
  executionStatus: OpenDesignExecutionStatus
  installedAt: string
  projectPath?: string
  /** Explicitly absent by design: vendor content cannot inject JS hooks. */
  customTools: []
  mcpServers: []
}

export type OpenDesignPackAuditEvent = {
  at: string
  action: 'install' | 'enable' | 'disable' | 'uninstall' | 'reindex' | 'reject'
  packId: string
  digest?: string
  reason?: string
}

export function openDesignPackId(record: OpenDesignCatalogRecord): string {
  return `open-design:${record.id}`.slice(0, 220)
}

export function createOpenDesignContentPack(record: OpenDesignCatalogRecord): OpenDesignContentPackManifest {
  return {
    id: openDesignPackId(record),
    name: record.title,
    version: record.upstreamCommit,
    kind: record.kind,
    enabled: false,
    trustState: 'bundled',
    sourcePath: record.sourcePath,
    sourceUrl: record.sourceUrl,
    upstreamCommit: record.upstreamCommit,
    digest: record.digest,
    licensePaths: [...record.licensePaths],
    assetPaths: [...record.assetPaths],
    entryPaths: [...record.entryPaths],
    executionStatus: record.executionStatus,
    installedAt: new Date().toISOString(),
    customTools: [],
    mcpServers: [],
  }
}

export function normalizeOpenDesignContentPack(value: unknown): OpenDesignContentPackManifest | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const sourcePath = typeof raw.sourcePath === 'string' ? raw.sourcePath.trim() : ''
  const digest = typeof raw.digest === 'string' ? raw.digest.trim() : ''
  if (!id.startsWith('open-design:') || !name || !sourcePath || !digest) return null
  const kind = raw.kind
  if (!['template', 'skill', 'design-system', 'prompt', 'craft', 'media'].includes(String(kind))) return null
  const trustState = raw.trustState
  if (!['bundled', 'community-reviewed', 'local-user', 'remote-unverified'].includes(String(trustState))) return null
  return {
    id: id.slice(0, 220),
    name: name.slice(0, 180),
    version: typeof raw.version === 'string' ? raw.version.slice(0, 80) : 'unknown',
    kind: kind as OpenDesignPackKind,
    enabled: raw.enabled === true,
    trustState: trustState as OpenDesignTrustState,
    sourcePath: sourcePath.replaceAll('\\', '/').replace(/^\.\//, ''),
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl.slice(0, 500) : '',
    upstreamCommit: typeof raw.upstreamCommit === 'string' ? raw.upstreamCommit.slice(0, 80) : '',
    digest: digest.slice(0, 128),
    licensePaths: cleanPaths(raw.licensePaths),
    assetPaths: cleanPaths(raw.assetPaths, 240),
    entryPaths: cleanPaths(raw.entryPaths, 32),
    executionStatus: ['ready', 'content-only', 'invalid'].includes(String(raw.executionStatus))
      ? (raw.executionStatus as OpenDesignExecutionStatus)
      : 'content-only',
    installedAt: typeof raw.installedAt === 'string' ? raw.installedAt.slice(0, 40) : '',
    projectPath: typeof raw.projectPath === 'string' ? raw.projectPath.slice(0, 600) : undefined,
    customTools: [],
    mcpServers: [],
  }
}

function cleanPaths(value: unknown, max = 32): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replaceAll('\\', '/').replace(/^\.\//, '').trim())
    .filter((item) => item && !item.startsWith('/') && !item.includes('..')))]
    .slice(0, max)
}

/** Convert a skill pack to the existing declarative plugin boundary. */
export function openDesignSkillPlugin(
  pack: OpenDesignContentPackManifest,
  skillPath: string,
  rawSkill: string,
): PluginManifest {
  return {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    enabled: pack.enabled,
    description: `Open Design skill（${pack.sourcePath}）`,
    installedAt: pack.installedAt,
    source: `open-design:${pack.upstreamCommit}:${pack.digest}`,
    skills: [{ path: skillPath, raw: rawSkill.slice(0, 512_000) }],
    openDesign: {
      packId: pack.id,
      digest: pack.digest,
      trustState: pack.trustState,
      licensePaths: pack.licensePaths,
    },
  }
}

export function packMayEnable(pack: OpenDesignContentPackManifest): { ok: true } | { ok: false; reason: string } {
  if (pack.trustState === 'remote-unverified') return { ok: false, reason: 'remote-unverified pack 預設停用，需先完成人工信任審核。' }
  if (pack.executionStatus === 'invalid') return { ok: false, reason: 'pack inventory 標記為 invalid，不能啟用。' }
  if (pack.kind !== 'skill') return { ok: true }
  return { ok: true }
}
