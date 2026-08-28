import type { SubagentId } from './types.ts'

const MENTIONS: ReadonlyArray<{ id: SubagentId; aliases: string[] }> = [
  { id: 'general', aliases: ['@general', '@gen'] },
  { id: 'explore', aliases: ['@explore', '@exp'] },
]

/** Parse supported subagent mentions without coupling them to a CLI provider. */
export function parseSubagentMentions(text: string): {
  subagents: SubagentId[]
  cleaned: string
} {
  const found = new Set<SubagentId>()
  let cleaned = text
  for (const entry of MENTIONS) {
    for (const mention of entry.aliases) {
      const expression = new RegExp(`(?:^|\\s)${mention.replace('@', '@?')}\\b`, 'gi')
      if (!expression.test(cleaned)) continue
      found.add(entry.id)
      cleaned = cleaned.replace(expression, ' ')
    }
  }
  return { subagents: [...found], cleaned: cleaned.replace(/\s+/g, ' ').trim() }
}
