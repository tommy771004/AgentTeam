/**
 * Hermes-style prompt assembly:
 * stable (identity + skills) → context (AGENTS.md) → volatile (memory + time)
 */

import type { LlmSettings, PersonalityPreset } from '../types'
import { memoryStore } from './memory'
import { skillsStore } from './skills'
import { pluginRegistry } from './plugins'

export interface PromptLayers {
  stable: string
  context: string
  volatile: string
  full: string
}

const DEFAULT_SOUL = `你是 SubAgents AI 多代理團隊中的執行核心，風格精準、可審計、遵守安全規則。
靈感來自 Hermes Agent 的閉環學習：善用技能索引與持久記憶，避免重複犯錯。
使用繁體中文回覆使用者可見內容（程式碼與 JSON 鍵名可維持英文）。`

const PERSONALITY_PROMPTS: Record<PersonalityPreset, string> = {
  default: '',
  none: '不要套用特定人格；以中性、直接、專業的口吻回覆。',
  friendly: '語氣友善、鼓勵、易懂；適度使用溫暖表達，但避免過度口語。',
  efficient: '務實精簡：先給結論與可執行步驟，少寒暄，條列優先。',
  professional: '正式專業：結構清楚、用詞精準，適合職場與文件。',
  candid: '直率坦誠：指出風險與取捨，不迴避壞消息，但仍保持尊重。',
  quirky: '可以略帶幽默與創意，但不犧牲正確性與可執行性。',
}

function buildPersonalizationBlock(settings?: Partial<LlmSettings> | null): string {
  if (!settings) return ''
  const lines: string[] = ['# 個人化（Personalization）']
  const personality = (settings.personality || 'default') as PersonalityPreset
  const p = PERSONALITY_PROMPTS[personality]
  if (p) lines.push(`## 人格\n${p}`)
  if (settings.customAboutUser?.trim()) {
    lines.push(`## 關於使用者\n${settings.customAboutUser.trim().slice(0, 2000)}`)
  }
  if (settings.customResponseStyle?.trim()) {
    lines.push(`## 回覆偏好\n${settings.customResponseStyle.trim().slice(0, 2000)}`)
  }
  const gitBits: string[] = []
  if (settings.gitBranchPrefix?.trim()) {
    gitBits.push(`- 新建分支前綴：\`${settings.gitBranchPrefix.trim()}\``)
  }
  if (settings.gitCommitInstructions?.trim()) {
    gitBits.push(`- Commit 指引：${settings.gitCommitInstructions.trim().slice(0, 500)}`)
  }
  if (settings.gitPrInstructions?.trim()) {
    gitBits.push(`- PR 指引：${settings.gitPrInstructions.trim().slice(0, 500)}`)
  }
  if (settings.gitCreateDraftPr) gitBits.push('- 建立 PR 時優先 draft')
  if (settings.gitForcePush) gitBits.push('- 推送時可使用 --force-with-lease（謹慎）')
  if (gitBits.length) {
    lines.push(`## Git 偏好\n${gitBits.join('\n')}`)
  }
  if (lines.length === 1) return ''
  return lines.join('\n')
}

const DEFAULT_AGENTS = `# AGENTS.md — 專案上下文

## 產品
SubAgents AI 桌面代理：四種 Loop 模式、工具沙箱、HITL 安全閘道、Webhook、排程。

## 規則
- 敏感資料需人工核准
- 不可捏造外部事實；工具結果優先
- Definition of Done 必須可量測
`

let soulDoc = DEFAULT_SOUL
let agentsDoc = DEFAULT_AGENTS

export function setSoulDoc(text: string) {
  soulDoc = text.trim() || DEFAULT_SOUL
}

export function setAgentsDoc(text: string) {
  agentsDoc = text.trim() || DEFAULT_AGENTS
}

export function getSoulDoc() {
  return soulDoc
}

export function getAgentsDoc() {
  return agentsDoc
}

export function buildPromptLayers(opts?: {
  role?: string
  objective?: string
  extraContext?: string
  /** When set, injects ChatGPT-style personalization + memory toggles */
  settings?: Partial<LlmSettings> | null
  /** Temporary chat: skip memory entirely */
  temporary?: boolean
  /**
   * W2: persistent project guidance from real AGENTS.md/CLAUDE.md files
   * (projectContextResolver). Layered ABOVE Hermes user guidance.
   */
  projectGuidance?: string
}): PromptLayers {
  const skillsIndex = skillsStore.buildIndexPrompt()
  const matched = opts?.objective
    ? skillsStore.matchForObjective(opts.objective)
    : []
  const personalization = buildPersonalizationBlock(opts?.settings)

  const stable = [
    '# 身份（stable）',
    soulDoc,
    opts?.role ? `\n目前角色：${opts.role}` : '',
    personalization ? `\n${personalization}` : '',
    '',
    '# 工具指引',
    '- 優先使用工具取得證據，再下結論。',
    '- 可用 skill_load 載入匹配技能並嚴格遵循流程。',
    opts?.settings?.memoryEnabled !== false && !opts?.temporary
      ? '- memory_append 保存跨 session 重要偏好與教訓。'
      : '- 目前為臨時／記憶關閉模式：不要依賴跨對話記憶。',
    '',
    skillsIndex,
    matched.length
      ? `\n### 與本目標可能相關的技能\n${matched.map((s) => `- ${s.meta.name}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  // Hint agents to use CodeGraph tools when available
  const codegraphHint = [
    '# 程式碼圖譜（CodeGraph）',
    '- 結構性問題優先使用工具 codegraph_explore / codegraph_impact / codegraph_callers（需專案已 codegraph init）。',
    '- 回傳結果視為已讀取的 source + 呼叫路徑，勿再盲目 grep 整庫。',
    '- 狀態可用 codegraph_status 檢查是否已索引。',
  ].join('\n')

  const context = [
    '# 專案上下文（context）',
    codegraphHint,
    // Precedence: project-local AGENTS.md (real files) wins over user/Hermes guidance
    opts?.projectGuidance ? opts.projectGuidance.slice(0, 16_000) : '',
    agentsDoc.slice(0, 4000),
    opts?.extraContext ? `\n## 額外上下文\n${opts.extraContext.slice(0, 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const pluginBits = pluginRegistry.apply().promptFragments
  const memoryOn =
    !opts?.temporary && opts?.settings?.memoryEnabled !== false

  const volatile = [
    '# 動態層（volatile）',
    `時間：${new Date().toISOString()}`,
    opts?.objective ? `當前目標：${opts.objective}` : '',
    '',
    memoryStore.buildPromptBlock(memoryOn),
    pluginBits.length ? `\n## 外掛片段\n${pluginBits.join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const full = [stable, context, volatile].join('\n\n---\n\n')
  return { stable, context, volatile, full }
}
