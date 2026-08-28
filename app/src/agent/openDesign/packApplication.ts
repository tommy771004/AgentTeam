import type { OpenDesignCatalogRecord } from './catalog.ts'
import {
  createOpenDesignContentPack,
  openDesignPackId,
  type OpenDesignContentPackManifest,
  type OpenDesignPackAuditEvent,
} from './packs.ts'

export type OpenDesignPackCopyResult = { ok: true; path: string } | { ok: false; error?: string }

export type OpenDesignPackApplicationDependencies = {
  copyToProject: (input: {
    sourcePath: string
    assetPaths: string[]
    targetId: string
    digest: string
    kind: OpenDesignContentPackManifest['kind']
    projectRoot: string
  }) => Promise<OpenDesignPackCopyResult>
  persistCanonical: (pack: OpenDesignContentPackManifest, projectRoot: string) => Promise<boolean>
  commitProjection: (pack: OpenDesignContentPackManifest) => void
  appendAudit: (event: OpenDesignPackAuditEvent) => void
  now?: () => string
}

export type OpenDesignPackApplicationResult =
  | { ok: true; pack: OpenDesignContentPackManifest; projectOwnedPath: string }
  | { ok: false; packId: string; reason: string }

function validateApplication(record: OpenDesignCatalogRecord, projectRoot: string): string | null {
  if (!projectRoot.trim()) return 'Open Design pack 需要作用中的 project root。'
  if (!/^[a-f0-9]{16,128}$/i.test(record.digest)) return 'Open Design catalog digest 不合法。'
  if (!record.assetPaths.length) return 'Open Design pack 沒有可套用的 assets。'
  if (record.executionStatus === 'invalid') return 'Open Design catalog 將此 pack 標記為 invalid。'
  return null
}

/**
 * The catalog-record-to-project transition. Projection changes happen only
 * after Electron copy and canonical metadata both succeed, so an interrupted
 * install is recoverable and never advertised as installed.
 */
export async function applyOpenDesignPack(input: {
  record: OpenDesignCatalogRecord
  projectRoot: string
  existing?: OpenDesignContentPackManifest | null
  dependencies: OpenDesignPackApplicationDependencies
}): Promise<OpenDesignPackApplicationResult> {
  const { record, dependencies } = input
  const packId = openDesignPackId(record)
  const reject = (reason: string): OpenDesignPackApplicationResult => {
    dependencies.appendAudit({ at: dependencies.now?.() || new Date().toISOString(), action: 'reject', packId, digest: record.digest, reason })
    return { ok: false, packId, reason }
  }
  const invalid = validateApplication(record, input.projectRoot)
  if (invalid) return reject(invalid)
  try {
    const copied = await dependencies.copyToProject({
      sourcePath: record.sourcePath,
      assetPaths: [...record.assetPaths],
      targetId: packId,
      digest: record.digest,
      kind: record.kind,
      projectRoot: input.projectRoot,
    })
    if (!copied.ok) return reject(copied.error || '無法複製 Open Design project-owned pack。')
    if (!copied.path.startsWith('.subagents/subdesign/vendor-packs/')) return reject('Electron 回傳的 project-owned path 不合法。')

    const created = createOpenDesignContentPack(record)
    const pack: OpenDesignContentPackManifest = {
      ...(input.existing?.digest === created.digest ? input.existing : created),
      enabled: input.existing?.digest === created.digest ? input.existing.enabled : false,
      sourcePath: record.sourcePath,
      assetPaths: [...record.assetPaths],
      licensePaths: [...record.licensePaths],
      entryPaths: [...record.entryPaths],
      projectPath: copied.path,
      installedAt: dependencies.now?.() || created.installedAt,
    }
    if (!await dependencies.persistCanonical(pack, input.projectRoot)) {
      return reject('Open Design canonical metadata 寫入失敗；未套用本機 projection。')
    }
    dependencies.commitProjection(pack)
    dependencies.appendAudit({ at: dependencies.now?.() || new Date().toISOString(), action: 'install', packId, digest: pack.digest })
    return { ok: true, pack, projectOwnedPath: copied.path }
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error))
  }
}
