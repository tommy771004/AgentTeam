import type { SubDesignPinnedComment } from './pinnedComments.ts'

export type PinnedPatchScope = {
  schemaVersion: 1
  scopeId: string
  runId: string
  artifactId: string
  revision: number
  path: string
  selectors: string[]
  createdAt: string
  expiresAt: string
}

type SimpleSelector = { tag: string; id?: string; classes: string[] }
type HtmlRange = { start: number; end: number }

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

function parseSimpleSelector(value: string): SimpleSelector | null {
  const match = /^([a-z][a-z0-9:-]*)(?:#([a-z0-9_:-]+))?((?:\.[a-z0-9_:-]+)*)$/i.exec(value.trim())
  if (!match) return null
  return {
    tag: match[1].toLowerCase(),
    ...(match[2] ? { id: match[2] } : {}),
    classes: match[3] ? match[3].slice(1).split('.') : [],
  }
}

function parseSelectorPath(selector: string): SimpleSelector[] | null {
  const parts = selector.split('>').map((part) => parseSimpleSelector(part))
  return parts.length && parts.every(Boolean) ? parts as SimpleSelector[] : null
}

function elementSelector(tag: string, openingTag: string): SimpleSelector {
  const id = /\bid\s*=\s*(["'])(.*?)\1/i.exec(openingTag)?.[2]
  const className = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(openingTag)?.[2] || ''
  return {
    tag: tag.toLowerCase(),
    ...(id ? { id } : {}),
    classes: className.trim() ? className.trim().split(/\s+/) : [],
  }
}

function matchesSimple(actual: SimpleSelector, expected: SimpleSelector): boolean {
  return actual.tag === expected.tag
    && (!expected.id || actual.id === expected.id)
    && expected.classes.every((name) => actual.classes.includes(name))
}

function matchesPath(actual: SimpleSelector[], expected: SimpleSelector[]): boolean {
  if (actual.length < expected.length) return false
  const offset = actual.length - expected.length
  return expected.every((part, index) => matchesSimple(actual[offset + index], part))
}

function maskRawText(html: string): string {
  return html.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_whole, open: string, _tag: string, body: string, close: string) => `${open}${' '.repeat(body.length)}${close}`)
}

function collectHtmlElements(html: string): Array<{ path: SimpleSelector[]; range: HtmlRange }> {
  const masked = maskRawText(html)
  const token = /<\/?([a-zA-Z][\w:-]*)(?:\s[^<>]*?)?>/g
  const stack: Array<{ selector: SimpleSelector; path: SimpleSelector[]; start: number }> = []
  const elements: Array<{ path: SimpleSelector[]; range: HtmlRange }> = []
  let match: RegExpExecArray | null
  while ((match = token.exec(masked)) !== null) {
    const source = match[0]
    const tag = match[1].toLowerCase()
    if (source.startsWith('</')) {
      const index = stack.map((frame) => frame.selector.tag).lastIndexOf(tag)
      if (index < 0) continue
      const [frame] = stack.splice(index, stack.length - index)
      elements.push({ path: frame.path, range: { start: frame.start, end: token.lastIndex } })
      continue
    }
    const selector = elementSelector(tag, source)
    const path = [...stack.map((frame) => frame.selector), selector]
    if (source.endsWith('/>') || VOID_TAGS.has(tag)) {
      elements.push({ path, range: { start: match.index, end: token.lastIndex } })
    } else {
      stack.push({ selector, path, start: match.index })
    }
  }
  return elements
}

export function resolvePinnedHtmlRanges(
  html: string,
  selectors: string[],
): { ok: true; ranges: HtmlRange[] } | { ok: false; reason: string } {
  const parsed = selectors.map(parseSelectorPath)
  const invalidAt = parsed.findIndex((selector) => !selector)
  if (invalidAt >= 0) return { ok: false, reason: `pin selector 不支援：${selectors[invalidAt]}` }
  const elements = collectHtmlElements(html)
  const ranges: HtmlRange[] = []
  for (let index = 0; index < parsed.length; index += 1) {
    const matches = elements.filter((element) => matchesPath(element.path, parsed[index]!))
    if (matches.length !== 1) {
      return { ok: false, reason: `pin selector 必須精確對應一個元素：${selectors[index]}（找到 ${matches.length} 個）` }
    }
    ranges.push(matches[0].range)
  }
  return { ok: true, ranges }
}

export function validatePinnedPatchOperation(opts: {
  content: string
  selectors: string[]
  find: string
  expectedMatches: number
}): { ok: true } | { ok: false; reason: string } {
  const resolved = resolvePinnedHtmlRanges(opts.content, opts.selectors)
  if (!resolved.ok) return resolved
  const matches: HtmlRange[] = []
  let cursor = 0
  while (cursor <= opts.content.length - opts.find.length) {
    const start = opts.content.indexOf(opts.find, cursor)
    if (start < 0) break
    matches.push({ start, end: start + opts.find.length })
    cursor = start + opts.find.length
  }
  if (matches.length !== opts.expectedMatches) {
    return { ok: false, reason: `scoped patch 找到 ${matches.length} 個匹配，預期 ${opts.expectedMatches} 個。` }
  }
  const outside = matches.some((match) => !resolved.ranges.some((range) => match.start >= range.start && match.end <= range.end))
  return outside
    ? { ok: false, reason: 'patch find 超出使用者 pin 指定的元素範圍。' }
    : { ok: true }
}

export function createPinnedPatchScope(input: {
  scopeId: string
  runId: string
  artifactId: string
  revision: number
  path: string
  pins: SubDesignPinnedComment[]
  now?: Date
}): PinnedPatchScope {
  const now = input.now || new Date()
  return {
    schemaVersion: 1,
    scopeId: input.scopeId,
    runId: input.runId,
    artifactId: input.artifactId,
    revision: input.revision,
    path: input.path,
    selectors: [...new Set(input.pins.map((pin) => pin.selector))],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  }
}
