import { codeBlockHtml, readCodeFence } from './codeBlockHtml'

/**
 * Lightweight markdown → safe HTML for chat / report (Codex-style reading).
 * No external deps; escapes HTML first, then applies a small subset.
 */

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Placeholder brackets for an extracted code span.
 *
 * `esc()` runs first, so after it no raw `<` or `>` can come from user text —
 * only from markup this module inserts itself. That makes these two sentinels
 * impossible to forge from content, and impossible to mistake for content.
 */
const CODE_OPEN = '<!c'
const CODE_CLOSE = '!>'

/**
 * Inline spans, with code pulled out of the way first.
 *
 * Emphasis and links used to run before the backticks were resolved, so the
 * asterisks and brackets INSIDE a code span were styled as markup: `a**b**c`
 * rendered with a bold `b` and lost its stars. Code is literal by definition,
 * so it is extracted to placeholders, the rest is marked up, and the spans go
 * back untouched.
 */
function inline(s: string) {
  const codeSpans: string[] = []
  const withoutCode = esc(s).replace(/`([^`]+?)`/g, (_match, code: string) => {
    codeSpans.push(code)
    return `${CODE_OPEN}${codeSpans.length - 1}${CODE_CLOSE}`
  })

  const marked = withoutCode
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-on-surface font-semibold">$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, '$1<em class="text-on-surface-variant">$2</em>')
    .replace(/~~(.+?)~~/g, '<del class="text-ink-3">$1</del>')
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="agent-source-link text-primary">$1</a>',
    )

  return marked.replace(/<!c(\d+)!>/g, (_match, index: string) =>
    '<code class="px-1 py-0.5 rounded-[5px] bg-inset text-accent-ink shadow-hairline font-[family-name:var(--font-mono)] text-[12px]">' +
    `${codeSpans[Number(index)]}</code>`,
  )
}

function isTableRow(s: string): boolean {
  return /^\s*\|.*\|\s*$/.test(s.trim()) || (s.includes('|') && s.trim().length > 0 && /\|.*\|/.test(s))
}

function isTableSeparator(s: string): boolean {
  const t = s.trim()
  if (!t.includes('-') || !t.includes('|')) return false
  return /^\|?[\s:|-]+\|?$/.test(t)
}

function splitTableRow(s: string): string[] {
  return s
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** Levels 1–6. Only 1–3 existed, so `#### Heading` rendered as literal text. */
const HEADING_HTML: Record<number, (body: string) => string> = {
  1: (body) => `<h1 class="text-xl font-bold text-on-surface mb-2 mt-1 font-[family-name:var(--font-sora)]">${body}</h1>`,
  2: (body) => `<h2 class="text-base font-semibold text-on-surface mt-4 mb-1.5 font-[family-name:var(--font-sora)]">${body}</h2>`,
  3: (body) => `<h3 class="text-sm font-semibold text-primary mt-3 mb-1">${body}</h3>`,
  4: (body) => `<h4 class="text-sm font-semibold text-on-surface mt-2.5 mb-1">${body}</h4>`,
  5: (body) => `<h5 class="text-[13px] font-semibold text-on-surface-variant mt-2 mb-1">${body}</h5>`,
  6: (body) => `<h6 class="text-[13px] font-medium uppercase tracking-wide text-ink-3 mt-2 mb-1">${body}</h6>`,
}

const LIST_OPEN: Record<'ul' | 'ol', string> = {
  ul: '<ul class="list-disc pl-5 space-y-1 text-on-surface-variant text-sm my-1.5">',
  ol: '<ol class="list-decimal pl-5 space-y-1 text-on-surface-variant text-sm my-1.5">',
}

/** Indent columns per nesting level; deeper than this reads as noise, so it clamps. */
const LIST_INDENT_PER_LEVEL = 2
const MAX_LIST_DEPTH = 3

