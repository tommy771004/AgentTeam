/**
 * Hermes-style prompt assembly:
 * stable (identity + skills index) → ContextPacket slots (project / recall / memory) → volatile meta
 *
 * Phase 4: variable context goes through ContextPacket per-slot budgets instead of
 * a final whole-blob hard cut that could drop session recall entirely.
 */

import type { LlmSettings, PersonalityPreset } from '../types.ts'
import { LEGACY_DEFAULT_AGENTS, LEGACY_DEFAULT_SOUL } from '../legacyInstructionDefaults.ts'
import { memoryStore } from './memory.ts'
import { skillsStore } from './skills.ts'
import { pluginRegistry } from './plugins.ts'
import {
  buildContextPacket,
  formatPacketDiagnostics,
  type ContextPacket,
  type ContextPacketDiagnostics,
  type ContextPacketSource,
} from './contextPacket.ts'

export interface PromptLayers {
  stable: string
  context: string
  volatile: string
  full: string
  /** Phase 4: slot inclusion diagnostics for engine logs / tests */
  packetDiagnostics?: ContextPacketDiagnostics
  packet?: ContextPacket
}

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

let soulDoc = LEGACY_DEFAULT_SOUL
let agentsDoc = LEGACY_DEFAULT_AGENTS
let legacySoulPresent = false
let legacyAgentsPresent = false
let legacySoulRaw = ''
let legacyAgentsRaw = ''

export type LegacyInstructionHydration = Readonly<{
  status: 'pending' | 'ready' | 'failed'
  error?: string
}>

let legacyInstructionHydration: LegacyInstructionHydration = { status: 'pending' }

export function beginLegacyInstructionHydration(): void {
  legacyInstructionHydration = { status: 'pending' }
}

export function completeLegacyInstructionHydration(): void {
  legacyInstructionHydration = { status: 'ready' }
}

export function failLegacyInstructionHydration(error: unknown): void {
  legacyInstructionHydration = {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }
}

export function getLegacyInstructionHydration(): LegacyInstructionHydration {
  return legacyInstructionHydration
}

export function setSoulDoc(text: string) {
  legacySoulPresent = true
  legacySoulRaw = text
  soulDoc = text.trim() || LEGACY_DEFAULT_SOUL
}

export function setAgentsDoc(text: string) {
  legacyAgentsPresent = true
  legacyAgentsRaw = text
  agentsDoc = text.trim() || LEGACY_DEFAULT_AGENTS
}

export function getSoulDoc() {
  return soulDoc
}

export function getAgentsDoc() {
  return agentsDoc
}

/** Legacy migration source with presence preserved; defaults are not legacy data. */
export function getLegacyInstructionDocs(): { soul?: string; agents?: string } {
  return {
    ...(legacySoulPresent ? { soul: legacySoulRaw } : {}),
    ...(legacyAgentsPresent ? { agents: legacyAgentsRaw } : {}),
  }
}

export type BuildPromptLayersOpts = {
  role?: string
  objective?: string
  /**
   * @deprecated Prefer structured packet fields (sessionRecall / stepEvidence / …).
   * When provided without structured fields, mapped into the extraSystem slot
   * (per-slot budget — never a final whole-blob 2000-char hard cut of everything).
   */
  extraContext?: string
  settings?: Partial<LlmSettings> | null
  temporary?: boolean
  projectGuidance?: string
  /** Intra-thread chat history block (from chatHistory.ts). */
  recentChat?: string
  /** Cross-session recall block (from sessionSearch / formatSessionRecallBlock). */
  sessionRecall?: string
  /** Compressed step outputs / tool evidence. */
  stepEvidence?: string
  /** Attached skill bodies and similar mount content. */
  skillsContext?: string
  /** Catch-all system context (webhook body, hooks, …). */
  extraSystem?: string
}

