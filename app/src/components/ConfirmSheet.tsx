import { useEffect, useRef, type ReactNode } from 'react'
import { useDialogKeys } from '../hooks/useDialogKeys'
import { Icon } from './Icon'

export type ConfirmTone = 'neutral' | 'danger'

/**
 * Composer new-task flow（ticket 02）— 共用確認面板。
 *
 * 取代散落的原生 `confirm()`：原生對話框跳出作業系統樣式、無法說明後果、
 * 也不在 app 的鍵盤與視覺語彙裡。這裡沿用 PermissionAskModal 的決策面板語言
 * （同一組 overlay／card／footer token），讓「需要你決定」的畫面只有一種長相。
 *
 * 內容一律先渲染再動畫（動畫只動 transform），所以就算動畫never fire，
 * 文字與按鈕仍然完整可見。
 */
export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel = '確認',
  cancelLabel = '取消',
  tone = 'neutral',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  /** 確認動作進行中：鎖住兩顆按鈕，避免重複送出 */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // 開啟時把焦點帶進面板，關閉時交還給原本的元素——純鍵盤操作不會掉出對話框。
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    return () => previous?.focus?.()
  }, [open])

  useDialogKeys({ open, containerRef: cardRef, onClose: onCancel })

  if (!open) return null

  const danger = tone === 'danger'

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md animate-macos-fade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        data-testid="confirm-sheet"
        className="w-full max-w-md overflow-hidden rounded-card border border-line bg-surface animate-macos-sheet"
      >
        <div
          className={`primitive-card-pad flex items-start gap-3 border-b border-line ${
            danger ? 'bg-orange-tint' : 'bg-inset'
          }`}
        >
          <Icon
            aria-hidden
            name={danger ? 'history' : 'help'}
            size={18}
            className={`mt-0.5 shrink-0 ${danger ? 'text-orange' : 'text-ink-2'}`}
          />
          <div className="min-w-0">
            <h2 id="confirm-sheet-title" className="text-[14px] font-semibold text-ink">
              {title}
            </h2>
            <div className="mt-1 text-[12px] leading-relaxed text-ink-2">{description}</div>
          </div>
        </div>

        <div className="primitive-card-footer flex justify-end gap-2 border-t border-line bg-inset">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-hover disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-control px-3 py-1.5 text-[12px] font-semibold shadow-btn transition-[filter] hover:brightness-110 disabled:opacity-50 ${
              danger ? 'bg-orange text-canvas' : 'bg-ink text-canvas'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
