import { readSubDesignMetadata } from '../agent/subdesign/metadata'
import { useSubDesignArtifactStore } from './subDesignArtifactStore'
import { useSubDesignCritiqueStore } from './subDesignCritiqueStore'
import { useSubDesignExportStore } from './subDesignExportStore'
import { useSubDesignStore } from './subDesignStore'

/** Hydrate all SubDesign caches from the project-scoped canonical metadata files. */
export async function hydrateSubDesignStores(projectRoot?: string): Promise<void> {
  if (!projectRoot) return
  const snapshot = await readSubDesignMetadata(projectRoot)
  if (!snapshot) return
  useSubDesignStore.getState().setProjectRoot(projectRoot)
  useSubDesignArtifactStore.getState().setProjectRoot(projectRoot)
  useSubDesignCritiqueStore.getState().setProjectRoot(projectRoot)
  useSubDesignExportStore.getState().setProjectRoot(projectRoot)
  useSubDesignStore.getState().hydrateCanonical(snapshot.briefs)
  useSubDesignArtifactStore.getState().hydrateCanonical(snapshot.artifacts)
  useSubDesignCritiqueStore.getState().hydrateCanonical(snapshot.critiques)
  useSubDesignExportStore.getState().hydrateCanonical(snapshot.exports)
}
