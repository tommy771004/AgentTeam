/**
 * Closed learning loop — inspired by Hermes self-improvement
 * After successful goal runs: draft skills / memory nudges.
 */

import { v4 as uuid } from 'uuid'
import { memoryStore } from './memory'
import { skillsStore } from './skills'
import type { LearningEvent } from './types'

type Listener = (events: LearningEvent[]) => void

class LearningLoop {
  private events: LearningEvent[] = []
  private listeners: Listener[] = []
  private turnCounter = 0
  private pendingSkillDrafts: Array<{ name: string; description: string; body: string }> = []

  subscribe(fn: Listener) {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  private emit(ev: LearningEvent) {
    this.events = [ev, ...this.events].slice(0, 100)
    for (const l of this.listeners) l(this.getEvents())
  }

  getEvents() {
    return [...this.events]
  }

  getPendingSkillDrafts() {
    return [...this.pendingSkillDrafts]
  }

  clearPendingDraft(name: string) {
    this.pendingSkillDrafts = this.pendingSkillDrafts.filter((d) => d.name !== name)
  }

  /** Call after each user-initiated run */
  onUserTurn() {
    this.turnCounter += 1
    // Hermes-like: every N turns nudge memory
    if (this.turnCounter % 5 === 0) {
      this.emit({
        id: uuid(),
        type: 'memory_nudge',
        message:
          '學習提醒：若本輪有可複用的偏好或教訓，請寫入記憶（memory_append）。',
        at: new Date().toISOString(),
      })
    }
  }

  /**
   * After successful goal-based execution, create a skill draft from trajectory.
   */
  onGoalSuccess(input: {
    objective: string
    steps: Array<{ description: string; result?: string }>
    loopType: string
    /** When false, skip auto memory write (ChatGPT-style Memory off) */
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }) {
    this.onUserTurn()
    const slug =
      input.objective
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || `skill-${Date.now().toString(36)}`

    const name = `auto-${slug}`.slice(0, 48)
    if (skillsStore.get(name) || this.pendingSkillDrafts.some((d) => d.name === name)) {
      return
    }

    const stepsMd = input.steps
      .map((s, i) => `${i + 1}. ${s.description}${s.result ? ` — ${s.result.slice(0, 120)}` : ''}`)
      .join('\n')

    const body = `# ${name}

## 何時使用
目標類似：${input.objective.slice(0, 200)}

## 流程（由成功執行軌跡濃縮）
${stepsMd || '1. 解析目標\n2. 執行工具\n3. 驗證 DoD'}

## 注意
- 此技能由代理自動草稿，請人工審核後再正式啟用。
- Loop 類型：${input.loopType}
`

    const description = `自動草稿：${input.objective.slice(0, 40)}`
    this.pendingSkillDrafts.push({ name, description, body })
    this.emit({
      id: uuid(),
      type: 'skill_draft',
      message: `已產生技能草稿「${name}」，請在學習中心核准。`,
      at: new Date().toISOString(),
      payload: { name, description },
    })

    // Light memory write (honour ChatGPT-style memory toggles when provided)
    const canWrite =
      input.memoryEnabled !== false && input.memoryWriteEnabled !== false
    if (canWrite) {
      memoryStore.appendMemory(
        `成功完成目標：${input.objective.slice(0, 120)}（${input.loopType}）`,
        ['success', 'auto'],
      )
      this.emit({
        id: uuid(),
        type: 'memory_saved',
        message: '已將成功目標摘要寫入記憶。',
        at: new Date().toISOString(),
      })
    }
  }

  approveSkillDraft(name: string): boolean {
    const draft = this.pendingSkillDrafts.find((d) => d.name === name)
    if (!draft) return false
    skillsStore.save(
      {
        name: draft.name,
        description: draft.description,
        version: '0.1.0',
        author: 'SubAgents AI',
        createdBy: 'agent',
        tags: ['auto', 'draft-approved'],
      },
      draft.body,
    )
    this.clearPendingDraft(name)
    this.emit({
      id: uuid(),
      type: 'skill_saved',
      message: `技能「${name}」已核准並寫入技能庫。`,
      at: new Date().toISOString(),
    })
    return true
  }

  rejectSkillDraft(name: string) {
    this.clearPendingDraft(name)
  }
}

export const learningLoop = new LearningLoop()
