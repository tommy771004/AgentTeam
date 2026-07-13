import { v4 as uuid } from 'uuid'
import type {
  SubDesignBrief,
  SubDesignBriefPatch,
  SubDesignDirection,
  SubDesignStage,
} from './types'
import { isSubDesignStage } from './types'

const MAX_TEXT = 4000
const MAX_LIST_ITEMS = 20
const MAX_DIRECTIONS = 3

function cleanText(value: unknown, max = MAX_TEXT): string {
  return String(value ?? '').trim().slice(0, max)
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => cleanText(item, 500)).filter(Boolean))].slice(
    0,
    MAX_LIST_ITEMS,
  )
}

function normalizeDirection(value: unknown, index: number): SubDesignDirection | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const title = cleanText(raw.title, 160)
  const summary = cleanText(raw.summary || raw.description, 500)
  if (!title || !summary) return null
  return {
    id: cleanText(raw.id, 80) || `direction_${index + 1}`,
    title,
    summary,
    rationale: cleanText(raw.rationale, 500) || undefined,
    risk: cleanText(raw.risk, 300) || undefined,
  }
}

function cleanDirections(value: unknown): SubDesignDirection[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .map((item, index) => normalizeDirection(item, index))
    .filter((item): item is SubDesignDirection => Boolean(item))
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, MAX_DIRECTIONS)
}

