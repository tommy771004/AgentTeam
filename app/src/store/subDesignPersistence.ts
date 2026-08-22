import { readSubDesignMetadata } from '../agent/subdesign/metadata.ts'
import { useOpenDesignPackStore } from './openDesignPackStore.ts'
import { useSubDesignArtifactStore } from './subDesignArtifactStore.ts'
import { useSubDesignCritiqueStore } from './subDesignCritiqueStore.ts'
import { useSubDesignExportStore } from './subDesignExportStore.ts'
import { useSubDesignStore } from './subDesignStore.ts'

/** Hydrate all SubDesign caches from the project-scoped canonical metadata files. */
export async function hydrateSubDesignStores(
  projectRoot?: string,
  options: { isCurrent?: () => boolean } = {},
): Promise<void> {
  const isCurrent = options.isCurrent || (() => true)
  if (!projectRoot || !isCurrent()) return
  const snapshot = await readSubDesignMetadata(projectRoot)
  if (!snapshot || !isCurrent()) return
  useSubDesignStore.getState().setProjectRoot(projectRoot)
  useSubDesignArtifactStore.getState().setProjectRoot(projectRoot)
  useSubDesignCritiqueStore.getState().setProjectRoot(projectRoot)
  useSubDesignExportStore.getState().setProjectRoot(projectRoot)
  useOpenDesignPackStore.getState().setProjectRoot(projectRoot)
  useSubDesignStore.getState().hydrateCanonical(snapshot.briefs)
  useSubDesignArtifactStore.getState().hydrateCanonical(snapshot.artifacts)
  useSubDesignCritiqueStore.getState().hydrateCanonical(snapshot.critiques)
  useSubDesignExportStore.getState().hydrateCanonical(snapshot.exports)
  useOpenDesignPackStore.getState().hydrateCanonical(snapshot.openDesignPacks)
}
