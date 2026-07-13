import type { MemoryEntry } from '../hermes/types'
import type { SubDesignArtifact, SubDesignBrief, SubDesignCritique, SubDesignPlatform, SubDesignSurface } from './types'

export type SubDesignPreference = Pick<
  SubDesignBrief,
  'surface' | 'platform' | 'designSystemId' | 'templateId' | 'skillIds' | 'provenance' | 'selectedDirectionId'
> & {
  briefId: string
  artifactId: string
  updatedAt: string
}

export function subDesignProjectMemoryKey(projectRoot?: string): string {
  const source = projectRoot?.trim() || 'workspace'
  let hash = 2166136261
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `project-${(hash >>> 0).toString(16)}`
}

function parseMemoryPreference(entry: MemoryEntry, projectRoot?: string): SubDesignPreference | null {
  const projectKey = subDesignProjectMemoryKey(projectRoot)
  if (!entry.tags?.includes('subdesign-preference') || !entry.tags.includes(projectKey)) return null
  const details = entry.text.match(/^SubDesign 偏好\([^)]*\)：(.+?)。這是/)?.[1]
  if (!details) return null
  const values = Object.fromEntries(
    details.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=')
      return [key, rest.join('=').trim()]
    }).filter(([key, value]) => Boolean(key && value)),
  ) as Record<string, string>
  const surface = values.surface as SubDesignSurface
  const platform = values.platform as SubDesignPlatform | undefined
  if (!['prototype', 'dashboard', 'design-system', 'deck'].includes(surface)) return null
  if (platform && !['responsive', 'web-desktop', 'mobile-ios', 'desktop-app'].includes(platform)) return null
  return {
    briefId: `memory:${entry.id}`,
    artifactId: `memory:${entry.id}`,
    surface,
    platform,
    designSystemId: values.designSystem || undefined,
    templateId: values.template || undefined,
    selectedDirectionId: values.direction || undefined,
    updatedAt: entry.createdAt,
  }
}

/**
 * Find the latest critique-passed artifact for this project. A pass only counts
 * while its revision still matches the current artifact revision, so a patch
 * automatically removes the old preference from the default candidates.
 */
export function findLatestPassedSubDesignPreference(
  briefs: SubDesignBrief[],
  artifacts: SubDesignArtifact[],
  critiques: SubDesignCritique[],
  options?: { projectRoot?: string; memoryEntries?: MemoryEntry[] },
): SubDesignPreference | null {
  const briefById = new Map(briefs.map((brief) => [brief.id, brief]))
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const latestCritiqueByArtifact = new Map<string, SubDesignCritique>()
  for (const critique of critiques) {
    const previous = latestCritiqueByArtifact.get(critique.artifactId)
    const previousTime = previous ? Date.parse(previous.createdAt || '') : 0
    const currentTime = Date.parse(critique.createdAt || '')
    if (!previous || currentTime >= previousTime) latestCritiqueByArtifact.set(critique.artifactId, critique)
  }

  const candidates: SubDesignPreference[] = []
  for (const [artifactId, critique] of latestCritiqueByArtifact) {
    if (critique.verdict !== 'pass') continue
    const artifact = artifactById.get(artifactId)
    if (!artifact || critique.revision !== artifact.revision) continue
    const brief = briefById.get(artifact.briefId)
    if (!brief) continue
    candidates.push({
      briefId: brief.id,
      artifactId,
      surface: brief.surface,
      platform: brief.platform,
      designSystemId: brief.designSystemId,
      templateId: brief.templateId,
      skillIds: brief.skillIds,
      provenance: brief.provenance,
      selectedDirectionId: brief.selectedDirectionId,
      updatedAt: critique.createdAt || brief.updatedAt,
    })
  }
  const latestCanonical = candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  if (latestCanonical || briefs.length || artifacts.length || critiques.length) return latestCanonical || null
  return (options?.memoryEntries || [])
    .map((entry) => parseMemoryPreference(entry, options?.projectRoot))
    .filter((item): item is SubDesignPreference => Boolean(item))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null
}
