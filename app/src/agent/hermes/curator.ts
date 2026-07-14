/**
 * Idle Skill Curator — Hermes-inspired maintenance loop.
 *
 * This is deliberately outside the main agent run: the helper model receives
 * a small skill catalogue, while the primary session/prompt cache is untouched.
 * The curator may archive agent-created skills only; it never deletes or edits
 * user-authored skills.
 */

import type { LlmSettings } from '../types'
import { chatCompletion, withRoleModel } from '../llm'
import { learningLoop } from './learning'
import { skillsStore } from './skills'
import type { Skill } from './types'

export const SKILL_CURATOR_INTERVAL_MS = 24 * 60 * 60 * 1000
export const SKILL_CURATOR_IDLE_DELAY_MS = 15_000

const STORAGE_KEY = 'subagents.hermes.curator.v1'
let idleTimer: ReturnType<typeof setTimeout> | undefined
let curatorRunning = false

type CuratorState = { lastRunAt?: string }

export type CuratorResult = {
  ran: boolean
  reason?: string
  candidates: number
  archived: string[]
  usedModel: boolean
}

function readState(): CuratorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CuratorState) : {}
  } catch {
    return {}
  }
}

function writeState(state: CuratorState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* browser quota / test environment */
  }
}

function curatableSkills(): Skill[] {
  return skillsStore
    .list()
    .filter(
      (skill) =>
        skill.meta.createdBy === 'agent' &&
        skill.meta.status !== 'archived' &&
        skill.meta.status !== 'pinned',
    )
}

function skillTokens(skill: Skill): Set<string> {
  const text = `${skill.meta.name} ${skill.meta.description} ${skill.body}`.toLowerCase()
  const tokens = new Set(
    (text.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).slice(0, 80),
  )
  for (const sequence of text.match(/[一-鿿]{2,}/g) || []) {
    for (let i = 0; i + 2 <= sequence.length; i += 1) {
      tokens.add(sequence.slice(i, i + 2))
    }
  }
  return tokens
}

function similarity(a: Skill, b: Skill): number {
  const left = skillTokens(a)
  const right = skillTokens(b)
  const union = new Set([...left, ...right])
  if (!union.size) return 0
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  return overlap / union.size
}

/** Deterministic fallback for offline/simulation mode. */
function heuristicArchiveNames(skills: Skill[]): string[] {
  const archived: string[] = []
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      if (similarity(skills[i], skills[j]) < 0.42) continue
      // Keep the older skill as the canonical one; archive only the duplicate.
      const leftAt = Date.parse(skills[i].meta.createdAt || '') || 0
      const rightAt = Date.parse(skills[j].meta.createdAt || '') || 0
      const duplicate = rightAt >= leftAt ? skills[j] : skills[i]
      if (!archived.includes(duplicate.meta.name)) archived.push(duplicate.meta.name)
    }
  }
  return archived
}

function parseModelDecision(text: string, allowed: Set<string>): string[] | null {
  const object = text.match(/\{[\s\S]*\}/)?.[0]
  if (!object) return null
  try {
    const parsed = JSON.parse(object) as { archive?: unknown }
    if (!Array.isArray(parsed.archive)) return null
    return [...new Set(parsed.archive.map(String).filter((name) => allowed.has(name)))]
  } catch {
    return null
  }
}

async function askCuratorModel(
  settings: LlmSettings,
  skills: Skill[],
): Promise<{ archived: string[] | null; reason?: string }> {
  const helperSettings = withRoleModel(settings, 'Analyzer-1')
  if (!helperSettings.model || !helperSettings.apiKey.trim()) return { archived: null }
  const catalogue = skills
    .map(
      (skill) =>
        `- name=${skill.meta.name}\n  description=${skill.meta.description}\n  body=${skill.body.slice(0, 900)}`,
    )
    .join('\n')
  const result = await chatCompletion(
    helperSettings,
    [
      {
        role: 'system',
        content:
          '你是 Skill Curator。只審查 createdBy=agent 的技能，找出高度重複或過時的技能。不可建議刪除；只可列出要封存的 name。只回傳 JSON：{"archive":["name"],"reason":"..."}。沒有候選時 archive 為空陣列。',
      },
      {
        role: 'user',
        content: `請審查以下技能目錄：\n${catalogue}`,
      },
    ],
    { temperature: 0.1, maxTokens: 700 },
  )
  const allowed = new Set(skills.map((skill) => skill.meta.name))
  return {
    archived: parseModelDecision(result.content, allowed),
    reason: result.content.slice(0, 400),
  }
}