export function renderMarkdown(md: string, streaming?: boolean): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let codeLanguage = 'code'
  let codeMarker = ''
  /**
   * Open lists, outermost first.
   *
   * `itemOpen` is why the `<li>` is not closed as soon as it is written: a
   * nested list belongs INSIDE its parent item, so the item has to stay open
   * until the next line says whether one follows. An indented item used to miss
   * the list branch entirely and fall through to `<p>`, losing its indent.
   */
  const listStack: Array<{ tag: 'ul' | 'ol'; depth: number; itemOpen: boolean }> = []
  /**
   * Lines of the paragraph being built.
   *
   * Every source line used to become its own `<p class="mb-2">`, so a soft-
   * wrapped answer rendered as a stack of separately-spaced paragraphs and the
   * gaps doubled against the blank-line spacer. Consecutive lines now join into
   * one paragraph, keeping their visible breaks with `<br>`.
   */
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(
      `<p class="text-sm text-on-surface leading-relaxed mb-2">${paragraph.map(inline).join('<br>')}</p>`,
    )
    paragraph = []
  }

  const closeItem = (level: { itemOpen: boolean }) => {
    if (!level.itemOpen) return
    html.push('</li>')
    level.itemOpen = false
  }

  /** Close the innermost list, then the parent item that was holding it open. */
  const popList = () => {
    const level = listStack.pop()!
    closeItem(level)
    html.push(`</${level.tag}>`)
    const parent = listStack[listStack.length - 1]
    if (parent) closeItem(parent)
  }

  const flushLists = () => {
    while (listStack.length) popList()
  }

  const flushBlocks = () => {
    flushParagraph()
    flushLists()
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const fence = readCodeFence(line, codeMarker)
    if (fence) {
      if (inCode) {
        html.push(codeBlockHtml(codeLanguage, codeBuf))
        codeBuf = []
        codeLanguage = 'code'
        codeMarker = ''
        inCode = false
      } else {
        flushBlocks()
        inCode = true
        codeLanguage = fence.info || 'code'
        codeMarker = fence.marker
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }

    // GFM 表格：表頭列 + 分隔列（|---|---|）
    if (isTableRow(line) && li + 1 < lines.length && isTableSeparator(lines[li + 1])) {
      flushBlocks()
      const headers = splitTableRow(line)
      const rows: string[][] = []
      let ri = li + 2
      while (ri < lines.length && isTableRow(lines[ri]) && !isTableSeparator(lines[ri])) {
        rows.push(splitTableRow(lines[ri]))
        ri += 1
      }
      const thead = headers
        .map(
          (h) =>
            `<th class="primitive-table-cell text-left text-xs font-semibold text-ink-3 border-b border-line whitespace-nowrap">${inline(h)}</th>`,
        )
        .join('')
      const tbody = rows
        .map(
          (cells) =>
            `<tr class="border-t border-line">${headers
              .map(
                (_, ci) =>
                  `<td class="primitive-table-cell text-sm text-ink-2 align-top">${inline(cells[ci] ?? '')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')
      html.push(
        `<div class="overflow-x-auto my-2.5 rounded-card border border-line bg-surface shadow-card"><table class="w-full border-collapse"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`,
      )
      li = ri - 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    // A rule, never a table separator: those need a pipe and matched above.
    const isRule = /^\s{0,3}([-*_])\1{2,}\s*$/.test(line)
    const indent = line.match(/^(\s*)/)![1].replace(/\t/g, '  ').length
    const ul = line.match(/^\s*[-*]\s+(.+)$/)
    const ol = line.match(/^\s*(\d+)\.\s+(.+)$/)
    const quote = line.match(/^\s*>\s?(.*)$/)

    if (heading) {
      flushBlocks()
      html.push(HEADING_HTML[heading[1].length](inline(heading[2])))
      continue
    }
    if (isRule) {
      flushBlocks()
      html.push('<hr class="my-3 border-0 border-t border-line" />')
      continue
    }
    if (ul || ol) {
      flushParagraph()
      const tag: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      const depth = Math.min(Math.floor(indent / LIST_INDENT_PER_LEVEL), MAX_LIST_DEPTH)
      while (listStack.length && listStack[listStack.length - 1].depth > depth) popList()
      const open = listStack[listStack.length - 1]
      if (!open || open.depth < depth) {
        // Opens inside the parent's still-open <li>, which is what makes this
        // real nesting instead of a second list parked beside the first.
        html.push(LIST_OPEN[tag])
        listStack.push({ tag, depth, itemOpen: false })
      } else if (open.tag !== tag) {
        // A bullet list turning into a numbered one at the same level: swap the
        // container without disturbing whatever item is holding it.
        closeItem(open)
        html.push(`</${listStack.pop()!.tag}>`)
        html.push(LIST_OPEN[tag])
        listStack.push({ tag, depth, itemOpen: false })
      } else {
        closeItem(open)
      }
      const level = listStack[listStack.length - 1]
      const text = ul ? ul[1] : ol![2]
      const task = text.match(/^\[([ xX])\]\s+(.+)$/)
      if (task) {
        const done = task[1] !== ' '
        html.push(
          `<li class="leading-relaxed list-none -ml-4 flex items-start gap-1.5"><span class="${done ? 'text-primary' : 'text-outline'} shrink-0">${done ? '☑' : '☐'}</span><span class="${done ? 'line-through opacity-70' : ''}">${inline(task[2])}</span>`,
        )
      } else {
        html.push(`<li class="leading-relaxed">${inline(text)}`)
      }
      level.itemOpen = true
      continue
    }
    if (quote) {
      flushBlocks()
      html.push(
        `<blockquote class="border-l-2 border-primary/40 pl-3 my-2 text-sm text-on-surface-variant italic">${inline(quote[1])}</blockquote>`,
      )
      continue
    }
    if (line.trim() === '') {
      // A blank line ends the block and emits nothing of its own: the spacer
      // div it used to push sat on top of the paragraph's own bottom margin
      // and doubled every gap.
      flushBlocks()
      continue
    }
    // A plain line continues the paragraph rather than starting a new one.
    flushLists()
    paragraph.push(line)
  }
  flushBlocks()
  if (inCode) {
    html.push(codeBlockHtml(codeLanguage, codeBuf, streaming))
  }
  return html.join('\n')
}
