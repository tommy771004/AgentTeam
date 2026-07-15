import type { SubDesignArtifact, SubDesignBrief, SubDesignBriefPatch, SubDesignDirection, SubDesignStage } from './types'

export type SubDesignMetadataSnapshot = {
  briefs: unknown[]
  artifacts: unknown[]
  critiques: unknown[]
  exports: unknown[]
  openDesignPacks: unknown[]
}

function api() {
  return typeof window === 'undefined' ? undefined : window.subagents?.subdesign
}

export async function readSubDesignMetadata(projectRoot?: string): Promise<SubDesignMetadataSnapshot | null> {
  const result = await api()?.readMetadata?.(projectRoot)
  if (!result?.ok) return null
  return {
    briefs: Array.isArray(result.briefs) ? result.briefs : [],
    artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
    critiques: Array.isArray(result.critiques) ? result.critiques : [],
    exports: Array.isArray(result.exports) ? result.exports : [],
    openDesignPacks: Array.isArray(result.openDesignPacks) ? result.openDesignPacks : [],
  }
}

export function persistSubDesignBriefCreate(brief: SubDesignBrief, projectRoot?: string): void {
  void api()?.createBrief?.({ brief, threadId: brief.threadId, projectRoot })
}

export function persistSubDesignBriefPatch(briefId: string, patch: SubDesignBriefPatch, threadId: string, projectRoot?: string): void {
  void api()?.updateBrief?.({ briefId, patch, threadId, projectRoot })
}

export function persistSubDesignBriefDirection(
  briefId: string,
  directionId: string,
  fallback: Partial<SubDesignDirection> | undefined,
  threadId: string,
  projectRoot?: string,
): void {
  void api()?.selectDirection?.({ briefId, directionId, fallback, threadId, projectRoot })
}

export function persistSubDesignBriefStage(briefId: string, stage: SubDesignStage, threadId: string, projectRoot?: string): void {
  void api()?.setBriefStage?.({ briefId, stage, threadId, projectRoot })
}

export function persistSubDesignArtifact(artifact: SubDesignArtifact, projectRoot?: string): void {
  void api()?.registerArtifact?.({ artifact, briefId: artifact.briefId, designSystemId: artifact.designSystemId, projectRoot })
}

export function persistOpenDesignPack(pack: unknown, projectRoot?: string): void {
  void api()?.recordOpenDesignPack?.({ pack, projectRoot })
}
