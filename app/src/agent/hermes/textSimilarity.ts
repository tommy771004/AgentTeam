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

/**
 * Query→document relevance with ASCII tokens + CJK bigrams.
 * Shared by memory search, session recall, and ContextPacket ranking.
 */
export function scoreQueryText(query: string, text: string): number {
  const q = query.toLowerCase().trim()
  if (!q || !text) return 0
  const hay = text.toLowerCase()
  let score = 0
  for (const w of q.split(/\s+/)) {
    if (w.length < 2) continue
    if (hay.includes(w)) score += w.length > 3 ? 2 : 1
  }
  // CJK: single chars (weak) + bigrams (strong) so 繁中 objectives match lessons.
  for (const sequence of q.match(/[一-鿿]{2,}/g) || []) {
    for (let i = 0; i + 2 <= sequence.length; i += 1) {
      const bigram = sequence.slice(i, i + 2)
      if (hay.includes(bigram)) score += 2
    }
    if (sequence.length === 1 && hay.includes(sequence)) score += 1
  }
  for (const ch of q.match(/[一-鿿]/g) || []) {
    if (ch.length === 1 && hay.includes(ch)) score += 0.25
  }
  if (hay.includes(q)) score += 5
  return score
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
