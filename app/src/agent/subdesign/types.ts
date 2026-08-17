import type { OpenDesignProvenance } from '../openDesign/catalog.ts'

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

export type SubDesignReference = {
  id: string
  kind: 'screenshot' | 'url'
  source: string
  storedPath: string
  title?: string
  importedAt: string
  sha256: string
  designSystemId?: string
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
  templateId?: string
  skillIds?: string[]
  provenance?: OpenDesignProvenance[]
  references?: SubDesignReference[]
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

export type SubDesignArtifactExport = 'html' | 'pdf' | 'zip' | 'pptx' | 'mp4' | 'jsx' | 'md' | 'svg' | 'txt'

export type SubDesignArtifactTweakKind = 'color' | 'text' | 'number' | 'select' | 'boolean'

export type SubDesignArtifactTweak = {
  id: string
  label: string
  kind: SubDesignArtifactTweakKind
  path: string
  find: string
  replaceTemplate: string
  value: string
  defaultValue?: string
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export type SubDesignArtifact = {
  id: string
  briefId: string
  kind: SubDesignArtifactKind
  title: string
  entry: string
  renderer: SubDesignArtifactRenderer
  exports: SubDesignArtifactExport[]
  supportingFiles: string[]
  tweaks?: SubDesignArtifactTweak[]
  designSystemId?: string
  status: 'streaming' | 'complete' | 'error'
  revision: number
  createdAt: string
  updatedAt: string
}

export type SubDesignArtifactPatchOperation = {
  path: string
  find: string
  replace: string
  expectedMatches?: number
}

export type SubDesignCritiqueFinding = {
  severity: 'blocker' | 'warning' | 'note'
  message: string
  path?: string
}

export type SubDesignCritiqueEvidence = {
  kind: 'screenshot' | 'dom' | 'lint' | 'build' | 'manual' | 'template-attribution' | 'design-system' | 'asset-license'
  summary: string
  path?: string
  capturedAt?: string
  evidenceId?: string
  sha256?: string
  source?: string
  artifactId?: string
  revision?: number
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

export type SubDesignCritiquePanelistId = 'visual' | 'accessibility' | 'implementation'

export type SubDesignCritiquePanelist = {
  id: SubDesignCritiquePanelistId
  label: string
  focus: string
  status: 'pending' | 'active' | 'complete' | 'interrupted'
  score?: number
  summary?: string
  findings?: SubDesignCritiqueFinding[]
  evidence?: SubDesignCritiqueEvidence[]
}

export type SubDesignCritiqueRound = {
  id: string
  label: string
  status: 'pending' | 'active' | 'complete' | 'interrupted'
  panelists: SubDesignCritiquePanelist[]
  compositeScore?: number
  startedAt?: string
  completedAt?: string
}

export type SubDesignCritiqueSessionEvent = {
  id: string
  at: string
  kind: 'status' | 'panelist' | 'evidence' | 'score' | 'error'
  roundId?: string
  panelistId?: SubDesignCritiquePanelistId
  message: string
  score?: number
}

export type SubDesignCritiqueSession = {
  id: string
  briefId: string
  artifactId: string
  artifactRevision: number
  status: 'running' | 'completed' | 'interrupted' | 'failed'
  threshold: number
  currentRoundIndex: number
  previewStep: number
  rounds: SubDesignCritiqueRound[]
  scoreHistory: number[]
  compositeScore?: number
  /** Claimed synchronously when the one-and-only final design_critique call starts. */
  finalCritiqueClaimed?: boolean
  events: SubDesignCritiqueSessionEvent[]
  startedAt: string
  finishedAt?: string
  interruptReason?: string
}

export type SubDesignExportFormat = 'html' | 'zip' | 'pdf' | 'pptx' | 'mp4'

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
    | 'templateId'
    | 'skillIds'
    | 'provenance'
    | 'references'
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

export function stageLabel(stage: SubDesignStage): string {
  return {
    brief: 'Brief',
    direction: 'Direction',
    build: 'Build',
    critique: 'Critique',
    deliver: 'Deliver',
  }[stage]
}
