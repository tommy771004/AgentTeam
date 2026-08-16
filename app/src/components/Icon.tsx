type IconProps = {
  name: string
  className?: string
  filled?: boolean
  size?: number
  /**
   * 純裝飾的圖示標為 true：ligature 字型的字面（'track_changes'）會被讀進
   * 可及性名稱裡，讓「目標」按鈕被念成「track_changes 目標」。
   */
  'aria-hidden'?: boolean
}

export function Icon({
  name,
  className = '',
  filled = false,
  size,
  'aria-hidden': ariaHidden,
}: IconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      aria-hidden={ariaHidden}
      style={{
        fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0",
        fontSize: size ? `${size}px` : undefined,
      }}
    >
      {name}
    </span>
  )
}
