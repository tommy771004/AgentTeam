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
  const copyCode = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]')
    if (!button) return
    const code = button.closest('.agent-code-block')?.querySelector('code')?.textContent
    if (!code || !navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(code).then(() => {
      // docs/ui confirms the copy in place (label + green), not with a toast.
      button.textContent = '已複製'
      button.dataset.copied = 'true'
      window.setTimeout(() => {
        button.textContent = '複製'
        delete button.dataset.copied
      }, 1400)
    })
  }
  if (!content?.trim()) return null
  return (
    <div
      className={`markdown-body max-w-none break-words ${className}`}
      onClick={copyCode}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
