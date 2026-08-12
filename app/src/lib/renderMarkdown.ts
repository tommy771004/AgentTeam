/**
 * Lightweight markdown → safe HTML for chat / report (Codex-style reading).
 * No external deps; escapes HTML first, then applies a small subset.
 */

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-on-surface font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-on-surface-variant">$1</em>')
    .replace(
      /`(.+?)`/g,
      '<code class="px-1 py-0.5 rounded bg-black/30 text-primary font-[family-name:var(--font-mono)] text-[12px]">$1</code>',
    )
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="text-primary underline underline-offset-2">$1</a>',
    )
}

/**
 * docs/ui「Code Block」：標頭放語言與行數、右側是複製，程式碼本體帶行號側欄。
 * 每一行包成 span 並保留行內的 \n，行號是 CSS counter 產生的 ::before，
 * 所以 `code.textContent`（複製按鈕的來源）拿到的仍是乾淨的原始程式碼。
 */
function codeBlockHtml(language: string, lines: string[]): string {
  const body = lines
    .map(
      (line, i) =>
        `<span class="agent-code-line">${esc(line)}${i === lines.length - 1 ? '' : '\n'}</span>`,
    )
    .join('')
  return (
    '<div class="agent-code-block my-2.5 overflow-hidden rounded-lg border border-white/10 bg-[#0b1326]">' +
    '<div class="agent-code-header">' +
    `<span class="agent-code-title"><span class="agent-code-lang">${esc(language)}</span>` +
    `<span class="agent-code-count">${lines.length} 行</span></span>` +
    '<button type="button" data-copy-code aria-label="複製程式碼">複製</button></div>' +
    '<pre class="agent-code-body overflow-x-auto py-2.5 pr-3 pl-2 font-[family-name:var(--font-mono)] text-[12px] text-primary-fixed-dim">' +
    `<code>${body}</code></pre></div>`
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

export function renderMarkdown(md: string): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let codeLanguage = 'code'
  let inUl = false
  let inOl = false

  const flushLists = () => {
    if (inUl) {
      html.push('</ul>')
      inUl = false
    }
    if (inOl) {
      html.push('</ol>')
      inOl = false
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (line.startsWith('```')) {
      if (inCode) {
        html.push(codeBlockHtml(codeLanguage, codeBuf))
        codeBuf = []
        codeLanguage = 'code'
        inCode = false
      } else {
        flushLists()
        inCode = true
        codeLanguage = line.slice(3).trim() || 'code'
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }

    // GFM 表格：表頭列 + 分隔列（|---|---|）
    if (isTableRow(line) && li + 1 < lines.length && isTableSeparator(lines[li + 1])) {
      flushLists()
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
            `<th class="px-3 py-1.5 text-left text-xs font-semibold text-on-surface border-b border-white/15 whitespace-nowrap">${inline(h)}</th>`,
        )
        .join('')
      const tbody = rows
        .map(
          (cells) =>
            `<tr class="border-t border-white/8">${headers
              .map(
                (_, ci) =>
                  `<td class="px-3 py-1.5 text-sm text-on-surface-variant align-top">${inline(cells[ci] ?? '')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')
      html.push(
        `<div class="overflow-x-auto my-2.5 rounded-lg border border-white/10 bg-surface-container/40"><table class="w-full border-collapse"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`,
      )
      li = ri - 1
      continue
    }

    const h1 = line.match(/^#\s+(.+)$/)
    const h2 = line.match(/^##\s+(.+)$/)
    const h3 = line.match(/^###\s+(.+)$/)
    const ul = line.match(/^[-*]\s+(.+)$/)
    const ol = line.match(/^(\d+)\.\s+(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)

    if (h1) {
      flushLists()
      html.push(
        `<h1 class="text-xl font-bold text-on-surface mb-2 mt-1 font-[family-name:var(--font-sora)]">${inline(h1[1])}</h1>`,
      )
    } else if (h2) {
      flushLists()
      html.push(
        `<h2 class="text-base font-semibold text-on-surface mt-4 mb-1.5 font-[family-name:var(--font-sora)]">${inline(h2[1])}</h2>`,
      )
    } else if (h3) {
      flushLists()
      html.push(
        `<h3 class="text-sm font-semibold text-primary mt-3 mb-1">${inline(h3[1])}</h3>`,
      )
    } else if (ul) {
      if (inOl) {
        html.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        html.push('<ul class="list-disc pl-5 space-y-1 text-on-surface-variant text-sm my-1.5">')
        inUl = true
      }
      const task = ul[1].match(/^\[([ xX])\]\s+(.+)$/)
      if (task) {
        const done = task[1] !== ' '
        html.push(
          `<li class="leading-relaxed list-none -ml-4 flex items-start gap-1.5"><span class="${done ? 'text-primary' : 'text-outline'} shrink-0">${done ? '☑' : '☐'}</span><span class="${done ? 'line-through opacity-70' : ''}">${inline(task[2])}</span></li>`,
        )
      } else {
        html.push(`<li class="leading-relaxed">${inline(ul[1])}</li>`)
      }
    } else if (ol) {
      if (inUl) {
        html.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        html.push('<ol class="list-decimal pl-5 space-y-1 text-on-surface-variant text-sm my-1.5">')
        inOl = true
      }
      html.push(`<li class="leading-relaxed">${inline(ol[2])}</li>`)
    } else if (quote) {
      flushLists()
      html.push(
        `<blockquote class="border-l-2 border-primary/40 pl-3 my-2 text-sm text-on-surface-variant italic">${inline(quote[1])}</blockquote>`,
      )
    } else if (line.trim() === '') {
      flushLists()
      html.push('<div class="h-2"></div>')
    } else {
      flushLists()
      html.push(
        `<p class="text-sm text-on-surface leading-relaxed mb-2">${inline(line)}</p>`,
      )
    }
  }
  flushLists()
  if (inCode) {
    html.push(codeBlockHtml(codeLanguage, codeBuf))
  }
  return html.join('\n')
}
