import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique, SubDesignExportRecord } from './types.ts'
import type { OpenDesignContentPackManifest } from '../openDesign/packs.ts'
import type { PluginResolvedSnapshot } from './pluginSnapshot.ts'
import type { SubDesignPluginExecutionProjection } from './pluginExecution.ts'
import type { ChromeDevToolsProviderSettings, ExperimentalSurfaceSettings, HarnessProviderSettings, StorybookProviderSettings } from './providers/providerSettings.ts'

import type { SubDesignPinnedCommentAuditRecord } from './pinnedComments.ts'
import type { SubDesignMetadataKind } from './metadataKinds.ts'

export { SUBDESIGN_METADATA_KINDS, isSubDesignMetadataKind, type SubDesignMetadataKind } from './metadataKinds.ts'

export type SubDesignMetadataSnapshot = {
  briefs: unknown[]
  artifacts: unknown[]
  critiques: unknown[]
  exports: unknown[]
  openDesignPacks: unknown[]
  openDesignSnapshots: unknown[]
  openDesignProviderSettings: unknown[]
  openDesignProviderRuns: unknown[]
}

type MetadataPayload = SubDesignBrief | SubDesignArtifact | SubDesignCritique | SubDesignExportRecord | OpenDesignContentPackManifest | PluginResolvedSnapshot | StorybookProviderSettings | ChromeDevToolsProviderSettings | HarnessProviderSettings | ExperimentalSurfaceSettings | SubDesignPluginExecutionProjection | SubDesignPinnedCommentAuditRecord

export async function readSubDesignMetadata(projectRoot?: string): Promise<SubDesignMetadataSnapshot | null> {
  const api = typeof window === 'undefined' ? undefined : window.subagents?.subdesign
  if (!api?.readMetadata) return null
  const result = await api.readMetadata(projectRoot)
  if (!result.ok) return null
  return {
    briefs: Array.isArray(result.briefs) ? result.briefs : [],
    artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
    critiques: Array.isArray(result.critiques) ? result.critiques : [],
    exports: Array.isArray(result.exports) ? result.exports : [],
    openDesignPacks: Array.isArray(result.openDesignPacks) ? result.openDesignPacks : [],
    openDesignSnapshots: Array.isArray(result.openDesignSnapshots) ? result.openDesignSnapshots : [],
    openDesignProviderSettings: Array.isArray(result.openDesignProviderSettings) ? result.openDesignProviderSettings : [],
    openDesignProviderRuns: Array.isArray(result.openDesignProviderRuns) ? result.openDesignProviderRuns : [],
  }
}

export async function persistSubDesignMetadata(kind: SubDesignMetadataKind, payload: MetadataPayload, projectRoot?: string): Promise<boolean> {
  const api = typeof window === 'undefined' ? undefined : window.subagents?.subdesign
  if (!projectRoot || !api?.writeMetadata) return false
  try {
    const result = await api.writeMetadata({ kind, payload, projectRoot })
    return result.ok
  } catch {
    return false
  }
}