export function curatorDue(now = Date.now()): boolean {
  const last = Date.parse(readState().lastRunAt || '')
  return !last || now - last >= SKILL_CURATOR_INTERVAL_MS
}

/** Run a maintenance pass. `force` is intended for manual verification/UI. */
export async function runSkillCurator(
  settings: LlmSettings,
  opts?: { force?: boolean },
): Promise<CuratorResult> {
  if (curatorRunning) {
    return { ran: false, reason: 'already-running', candidates: 0, archived: [], usedModel: false }
  }
  if (!opts?.force && !curatorDue()) {
    return { ran: false, reason: 'interval-not-reached', candidates: 0, archived: [], usedModel: false }
  }

  const candidates = curatableSkills()
  if (candidates.length < 2) {
    return { ran: false, reason: 'not-enough-agent-skills', candidates: candidates.length, archived: [], usedModel: false }
  }

  curatorRunning = true
  const startedAt = new Date().toISOString()
  writeState({ lastRunAt: startedAt })
  let archived = heuristicArchiveNames(candidates)
  let usedModel = false
  let reason = archived.length ? 'heuristic duplicate match' : undefined

  try {
    if (settings.enabled && settings.apiKey.trim()) {
      try {
        const modelDecision = await askCuratorModel(settings, candidates)
        if (modelDecision.archived !== null) {
          archived = modelDecision.archived
          usedModel = true
        }
        reason = modelDecision.reason || reason
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        reason = `輔助模型失敗，改用離線重複比對：${message.slice(0, 160)}`
      }
    }

    const allowed = new Set(candidates.map((skill) => skill.meta.name))
    const archivedNames = archived.filter((name) => allowed.has(name))
    const changed = archivedNames.filter((name) => skillsStore.archive(name))
    if (changed.length) {
      try {
        const { useLearningStore } = await import('../../store/learningStore')
        useLearningStore.getState().refresh()
        await useLearningStore.getState().persist()
      } catch {
        /* persistence is best effort; in-memory state is still updated */
      }
    }
    learningLoop.onCuratorReview({
      candidates: candidates.length,
      archived: changed,
      usedModel,
      reason,
    })
    return {
      ran: true,
      reason,
      candidates: candidates.length,
      archived: changed,
      usedModel,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    learningLoop.onCuratorReview({
      candidates: candidates.length,
      archived: [],
      usedModel,
      reason: `審查失敗：${message.slice(0, 240)}`,
    })
    return {
      ran: true,
      reason: `審查失敗：${message.slice(0, 240)}`,
      candidates: candidates.length,
      archived: [],
      usedModel,
    }
  } finally {
    curatorRunning = false
  }
}

/** Schedule from an idle transition; this is not a second cron engine. */
export function scheduleSkillCurator(
  settings: LlmSettings,
  idleDelayMs = SKILL_CURATOR_IDLE_DELAY_MS,
) {
  if (idleTimer) clearTimeout(idleTimer)
  if (!curatorDue() || curatableSkills().length < 2) return
  idleTimer = setTimeout(() => {
    idleTimer = undefined
    void (async () => {
      const [{ useAgentStore }, { queueLength }] = await Promise.all([
        import('../../store/agentStore'),
        import('../runQueue'),
      ])
      if (useAgentStore.getState().isRunning || queueLength() > 0) return
      await runSkillCurator(settings)
    })()
  }, Math.max(0, idleDelayMs))
}
