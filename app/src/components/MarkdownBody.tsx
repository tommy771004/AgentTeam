import { useMemo } from 'react'
import { renderMarkdown } from '../lib/renderMarkdown'

/** Renders markdown as Codex-style chat body (safe HTML subset). */
export function MarkdownBody({
  content,
  className = '',
}: {
  content: string
  className?: string
}) {
  const html = useMemo(() => renderMarkdown(content || ''), [content])
  if (!content?.trim()) return null
  return (
    <div
      className={`markdown-body max-w-none break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
