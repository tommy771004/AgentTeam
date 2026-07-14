/**
 * Token-overlap (Jaccard) similarity for deduping short agent-authored text
 * (skill names/descriptions/bodies, automation objectives). Mixes ASCII word
 * tokens with CJK bigrams so both English and Chinese drafts compare sanely.
 * Shared by curator.ts (after-the-fact skill archiving) and learning.ts
 * (draft-time skill dedup) — see docs/CONVERSATION_LOOP_HERMES_FLOW.md.
 */

/** Two texts at or above this overlap ratio are treated as the same skill. */
export const SKILL_SIMILARITY_THRESHOLD = 0.42

export function textTokens(text: string): Set<string> {
  const lower = text.toLowerCase()
  const tokens = new Set(
    (lower.match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).slice(0, 80),
  )
  for (const sequence of lower.match(/[一-鿿]{2,}/g) || []) {
    for (let i = 0; i + 2 <= sequence.length; i += 1) {
      tokens.add(sequence.slice(i, i + 2))
    }
  }
  return tokens
}

export function textSimilarity(a: string, b: string): number {
  const left = textTokens(a)
  const right = textTokens(b)
  const union = new Set([...left, ...right])
  if (!union.size) return 0
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  return overlap / union.size
}
