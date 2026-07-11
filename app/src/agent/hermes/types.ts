/** Hermes-inspired learning types */

export interface SkillMeta {
  name: string
  description: string
  version?: string
  author?: string
  tags?: string[]
  createdBy?: 'user' | 'agent'
  createdAt?: string
  updatedAt?: string
}

export interface Skill {
  meta: SkillMeta
  body: string
  /** Relative path under skills/ */
  path: string
  raw: string
}

export interface MemoryEntry {
  id: string
  kind: 'user' | 'memory' | 'note'
  text: string
  createdAt: string
  tags?: string[]
}

export interface MemoryBundle {
  userProfile: string
  memory: string
  entries: MemoryEntry[]
  updatedAt: string
}

export interface SessionSearchHit {
  id: string
  source: 'archive' | 'memory' | 'skill'
  title: string
  snippet: string
  score: number
  timestamp?: string
}

export interface LearningEvent {
  id: string
  type: 'skill_draft' | 'memory_nudge' | 'skill_saved' | 'memory_saved'
  message: string
  at: string
  payload?: unknown
}
