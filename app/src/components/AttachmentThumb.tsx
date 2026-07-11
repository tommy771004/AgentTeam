/** Image thumb that hydrates from filePath when dataUrl was stripped for storage */
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { ChatAttachment } from '../agent/types'

export function AttachmentThumb({ attachment: a }: { attachment: ChatAttachment }) {
  const [src, setSrc] = useState(a.dataUrl || '')

  useEffect(() => {
    setSrc(a.dataUrl || '')
    if (a.dataUrl || a.kind !== 'image' || !a.filePath) return
    const read = window.subagents?.attachments?.readDataUrl
    if (!read) return
    let cancelled = false
    void read(a.filePath).then((r) => {
      if (!cancelled && r.ok && r.dataUrl) setSrc(r.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [a.dataUrl, a.filePath, a.kind, a.id])

  if (a.kind === 'image' && src) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block" title={a.name}>
        <img
          src={src}
          alt={a.name}
          className="max-h-40 max-w-[220px] rounded-lg border border-white/10 object-contain bg-black/20"
        />
      </a>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-on-surface-variant"
      title={a.filePath || a.name}
    >
      <Icon name="draft" size={14} />
      {a.name}
      {a.filePath ? ' · 已落盤' : ''}
    </span>
  )
}
