/** Pure learning-export plan. Electron owns the final scoped write. */
import type { KnowledgeGraph } from '../types.ts'
import type { MemoryBundle } from './types.ts'
import type { Skill } from './types.ts'

export type LearningExportKind = 'skill' | 'memory' | 'knowledge'

export type LearningExportFile = {
  kind: LearningExportKind
  relativePath: string
  content: string
}

/** Names become one project-relative path segment; traversal is never accepted. */
export function safeLearningName(input: string): string | null {
  const name = input.trim()
  if (!name || name === '.' || name === '..' || [...name].some((character) => {
    const code = character.codePointAt(0) || 0
    return character === '\\' || character === '/' || code <= 31
  })) return null
  const normalized = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized && normalized !== '.' && normalized !== '..' ? normalized.slice(0, 80) : null
}

export function isSafeLearningExportPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  return normalized.startsWith('.subagents/') &&
    !normalized.split('/').some((part) => part === '..' || part === '')
}

function markdownDoc(title: string, body: string): string {
  return `# ${title}\n\n${body.trim() || '（空）'}\n`
}

export function buildLearningExportPlan(input: {
  skills?: Skill[]
  memory?: MemoryBundle
  knowledge?: KnowledgeGraph
}): LearningExportFile[] {
  const files: LearningExportFile[] = []
  for (const skill of input.skills || []) {
    const name = safeLearningName(skill.meta.name)
    if (!name) continue
    files.push({
      kind: 'skill',
      relativePath: `.subagents/skills/${name}/SKILL.md`,
      content: skill.raw?.trim() ? `${skill.raw.trim()}\n` : markdownDoc(skill.meta.name, skill.body),
    })
  }
  if (input.memory) {
    files.push(
      {
        kind: 'memory',
        relativePath: '.subagents/memory/USER.md',
        content: markdownDoc('USER.md', input.memory.userProfile),
      },
      {
        kind: 'memory',
        relativePath: '.subagents/memory/MEMORY.md',
        content: markdownDoc('MEMORY.md', input.memory.memory),
      },
    )
  }
  if (input.knowledge) {
    const entities = [...input.knowledge.entities].sort((a, b) => a.name.localeCompare(b.name))
    const edges = [...input.knowledge.edges].sort((a, b) => `${a.from}:${a.to}:${a.label}`.localeCompare(`${b.from}:${b.to}:${b.label}`))
    files.push(
      {
        kind: 'knowledge',
        relativePath: '.subagents/knowledge/entities.md',
        content: [
          '# Knowledge entities',
          '',
          ...entities.map((entity) => `- **${entity.name}** · ${entity.kind} · mentions=${entity.mentions} · confidence=${entity.confidence}`),
          '',
        ].join('\n'),
      },
      {
        kind: 'knowledge',
        relativePath: '.subagents/knowledge/graph.json',
        content: `${JSON.stringify({ ...input.knowledge, entities, edges }, null, 2)}\n`,
      },
    )
  }
  return files.filter((file) => isSafeLearningExportPath(file.relativePath))
}
