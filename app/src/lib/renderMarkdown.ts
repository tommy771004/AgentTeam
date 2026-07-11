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

export function renderMarkdown(md: string): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeBuf: string[] = []
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

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        html.push(
          `<pre class="bg-[#0b1326] border border-white/10 rounded-lg p-3 overflow-x-auto font-[family-name:var(--font-mono)] text-[12px] text-primary-fixed-dim my-2.5"><code>${esc(codeBuf.join('\n'))}</code></pre>`,
        )
        codeBuf = []
        inCode = false
      } else {
        flushLists()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
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
      html.push(`<li class="leading-relaxed">${inline(ul[1])}</li>`)
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
    html.push(
      `<pre class="bg-[#0b1326] border border-white/10 rounded-lg p-3 font-[family-name:var(--font-mono)] text-[12px]"><code>${esc(codeBuf.join('\n'))}</code></pre>`,
    )
  }
  return html.join('\n')
}