export function buildPromptLayers(opts?: BuildPromptLayersOpts): PromptLayers {
  const skillsIndex = skillsStore.buildIndexPrompt()
  const matched = opts?.objective
    ? skillsStore.matchForObjective(opts.objective)
    : []
  const personalization = buildPersonalizationBlock(opts?.settings)
  const temporary = opts?.temporary === true
  const memoryOn =
    !temporary && opts?.settings?.memoryEnabled !== false

  const stable = [
    '# 身份（stable）',
    soulDoc,
    opts?.role ? `\n目前角色：${opts.role}` : '',
    '',
    '# 工具指引',
    '- 優先使用工具取得證據，再下結論。',
    '- 可用 skill_load 載入匹配技能並嚴格遵循流程。',
    memoryOn
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

  const codegraphHint = [
    '# 程式碼圖譜（CodeGraph）',
    '- 結構性問題優先使用工具 codegraph_explore / codegraph_impact / codegraph_callers（需專案已 codegraph init）。',
    '- 回傳結果視為已讀取的 source + 呼叫路徑，勿再盲目 grep 整庫。',
    '- 狀態可用 codegraph_status 檢查是否已索引。',
  ].join('\n')

  // Hermes user guidance (agentsDoc) is separate from project-local AGENTS.md
  // and sits in a stable-ish context header; project guidance is a packet slot.
  const contextHeader = ['# 專案上下文（context）', codegraphHint, agentsDoc.slice(0, 4000)]
    .filter(Boolean)
    .join('\n')

  const pluginBits = pluginRegistry.apply().promptFragments
  const failureLessons = memoryOn
    ? memoryStore.buildFailureLessonsBlock(opts?.objective, 3)
    : ''
  // General memory block without duplicating the failure section (already a slot).
  const memoryBlock = memoryOn
    ? memoryStore.buildPromptBlock(true, opts?.objective)
    : ''

  const packetSource: ContextPacketSource = {
    objective: opts?.objective,
    projectGuidance: opts?.projectGuidance,
    globalPersonalization: personalization || undefined,
    recentChat: opts?.recentChat,
    sessionRecall: opts?.sessionRecall,
    stepEvidence: opts?.stepEvidence,
    failureLessons: failureLessons || undefined,
    // Avoid double-injecting failure lessons: strip that subsection if we have a slot
    memory: memoryBlock
      ? memoryBlock
          .replace(/### 失敗教訓[\s\S]*?(?=###|$)/, '')
          .trim()
      : undefined,
    skillsContext: opts?.skillsContext,
    pluginFragments: pluginBits.length ? pluginBits.join('\n\n') : undefined,
    extraSystem: opts?.extraSystem || opts?.extraContext,
    temporary,
    skipSessionRecall: temporary || opts?.settings?.sessionRecallEnabled === false,
    skipMemory: !memoryOn,
    sessionRecallSkipReason: temporary
      ? 'temporary chat: session recall disabled'
      : opts?.settings?.sessionRecallEnabled === false
        ? 'settings.sessionRecallEnabled=false'
        : undefined,
    memorySkipReason: temporary
      ? 'temporary chat: memory disabled'
      : opts?.settings?.memoryEnabled === false
        ? 'settings.memoryEnabled=false'
        : undefined,
  }

  const packet = buildContextPacket(packetSource)

  const volatile = [
    '# 動態層（volatile）',
    `時間：${new Date().toISOString()}`,
    opts?.objective ? `當前目標：${opts.objective}` : '',
    temporary ? '模式：臨時對話（不讀寫跨會話記憶）' : '',
  ]
    .filter(Boolean)
    .join('\n')

  // Packet carries project guidance, recall, memory, steps, plugins — no final slice(0,2000).
  const context = [contextHeader, packet.assembled].filter(Boolean).join('\n\n')
  const full = [stable, context, volatile].join('\n\n---\n\n')

  return {
    stable,
    context,
    volatile,
    full,
    packet,
    packetDiagnostics: packet.diagnostics,
  }
}

export { formatPacketDiagnostics, buildContextPacket }
export type { ContextPacket, ContextPacketDiagnostics, ContextPacketSource }
