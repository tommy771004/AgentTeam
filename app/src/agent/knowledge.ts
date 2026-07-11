/**
 * Task-run knowledge extraction + merge helpers.
 * Code structural graph: see codegraphClient + electron/codegraphBridge
 * (inspired by https://github.com/colbymchenry/codegraph).
 */

import type { EntityKind, KnowledgeEntity, KnowledgeGraph } from './types'

function uid(prefix: string, i: number) {
  return `${prefix}_${i}`
}

function kindFromToken(token: string): EntityKind {
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|vue|svelte)$/i.test(token) || token.includes('/'))
    return 'FILE'
  if (/^[A-Z][a-zA-Z0-9]+(?:[.#][A-Za-z0-9_]+)+$/.test(token)) return 'SYMBOL'
  if (/revenue|price|cost|metric|%|score|confidence/i.test(token)) return 'METRIC'
  if (/corp|inc|ltd|company|org|team|market/i.test(token)) return 'ORG'
  if (/project|phoenix|initiative|launch/i.test(token)) return 'PROJECT'
  if (/tool|software|platform|agent|framework|api/i.test(token)) return 'TOOL'
  if (/person|user|analyst|manager/i.test(token)) return 'PERSON'
  return 'CONCEPT'
}

/** Extract entities from objective + step results (deterministic; no fake seeds). */
export function extractKnowledge(
  objective: string,
  stepResults: string[],
  confidence: number,
): KnowledgeGraph {
  const text = [objective, ...stepResults].join('\n')
  const entities: KnowledgeEntity[] = []
  const seen = new Map<string, KnowledgeEntity>()

  const phrases = text.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g) || []
  const domains =
    text.match(
      /\b(AI|LLM|Q[1-4]|pricing|security|logs|orchestration|sub-?agents?|market|competitor|software|tools?|codegraph|MCP|CLI)\b/gi,
    ) || []
  const paths =
    text.match(
      /(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|vue)/g,
    ) || []

  const candidates = [...phrases, ...domains, ...paths]
    .map((c) => c.trim())
    .filter((c) => c.length > 2 && c.length < 80)

  let i = 0
  for (const name of candidates) {
    const key = name.toLowerCase()
    const existing = seen.get(key)
    if (existing) {
      existing.mentions += 1
      existing.confidence = Math.min(0.99, existing.confidence + 0.02)
      continue
    }
    const entity: KnowledgeEntity = {
      id: uid('ent', i++),
      name,
      kind: kindFromToken(name),
      mentions: 1,
      confidence: Math.min(0.99, 0.72 + confidence * 0.22),
    }
    seen.set(key, entity)
    entities.push(entity)
    if (entities.length >= 24) break
  }

  // Objective as hub concept when sparse (no demo fake brands)
  if (entities.length === 0 && objective.trim()) {
    entities.push({
      id: uid('ent', i++),
      name: objective.trim().slice(0, 60),
      kind: 'CONCEPT',
      mentions: 1,
      confidence: Math.max(0.5, confidence),
    })
  }

  const sorted = entities.sort((a, b) => b.mentions - a.mentions)
  const hub = sorted[0]

  const edges =
    hub
      ? sorted
          .filter((e) => e.id !== hub.id)
          .slice(0, 12)
          .map((e) => ({
            from: hub.id,
            to: e.id,
            label:
              e.kind === 'METRIC'
                ? 'measures'
                : e.kind === 'FILE'
                  ? 'mentions_file'
                  : e.kind === 'SYMBOL'
                    ? 'mentions_symbol'
                    : e.kind === 'ORG'
                      ? 'involves'
                      : 'related',
          }))
      : []

  if (sorted.length >= 3) {
    edges.push({
      from: sorted[1].id,
      to: sorted[2].id,
      label: 'correlates',
    })
  }

  return {
    entities: sorted,
    edges,
    phase:
      confidence >= 0.9
        ? 'Synthesis Complete'
        : confidence >= 0.7
          ? 'Pattern Recognition Active'
          : 'Entity Bootstrap',
    source: 'task',
  }
}

export function emptyKnowledge(): KnowledgeGraph {
  return { entities: [], edges: [], phase: 'Idle', source: 'task' }
}
