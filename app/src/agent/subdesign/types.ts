export type SubDesignSurface = 'prototype' | 'dashboard' | 'design-system' | 'deck'

export type SubDesignStage = 'brief' | 'direction' | 'build' | 'critique' | 'deliver'

export type SubDesignPlatform =
  | 'responsive'
  | 'web-desktop'
  | 'mobile-ios'
  | 'desktop-app'

export type SubDesignFidelity = 'wireframe' | 'high-fidelity'

export type SubDesignDirection = {
  id: string
  title: string
  summary: string
  rationale?: string
  risk?: string
}

export type SubDesignBrief = {
  id: string
  threadId: string
  surface: SubDesignSurface
  objective: string
  audience?: string
  platform?: SubDesignPlatform
  fidelity?: SubDesignFidelity
  designSystemId?: string
  constraints: string[]
  acceptanceCriteria: string[]
  directions: SubDesignDirection[]
  selectedDirectionId?: string
  stage: SubDesignStage
  createdAt: string
  updatedAt: string
}

export type DesignSystemSummary = {
  id: string
  title: string
  category?: string
  description?: string
  sourcePath: string
  colors: string[]
  typography?: string
  tokenPaths: string[]
  sections: string[]
  updatedAt?: string
}

export type DesignSystemDocument = DesignSystemSummary & {
  content: string
}

export type SubDesignArtifactKind =
  | 'html'
  | 'deck'
  | 'react-component'
  | 'markdown-document'
  | 'svg'
  | 'design-system'

export type SubDesignArtifactRenderer =
  | 'html'
  | 'deck-html'
  | 'markdown'
  | 'svg'
  | 'code'
  | 'design-system'

export type SubDesignArtifactExport = 'html' | 'pdf' | 'zip' | 'jsx' | 'md' | 'svg' | 'txt'

export type SubDesignArtifact = {
  id: string
  briefId: string
  kind: SubDesignArtifactKind
  title: string
  entry: string
  renderer: SubDesignArtifactRenderer
  exports: SubDesignArtifactExport[]
  supportingFiles: string[]
  designSystemId?: string
  status: 'streaming' | 'complete' | 'error'
  revision: number
  createdAt: string
  updatedAt: string
}

export type SubDesignCritiqueFinding = {
  severity: 'blocker' | 'warning' | 'note'
  message: string
  path?: string
}

export type SubDesignCritiqueEvidence = {
  kind: 'screenshot' | 'dom' | 'lint' | 'build' | 'manual'
  summary: string
  path?: string
  capturedAt?: string
}

export type SubDesignCritique = {
  artifactId: string
  briefId?: string
  revision?: number
  createdAt?: string
  briefCoverage: number
  brandConformance: number
  accessibility: number
  implementationReadiness: number
  findings: SubDesignCritiqueFinding[]
  evidence: SubDesignCritiqueEvidence[]
  verdict: 'pass' | 'needs-revision'
}

export type SubDesignExportFormat = 'html' | 'zip' | 'pdf'

export type SubDesignExportRecord = {
  id: string
  artifactId: string
  revision: number
  format: SubDesignExportFormat
  path: string
  bytes: number
  sha256: string
  createdAt: string
}

export type SubDesignBriefPatch = Partial<
  Pick<
    SubDesignBrief,
    | 'objective'
    | 'audience'
    | 'platform'
    | 'fidelity'
    | 'designSystemId'
    | 'constraints'
    | 'acceptanceCriteria'
    | 'directions'
    | 'stage'
  >
>

export const SUBDESIGN_STAGES: readonly SubDesignStage[] = [
  'brief',
  'direction',
  'build',
  'critique',
  'deliver',
]

export function isSubDesignStage(value: unknown): value is SubDesignStage {
  return typeof value === 'string' && SUBDESIGN_STAGES.includes(value as SubDesignStage)
}

export function isSubDesignSurface(value: unknown): value is SubDesignSurface {
  return (
    value === 'prototype' ||
    value === 'dashboard' ||
    value === 'design-system' ||
    value === 'deck'
  )
}

export function stageLabel(stage: SubDesignStage): string {
  return {
    brief: 'Brief',
    direction: 'Direction',
    build: 'Build',
    critique: 'Critique',
    deliver: 'Deliver',
  }[stage]
}
