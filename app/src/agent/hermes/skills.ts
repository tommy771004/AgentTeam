/**
 * @deprecated Renderer skill-authoring compatibility bridge, scheduled for
 * removal before AgentStudio 1.3.0. Pi Host remains the only runtime discovery
 * authority; this copy exists for current Learning/Settings authoring and is
 * synchronised through skillHostSync. Do not add consumers.
 */

import type { Skill, SkillMeta } from './types.ts'

const DEFAULT_SKILLS: Array<{ path: string; raw: string }> = [
  {
    path: 'research/web-research/SKILL.md',
    raw: `---
name: web-research
description: 網路研究與來源整理流程。
version: 1.0.0
author: AgentStudio
createdBy: user
tags: [research, web]
---

# Web Research Skill

## 何時使用
需要比較產品、查價格、彙整公開資訊時。

## 流程
1. 用 \`web_search\` 蒐集 3–5 個候選來源。
2. 必要時 \`http_fetch\` 讀取重點段落。
3. 以 Markdown 表格輸出比較（缺資料標 N/A）。
4. 最後寫入 \`workspace\` 報告檔。

## 注意
- 不可捏造價格或來源。
- 敏感憑證相關請求改走安全閘道。
`,
  },
  {
    path: 'ops/safe-export/SKILL.md',
    raw: `---
name: safe-export
description: 安全匯出與人工核准流程。
version: 1.0.0
author: AgentStudio
createdBy: user
tags: [safety, export]
---

# Safe Export Skill

## 何時使用
涉及匯出、資料庫 dump、或敏感表名時。

## 流程
1. 列出將存取的資源（表／路徑）。
2. 觸發安全閘道，等待人工核准。
3. 僅匯出非敏感欄位；敏感欄位遮罩。
4. 寫入 audit log 與 workspace 報告。
`,
  },
]

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw.trim() }
  const yaml = m[1]
  const body = m[2].trim()
  const meta: Record<string, unknown> = {}
  for (const line of yaml.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    let val: unknown = kv[2].trim()
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      val = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (typeof val === 'string') {
      val = val.replace(/^["']|["']$/g, '')
    }
    meta[key] = val
  }
  return { meta, body }
}

export function parseSkillMarkdown(raw: string, path: string): Skill {
  const { meta, body } = parseFrontmatter(raw)
  const name = String(meta.name || path.split('/').filter(Boolean).slice(-2, -1)[0] || 'unnamed')
  const skillMeta: SkillMeta = {
    name,
    description: String(meta.description || '').slice(0, 120),
    version: meta.version ? String(meta.version) : undefined,
    author: meta.author ? String(meta.author) : undefined,
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined,
    createdBy: meta.createdBy === 'agent' ? 'agent' : 'user',
    status:
      meta.status === 'pinned' || meta.status === 'archived'
        ? meta.status
        : 'active',
    createdAt: meta.createdAt ? String(meta.createdAt) : undefined,
    updatedAt: meta.updatedAt ? String(meta.updatedAt) : undefined,
  }
  return { meta: skillMeta, body, path, raw }
}

export function serializeSkill(meta: SkillMeta, body: string): string {
  const tags =
    meta.tags && meta.tags.length
      ? `[${meta.tags.map((t) => t).join(', ')}]`
      : undefined
  const lines = [
    '---',
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    meta.version ? `version: ${meta.version}` : null,
    meta.author ? `author: ${meta.author}` : null,
    meta.createdBy ? `createdBy: ${meta.createdBy}` : null,
    `status: ${meta.status || 'active'}`,
    tags ? `tags: ${tags}` : null,
    meta.createdAt ? `createdAt: ${meta.createdAt}` : null,
    `updatedAt: ${meta.updatedAt || new Date().toISOString()}`,
    '---',
    '',
    body.trim(),
    '',
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/**
 * CJK-aware matching: ASCII words use normal containment; Chinese has no
 * whitespace tokenization, so any matching bigram is treated as a hit.
 */
export function cjkAwareHit(hay: string, objective: string): boolean {
  const lower = objective.toLowerCase()
  const text = hay.toLowerCase()
  if (text.split(/\s+/).some((word) => word.length > 3 && lower.includes(word))) {
    return true
  }
  const cjkSequences = text.match(/[一-鿿]{2,}/g) || []
  for (const sequence of cjkSequences) {
    for (let index = 0; index + 2 <= sequence.length; index++) {
      if (objective.includes(sequence.slice(index, index + 2))) return true
    }
  }
  return false
}

export class SkillsStore {
  private skills = new Map<string, Skill>()

  constructor() {
    for (const s of DEFAULT_SKILLS) {
      const skill = parseSkillMarkdown(s.raw, s.path)
      this.skills.set(skill.meta.name, skill)
    }
  }

  list(): Skill[] {
    return [...this.skills.values()].sort((a, b) => a.meta.name.localeCompare(b.meta.name))
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /** Compact index for system prompt (Hermes-style skills index) */
  buildIndexPrompt(): string {
    const items = this.list().filter((s) => s.meta.status !== 'archived')
    if (!items.length) return ''
    const lines = items.map(
      (s) => `- **${s.meta.name}**: ${s.meta.description || '(無描述)'}`,
    )
    return [
      '## 技能索引（Skills）',
      '回覆前先掃描下列技能；若明顯匹配，載入並遵循其流程。',
      ...lines,
      '使用工具 `skill_load` 讀取完整技能內容。',
    ].join('\n')
  }

  /**
   * Pinned skills expand into the system prompt up front (issue 16), whether
   * or not the objective happens to match their keywords.
   */
  pin(name: string): boolean {
    return this.applyStatus(name, 'pinned')
  }

  /** Unpinning returns a pinned skill to the normal advertised-only state. */
  unpin(name: string): boolean {
    return this.applyStatus(name, 'active', 'pinned')
  }

  private applyStatus(name: string, status: NonNullable<SkillMeta['status']>, from?: SkillMeta['status']): boolean {
    const skill = this.skills.get(name)
    if (!skill || skill.meta.status === status || (from && skill.meta.status !== from)) return false
    const raw = serializeSkill(
      { ...skill.meta, status, updatedAt: new Date().toISOString() },
      skill.body,
    )
    this.skills.set(name, parseSkillMarkdown(raw, skill.path))
    notifySkillsChanged()
    return true
  }

  save(meta: SkillMeta, body: string): Skill {
    const path = `agent-created/${meta.name}/SKILL.md`
    const raw = serializeSkill(
      {
        ...meta,
        status: meta.status || 'active',
        updatedAt: new Date().toISOString(),
        createdAt: meta.createdAt || new Date().toISOString(),
      },
      body,
    )
    const skill = parseSkillMarkdown(raw, path)
    this.skills.set(skill.meta.name, skill)
    notifySkillsChanged()
    return skill
  }

  remove(name: string): boolean {
    const removed = this.skills.delete(name)
    if (removed) notifySkillsChanged()
    return removed
  }

  /** Curator may archive agent-created skills, never delete them. */
  archive(name: string): boolean {
    const skill = this.skills.get(name)
    if (!skill || skill.meta.createdBy !== 'agent' || skill.meta.status === 'archived') {
      return false
    }
    const raw = serializeSkill(
      { ...skill.meta, status: 'archived', updatedAt: new Date().toISOString() },
      skill.body,
    )
    this.skills.set(name, parseSkillMarkdown(raw, skill.path))
    notifySkillsChanged()
    return true
  }

  /** Archived skills are recoverable by the user. */
  restore(name: string): boolean {
    const skill = this.skills.get(name)
    if (!skill || skill.meta.status !== 'archived') return false
    const raw = serializeSkill(
      { ...skill.meta, status: 'active', updatedAt: new Date().toISOString() },
      skill.body,
    )
    this.skills.set(name, parseSkillMarkdown(raw, skill.path))
    notifySkillsChanged()
    return true
  }

  /** Hydrate from persisted list */
  loadAll(items: Array<{ path: string; raw: string }>) {
    let loaded = 0
    for (const s of items) {
      try {
        const skill = parseSkillMarkdown(s.raw, s.path)
        this.skills.set(skill.meta.name, skill)
        loaded += 1
      } catch {
        /* skip bad skill */
      }
    }
    // Import replaces the list wholesale — the Host copy must follow.
    if (loaded) notifySkillsChanged()
  }

  exportAll(): Array<{ path: string; raw: string }> {
    return this.list().map((s) => ({ path: s.path, raw: s.raw }))
  }

  matchForObjective(objective: string): Skill[] {
    return this.list().filter((skill) => skill.meta.status !== 'archived').filter((skill) =>
      cjkAwareHit(
        `${skill.meta.name} ${skill.meta.description} ${(skill.meta.tags || []).join(' ')}`,
        objective,
      ),
    )
  }
}

/**
 * Mutation notification. Skills only auto-load through the Host-owned
 * directory (ADR-0034), so every local change must reach it — subscribers
 * (App bootstrap) push the full list through the Host bridge on any change.
 * The store itself stays bridge-free: in a plain browser there is no bridge
 * and the subscriber is simply never registered.
 */
type SkillsListener = () => void
const listeners = new Set<SkillsListener>()

export function onSkillsChanged(listener: SkillsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifySkillsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* a broken listener must not break the mutation itself */
    }
  }
}

export const skillsStore = new SkillsStore()
