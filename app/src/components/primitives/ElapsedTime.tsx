import { useEffect, useState } from 'react'

/**
 * docs/ui「Loading State」的等寬計時器：長時間執行時，讓人看得出來還在動。
 *
 * 刻意做成獨立 leaf。RunProcessFeed 每次 render 都會重算數個 useMemo，
 * 計時器若寫在裡面等於每秒逼它重算十次；抽出來後只有這個節點會重繪。
 * 未滿一分鐘用十分之一秒（動得夠明顯），之後改成整秒並降到每秒一次。
 */
export function ElapsedTime({
  startedAt,
  className = '',
}: {
  startedAt: number
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  const coarse = startedAt > 0 && now - startedAt >= 60_000

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), coarse ? 1_000 : 100)
    return () => clearInterval(timer)
  }, [coarse])

  if (!startedAt || startedAt > now) return null

  const seconds = (now - startedAt) / 1000
  const text =
    seconds < 60
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`

  return (
    <span className={`font-[family-name:var(--font-mono)] tabular-nums ${className}`}>{text}</span>
  )
}