export function createSubDesignBrief(input: {
  threadId: string
  surface: SubDesignBrief['surface']
  objective: string
  audience?: string
  platform?: SubDesignBrief['platform']
  fidelity?: SubDesignBrief['fidelity']
  designSystemId?: string
  constraints?: string[]
  acceptanceCriteria?: string[]
}): SubDesignBrief {
  const now = new Date().toISOString()
  return {
    id: `brief_${uuid().replaceAll('-', '').slice(0, 18)}`,
    threadId: cleanText(input.threadId, 120),
    surface: input.surface,
    objective: cleanText(input.objective) || '請先協助我釐清設計目標。',
    audience: cleanText(input.audience, 500) || undefined,
    platform: input.platform,
    fidelity: input.fidelity,
    designSystemId: cleanText(input.designSystemId, 120) || undefined,
    constraints: cleanList(input.constraints),
    acceptanceCriteria: cleanList(input.acceptanceCriteria),
    directions: [],
    stage: 'brief',
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeBrief(raw: unknown): SubDesignBrief | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = cleanText(value.id, 120)
  const threadId = cleanText(value.threadId, 120)
  const surface = value.surface
  if (!id || !threadId || !isSubDesignStage(value.stage)) return null
  if (
    surface !== 'prototype' &&
    surface !== 'dashboard' &&
    surface !== 'design-system' &&
    surface !== 'deck'
  ) {
    return null
  }
  return {
    id,
    threadId,
    surface,
    objective: cleanText(value.objective) || '請先協助我釐清設計目標。',
    audience: cleanText(value.audience, 500) || undefined,
    platform:
      value.platform === 'responsive' ||
      value.platform === 'web-desktop' ||
      value.platform === 'mobile-ios' ||
      value.platform === 'desktop-app'
        ? value.platform
        : undefined,
    fidelity: value.fidelity === 'wireframe' || value.fidelity === 'high-fidelity' ? value.fidelity : undefined,
    designSystemId: cleanText(value.designSystemId, 120) || undefined,
    constraints: cleanList(value.constraints),
    acceptanceCriteria: cleanList(value.acceptanceCriteria),
    directions: cleanDirections(value.directions),
    selectedDirectionId: cleanText(value.selectedDirectionId, 80) || undefined,
    stage: value.stage,
    createdAt: cleanText(value.createdAt, 40) || new Date().toISOString(),
    updatedAt: cleanText(value.updatedAt, 40) || new Date().toISOString(),
  }
}

export function updateSubDesignBrief(
  brief: SubDesignBrief,
  patch: SubDesignBriefPatch,
): SubDesignBrief {
  const next: SubDesignBrief = {
    ...brief,
    objective: patch.objective == null ? brief.objective : cleanText(patch.objective) || brief.objective,
    audience: patch.audience == null ? brief.audience : cleanText(patch.audience, 500) || undefined,
    platform: patch.platform ?? brief.platform,
    fidelity: patch.fidelity ?? brief.fidelity,
    designSystemId:
      patch.designSystemId == null ? brief.designSystemId : cleanText(patch.designSystemId, 120) || undefined,
    constraints: patch.constraints == null ? brief.constraints : cleanList(patch.constraints),
    acceptanceCriteria:
      patch.acceptanceCriteria == null ? brief.acceptanceCriteria : cleanList(patch.acceptanceCriteria),
    directions: patch.directions == null ? brief.directions : cleanDirections(patch.directions),
    stage: patch.stage ?? brief.stage,
    updatedAt: new Date().toISOString(),
  }
  if (next.selectedDirectionId && !next.directions.some((item) => item.id === next.selectedDirectionId)) {
    next.selectedDirectionId = undefined
  }
  return next
}

export function transitionSubDesignStage(
  brief: SubDesignBrief,
  nextStage: SubDesignStage,
): { ok: true; brief: SubDesignBrief } | { ok: false; error: string } {
  if (!isSubDesignStage(nextStage)) return { ok: false, error: `未知 SubDesign stage：${nextStage}` }
  if (nextStage === 'build' && !brief.selectedDirectionId) {
    return { ok: false, error: '尚未選定 design direction，不能進入 Build 或寫入 workspace。' }
  }
  const currentIndex = ['brief', 'direction', 'build', 'critique', 'deliver'].indexOf(brief.stage)
  const nextIndex = ['brief', 'direction', 'build', 'critique', 'deliver'].indexOf(nextStage)
  if (nextIndex > currentIndex + 1 && !brief.selectedDirectionId) {
    return { ok: false, error: `不能從 ${brief.stage} 跳到 ${nextStage}。請先完成 direction gate。` }
  }
  return { ok: true, brief: updateSubDesignBrief(brief, { stage: nextStage }) }
}

export function selectSubDesignDirection(
  brief: SubDesignBrief,
  directionId: string,
  fallback?: Partial<SubDesignDirection>,
): { ok: true; brief: SubDesignBrief } | { ok: false; error: string } {
  const id = cleanText(directionId, 80)
  if (!id) return { ok: false, error: 'directionId 必填。' }
  let directions = brief.directions
  if (!directions.some((item) => item.id === id)) {
    const title = cleanText(fallback?.title, 160)
    const summary = cleanText(fallback?.summary, 500)
    if (!title || !summary) return { ok: false, error: `找不到 direction：${id}` }
    directions = [...directions, { id, title, summary, rationale: fallback?.rationale, risk: fallback?.risk }].slice(
      0,
      MAX_DIRECTIONS,
    )
  }
  const next = updateSubDesignBrief(brief, { directions })
  next.selectedDirectionId = id
  next.stage = next.stage === 'brief' || next.stage === 'direction' ? 'build' : next.stage
  next.updatedAt = new Date().toISOString()
  return { ok: true, brief: next }
}

export function stageFromPlan(
  plan: Array<{ text: string; status: string }>,
): SubDesignStage | null {
  const active = plan.filter((item) => item.status !== 'pending')
  const hay = active.map((item) => item.text).join(' ').toLowerCase()
  if (!hay) return null
  if (/deliver|交付|export|匯出|handoff/.test(hay)) return 'deliver'
  if (/critique|review|驗收|檢查|accessibility|a11y/.test(hay)) return 'critique'
  if (/build|implement|實作|artifact|產物|寫入/.test(hay)) return 'build'
  if (/direction|方向|比較|選擇/.test(hay)) return 'direction'
  return 'brief'
}

