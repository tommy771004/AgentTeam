import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal 的鍵盤契約，一份給所有 sheet 共用：Esc 關閉、Tab 在面板內循環。
 *
 * 沒有焦點收束的 modal 會讓 Tab 走到背後那層看不見的控制上——畫面停在對話框，
 * 焦點卻在別處，純鍵盤的人就迷路了。
 */
export function useDialogKeys({
  open,
  containerRef,
  onClose,
}: {
  open: boolean
  containerRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 巢狀 sheet：只關最上層那一個
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, containerRef, onClose])
}
