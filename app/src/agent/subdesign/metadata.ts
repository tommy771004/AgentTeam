import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique, SubDesignExportRecord } from './types'

export type SubDesignMetadataKind = 'brief' | 'artifact' | 'critique' | 'export'

export type SubDesignMetadataSnapshot = {
  briefs: unknown[]
  artifacts: unknown[]
  critiques: unknown[]
  exports: unknown[]
}

type MetadataPayload = SubDesignBrief | SubDesignArtifact | SubDesignCritique | SubDesignExportRecord

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
  }
}

export function persistSubDesignMetadata(kind: SubDesignMetadataKind, payload: MetadataPayload, projectRoot?: string): void {
  const api = typeof window === 'undefined' ? undefined : window.subagents?.subdesign
  if (!projectRoot || !api?.writeMetadata) return
  void api.writeMetadata({ kind, payload, projectRoot })
}
