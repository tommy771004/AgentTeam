export type MarkdownSource = {
  href: string
  label: string
  domain: string
}

/** Sources the answer actually cited, in first-appearance order. */
export function extractMarkdownSources(content: string): MarkdownSource[] {
  const sources: MarkdownSource[] = []
  const seen = new Set<string>()
  const links = content.matchAll(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g)
  for (const match of links) {
    try {
      const url = new URL(match[2])
      const href = url.href
      if (seen.has(href)) continue
      seen.add(href)
      sources.push({ href, label: match[1].trim() || url.hostname, domain: url.hostname.replace(/^www\./, '') })
    } catch {
      // A malformed citation remains ordinary answer text; it is not a source.
    }
  }
  return sources
}
