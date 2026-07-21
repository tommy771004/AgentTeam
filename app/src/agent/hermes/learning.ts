/**
 * Closed learning loop — inspired by Hermes self-improvement
 * After successful goal runs: draft skills / memory nudges.
 */

import { v4 as uuid } from 'uuid'
import { memoryStore } from './memory.ts'
import { skillsStore } from './skills.ts'
import { subDesignProjectMemoryKey } from '../subdesign/preference.ts'
import { SKILL_SIMILARITY_THRESHOLD, textSimilarity } from './textSimilarity.ts'
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

  /**
   * Phase 4 / R7: count only user-initiated chat turns accepted by the
   * coordinator (composer / slash / retry). Must NOT be called from
   * onGoalSuccess or automation sources.
   */
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

  /** Test / diagnostics — number of user turns counted since process start. */
  getUserTurnCount() {
    return this.turnCounter
  }

  /**
   * Pre-compaction memory flush（grok-build `[compaction.memory_flush]` 語意）：
   * 舊訊息被摘要丟棄前，把 compaction 摘要寫進持久記憶，之後的 run 可召回。
   * 與近期 flush 條目高度相似（textSimilarity ≥ 0.85，近似 grok 的
   * semantic_dedup_threshold）時跳過，避免長 run 反覆壓縮灌爆記憶。
   */
  onPreCompactionFlush(input: {
    objective: string
    summary: string
    runId?: string
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }): boolean {
    if (input.memoryEnabled === false || input.memoryWriteEnabled === false) return false
    const text = input.summary.trim()
    if (text.length < 80) return false

    const flushText = `Run 上下文 flush（${input.objective.slice(0, 80)}）：${text.slice(0, 1600)}`
    const recentFlushes = memoryStore
      .getBundle()
      .entries.filter((e) => e.tags?.includes('flush'))
      .slice(0, 8)
    for (const prev of recentFlushes) {
      if (textSimilarity(flushText, prev.text) >= 0.85) return false
    }

    memoryStore.appendMemory(flushText, [
      'flush',
      'auto',
      'compaction',
      ...(input.runId ? [`run:${input.runId}`] : []),
    ])
    this.emit({
      id: uuid(),
      type: 'memory_saved',
      message: '壓縮前已將重要脈絡 flush 進記憶（compaction memory flush）。',
      at: new Date().toISOString(),
      payload: { kind: 'compaction-flush', runId: input.runId },
    })
    return true
  }

  /** Dream 整併完成 → 學習事件(訂閱者會觸發 learningStore persist)。 */
  onDreamConsolidation(input: { deduped: number; merged: number }) {
    this.emit({
      id: uuid(),
      type: 'memory_saved',
      message: `記憶整併完成：去重 ${input.deduped} 筆、合併 ${input.merged} 筆（dream）。`,
      at: new Date().toISOString(),
      payload: { kind: 'dream', ...input },
    })
  }

  /**
   * Persist a successful SubDesign choice as a reusable project-scoped preference.
   * The path itself is never written to memory; only a stable short fingerprint is.
   */
  onSubDesignPass(input: {
    projectRoot?: string
    surface: string
    platform?: string
    designSystemId?: string
    templateId?: string
    selectedDirectionId?: string
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }) {
    if (input.memoryEnabled === false || input.memoryWriteEnabled === false) return
    const projectKey = subDesignProjectMemoryKey(input.projectRoot)
    const details = [
      `surface=${input.surface}`,
      input.platform ? `platform=${input.platform}` : '',
      input.designSystemId ? `designSystem=${input.designSystemId}` : '',
      input.templateId ? `template=${input.templateId}` : '',
      input.selectedDirectionId ? `direction=${input.selectedDirectionId}` : '',
    ].filter(Boolean).join(', ')
    memoryStore.appendMemory(
      `SubDesign 偏好（${projectKey}）：${details || '未指定偏好'}。這是一次已通過 critique 的設計選擇，下次建立設計可優先預填。`,
      ['success', 'subdesign', 'subdesign-preference', projectKey],
    )
    this.emit({
      id: uuid(),
      type: 'memory_saved',
      message: '已將通過 critique 的 SubDesign 選擇寫入專案偏好記憶。',
      at: new Date().toISOString(),
      payload: { kind: 'subdesign-preference', projectKey },
    })
  }

  /**
   * After successful goal-based execution, create a skill draft from trajectory.
   */
  onGoalSuccess(input: {
    objective: string
    steps: Array<{ description: string; result?: string }>
    /** Successful tool calls for playbook-quality drafts */
    toolCalls?: Array<{ tool: string; summary?: string }>
    loopType: string
    /** When false, skip auto memory write (ChatGPT-style Memory off) */
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }) {
    // Phase 4: do not increment turn counter here — success is not a user turn.
    // Skip skill drafts for trivial chat-lite turns (no tools / single generic step)
    const tools = input.toolCalls || []
    if (
      input.loopType === 'Turn-based' &&
      tools.length === 0 &&
      input.steps.length <= 1
    ) {
      const canWriteLite =
        input.memoryEnabled !== false && input.memoryWriteEnabled !== false
      if (canWriteLite && input.objective.length > 20) {
        // light touch only — no skill spam
      }
      return
    }

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

    const toolsMd = tools.length
      ? tools
          .map((t, i) => `${i + 1}. \`${t.tool}\`${t.summary ? ` — ${t.summary.slice(0, 100)}` : ''}`)
          .join('\n')
      : ''

    const body = `# ${name}

## 何時使用
目標類似：${input.objective.slice(0, 200)}

## 流程（由成功執行軌跡濃縮）
${stepsMd || '1. 解析目標\n2. 執行工具\n3. 驗證 DoD'}
${toolsMd ? `\n## 成功工具序列\n${toolsMd}\n` : ''}
## 注意
- 此技能由代理自動草稿，請人工審核後再正式啟用。
- Loop 類型：${input.loopType}
`

    const description = `自動草稿：${input.objective.slice(0, 40)}`

    // Draft-time dedup: skip near-duplicate objectives instead of relying solely
    // on curator.ts's after-the-fact idle sweep — see docs/CONVERSATION_LOOP_HERMES_FLOW.md.
    const draftText = `${name} ${description} ${body}`
    const existingAgentSkillTexts = skillsStore
      .list()
      .filter((skill) => skill.meta.createdBy === 'agent' && skill.meta.status !== 'archived')
      .map((skill) => `${skill.meta.name} ${skill.meta.description} ${skill.body}`)
    const pendingDraftTexts = this.pendingSkillDrafts.map(
      (draft) => `${draft.name} ${draft.description} ${draft.body}`,
    )
    const isNearDuplicate = [...existingAgentSkillTexts, ...pendingDraftTexts].some(
      (text) => textSimilarity(draftText, text) >= SKILL_SIMILARITY_THRESHOLD,
    )
    if (isNearDuplicate) return

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

  /** Record a compact lesson when a run terminates unsuccessfully. */
  onGoalFailure(input: {
    objective: string
    haltReason: string
    loopType: string
    failedTools?: string[]
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }) {
    const canWrite =
      input.memoryEnabled !== false && input.memoryWriteEnabled !== false
    if (!canWrite) return
    const toolNote = input.failedTools?.length
      ? `；失敗工具：${input.failedTools.slice(0, 5).join(', ')}`
      : ''
    // Phase 4: explicit tool:/strategy: tags for ContextPacket recall
    const tags = [
      'failure',
      'auto',
      `strategy:${input.loopType}`,
      ...(input.failedTools || []).slice(0, 5).map((t) => `tool:${t}`),
    ]
    memoryStore.appendMemory(
      `目標失敗：${input.objective.slice(0, 100)}（${input.loopType}）原因：${input.haltReason.slice(0, 120)}${toolNote}`,
      tags,
    )
    this.emit({
      id: uuid(),
      type: 'memory_saved',
      message: '已將失敗教訓寫入記憶（同類目標下次會帶入相關記憶）。',
      at: new Date().toISOString(),
    })
  }

  /** Record an idle Skill Curator pass without mixing it into the main run. */
  onCuratorReview(input: {
    candidates: number
    archived: string[]
    usedModel: boolean
    reason?: string
  }) {
    const archived = input.archived.length
      ? `已封存：${input.archived.join('、')}`
      : '沒有需要封存的重複技能'
    this.emit({
      id: uuid(),
      type: 'curator_review',
      message: `Skill Curator 完成審查（${input.candidates} 個代理技能）。${archived}`,
      at: new Date().toISOString(),
      payload: {
        candidates: input.candidates,
        archived: input.archived,
        usedModel: input.usedModel,
        reason: input.reason,
      },
    })
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
