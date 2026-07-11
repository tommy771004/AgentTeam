/**
 * OpenCode-inspired primary agents + subagents
 * @see https://opencode.ai/docs/agents
 */

import type { AgentMode, PermissionPolicy, SubagentId } from '../types'

export type { AgentMode, SubagentId }

export interface AgentModeDef {
  id: AgentMode
  label: string
  description: string
  /** OpenCode: primary */
  kind: 'primary'
  permission: PermissionPolicy
  systemHint: string
  color: string
}

export interface SubagentDef {
  id: SubagentId
  label: string
  description: string
  kind: 'subagent'
  permission: PermissionPolicy
  systemHint: string
  /** Mention tokens e.g. @general */
  mentions: string[]
}

export const PRIMARY_AGENTS: AgentModeDef[] = [
  {
    id: 'build',
    label: 'Build',
    description: '完整工具存取，實作與修改（OpenCode 預設）',
    kind: 'primary',
    permission: {
      read: 'allow',
      edit: 'allow',
      web: 'allow',
      memory: 'allow',
      skill: 'allow',
      mcp: 'allow',
      task: 'allow',
      delegate: 'allow',
    },
    systemHint: `## Agent mode: Build（靈感自 OpenCode）
你是完整存取的實作代理。
- 可讀寫專案目錄、使用工具與委派
- 優先可執行變更與清楚說明
- 重大破壞性操作前簡述意圖`,
    color: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
  },
  {
    id: 'plan',
    label: 'Plan',
    description: '唯讀分析與規劃，預設禁止寫入',
    kind: 'primary',
    permission: {
      read: 'allow',
      edit: 'deny',
      web: 'ask',
      memory: 'allow',
      skill: 'allow',
      mcp: 'ask',
      task: 'deny',
      delegate: 'allow',
    },
    systemHint: `## Agent mode: Plan（靈感自 OpenCode）
你是規劃／分析代理，預設不可修改檔案。
- 可讀取與搜尋，提出計畫與風險
- 禁止 workspace_write / skill_save
- 輸出：目標、步驟、檔案影響、風險、建議指令（勿直接改碼）
- 使用者確認後再請其切換 Build 實作`,
    color: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
  },
]

export const SUBAGENTS: SubagentDef[] = [
  {
    id: 'general',
    label: 'General',
    description: '多步驟研究與複雜任務（可工具）',
    kind: 'subagent',
    permission: {
      read: 'allow',
      edit: 'allow',
      web: 'allow',
      memory: 'allow',
      skill: 'allow',
      mcp: 'allow',
      task: 'allow',
      delegate: 'deny',
    },
    systemHint: `## Subagent: @general
複雜問題的通用子代理：多步推理、工具蒐證、彙整結論。勿再巢狀委派。`,
    mentions: ['@general', '@gen'],
  },
  {
    id: 'explore',
    label: 'Explore',
    description: '快速唯讀探索程式庫',
    kind: 'subagent',
    permission: {
      read: 'allow',
      edit: 'deny',
      web: 'allow',
      memory: 'allow',
      skill: 'allow',
      mcp: 'deny',
      task: 'deny',
      delegate: 'deny',
    },
    systemHint: `## Subagent: @explore
唯讀探索：找檔案、搜尋關鍵字、解釋結構。禁止任何寫入。`,
    mentions: ['@explore', '@exp'],
  },
]

export function getPrimaryAgent(id: AgentMode | string | undefined): AgentModeDef {
  return PRIMARY_AGENTS.find((a) => a.id === id) || PRIMARY_AGENTS[0]
}

export function getSubagent(id: string): SubagentDef | undefined {
  const low = id.toLowerCase().replace(/^@/, '')
  return SUBAGENTS.find(
    (s) => s.id === low || s.mentions.some((m) => m.replace(/^@/, '') === low),
  )
}

/** Parse leading @mentions from user text */
export function parseSubagentMentions(text: string): {
  subagents: SubagentId[]
  cleaned: string
} {
  const found = new Set<SubagentId>()
  let cleaned = text
  for (const s of SUBAGENTS) {
    for (const m of s.mentions) {
      const re = new RegExp(`(?:^|\\s)${m.replace('@', '@?')}\\b`, 'gi')
      if (re.test(cleaned)) {
        found.add(s.id)
        cleaned = cleaned.replace(re, ' ')
      }
    }
  }
  return {
    subagents: [...found],
    cleaned: cleaned.replace(/\s+/g, ' ').trim(),
  }
}

export function nextPrimaryAgent(current: AgentMode): AgentMode {
  return current === 'build' ? 'plan' : 'build'
}


