const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
  json: 'JSON', py: 'Python', python: 'Python', sh: 'Shell', bash: 'Bash',
  css: 'CSS', html: 'HTML', sql: 'SQL', text: '純文字', code: '程式碼',
}
const HIGHLIGHT_LANGUAGES = new Set(['ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx', 'json'])
const KEYWORDS = new Set('export import from default async await function return const let var if else for while try catch finally throw new class extends this typeof instanceof in of true false null undefined'.split(' '))
const TOKENS = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|`(?:\\[\s\S]|[^`\\])*`?|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function tokenTone(token: string, following: string): string {
  if (token.startsWith('//') || token.startsWith('/*')) return 'comment'
  if (/^["'`]/.test(token)) return 'string'
  if (/^\d/.test(token)) return 'number'
  if (KEYWORDS.has(token)) return 'keyword'
  return /^\s*\(/.test(following) ? 'function' : ''
}

/** Lightweight lexical colour only; unknown languages remain escaped plain text. */
function highlightedLines(lines: string[], language: string): string[] {
  if (!HIGHLIGHT_LANGUAGES.has(language)) return lines.map(escapeHtml)
  const source = lines.join('\n')
  const output = ['']
  const append = (text: string, tone = '') => {
    text.split('\n').forEach((part, index) => {
      if (index > 0) output.push('')
      const safe = escapeHtml(part)
      output[output.length - 1] += tone ? `<span class="agent-code-${tone}">${safe}</span>` : safe
    })
  }
  let cursor = 0
  for (const match of source.matchAll(TOKENS)) {
    append(source.slice(cursor, match.index))
    cursor = match.index + match[0].length
    append(match[0], tokenTone(match[0], source.slice(cursor)))
  }
  append(source.slice(cursor))
  return lines.length ? output : []
}

export function readCodeFence(line: string, currentMarker: string) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
  if (!match) return null
  if (currentMarker && (match[1][0] !== currentMarker[0] || match[1].length < currentMarker.length || match[2].trim())) return null
  return { marker: match[1], info: match[2].trim() }
}

export function codeBlockHtml(info: string, lines: string[], streaming = false): string {
  const language = info.split(/\s+/)[0].toLowerCase() || 'code'
  const filename = info.match(/\b(?:title|filename)=(?:"([^"]+)"|'([^']+)'|(\S+))/)
  const title = filename ? `<span class="agent-code-filename">${escapeHtml(filename[1] ?? filename[2] ?? filename[3])}</span>` : ''
  const body = highlightedLines(lines, language)
    .map((line, index) => `<span class="agent-code-line">${line}${index === lines.length - 1 ? '' : '\n'}</span>`)
    .join('')
  return (
    `<div class="agent-code-block my-2.5 overflow-hidden rounded-card border border-line bg-surface shadow-card"${streaming ? ' data-streaming="true"' : ''}>` +
    '<div class="agent-code-header border-b border-line">' +
    `<span class="agent-code-title">${title}<span class="agent-code-lang">${escapeHtml(LANGUAGES[language] ?? language)}</span>` +
    `<span class="agent-code-count">${lines.length} 行</span></span>` +
    '<button type="button" data-copy-code aria-label="複製程式碼"><span class="agent-code-copy-icon" aria-hidden="true"></span><span data-copy-label aria-live="polite">複製</span></button></div>' +
    '<pre tabindex="0" aria-label="程式碼內容" class="agent-code-body overflow-x-auto bg-inset py-2.5 pr-3 pl-2 font-[family-name:var(--font-mono)] text-[12px] text-ink-2">' +
    `<code>${body}</code></pre></div>`
  )
}
