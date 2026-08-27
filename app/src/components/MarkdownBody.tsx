import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/renderMarkdown'

/** Renders markdown as Codex-style chat body (safe HTML subset). */
export function MarkdownBody({
  content,
  className = '',
  streaming = false,
}: {
  content: string
  className?: string
  streaming?: boolean
}) {
  const html = useMemo(() => renderMarkdown(content || '', streaming), [content, streaming])
  const timers = useRef(new Map<HTMLButtonElement, number>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [html])
  const copyCode = async (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]')
    if (!button) return
    const container = event.currentTarget
    const code = button.closest('.agent-code-block')?.querySelector('code')?.textContent
    if (code == null) return
    button.disabled = true
    window.clearTimeout(timers.current.get(button))
    let outcome = 'success'
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(code)
    } catch {
      outcome = 'error'
    }
    // A streaming update may already have replaced this block while copying.
    if (!container.isConnected || !container.contains(button)) return
    button.disabled = false
    button.dataset.copyState = outcome
    const label = button.querySelector('[data-copy-label]')!
    label.textContent = outcome === 'success' ? '已複製' : '複製失敗'
    timers.current.set(button, window.setTimeout(() => {
      label.textContent = '複製'
      delete button.dataset.copyState
      timers.current.delete(button)
    }, 1500))
  }
  if (!content?.trim()) return null
  return (
    <div
      className={`markdown-body max-w-none break-words ${className}`}
      onClick={(event) => void copyCode(event)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
