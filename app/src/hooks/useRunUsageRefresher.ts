import { useEffect } from 'react'
import { useAgentStore } from '../store/agentStore'
import { useRunActivityStore } from '../store/runActivityStore'

/**
 * 即時上下文用量 — run 活著時，定期向 Host 拉一頁最新的 Turn Record。
 *
 * 推送事件（pi-host:event）是主要資料流，但背景視窗節流、reattach 縫隙或一次
 * transport hiccup 都可能讓 renderer 少收到幾筆——用量數字就此凍結在舊值。這個
 * 輪詢是自癒補丁：每幾秒對時一次，只把 seq 比已知更新的項目寫回 store。
 *
 * 生命週期契約：
 * - 只在 `active` 期間輪詢；run 結束或元件卸載即停止，interval 一律清除。
 * - 同一 runId 的請求以 module 層 in-flight 表去重——多個掛載面（feed＋右欄）
 *   共享同一道未完成請求，不會疊加 IPC。
 * - 沒有新項目就「不寫 store」：appendRecordEntries 在全已知時回傳原物件，
 *   selector 輸出保持同一 reference，訂閱該 store 的區塊不會跟著重繪、不閃爍。
 */
const POLL_MS = 3000

const inflight = new Map<string, Promise<void>>()

function pullLatestPage(runId: string): Promise<void> {
  const pending = inflight.get(runId)
  if (pending) return pending
  const task = (async () => {
    try {
      const attach = window.subagents?.piHost?.runs?.attach
      if (typeof attach !== 'function') return
      const { page } = await attach(runId)
      const entries = page?.entries ?? []
      const newestPage = entries.at(-1)?.seq ?? 0
      if (!entries.length || newestPage <= 0) return
      const presentation = useRunActivityStore.getState().presentations[runId]
      const newestKnown = presentation?.recordEntries.at(-1)?.seq ?? 0
      if (newestPage <= newestKnown) return
      // 晚到的頁面不得翻轉已結束的 run：appendRecordEntries 會把 presentation
      // 翻回 active，所以寫回前以活躍集合為最終裁決（ticket 04）。
      if (!useAgentStore.getState().activeRunIds.includes(runId)) return
      useRunActivityStore.getState().appendRecordEntries(entries, runId)
    } catch {
      // Host 暫時不可達：略過這一輪，下一輪再對時；輪詢本身不中斷。
    } finally {
      inflight.delete(runId)
    }
  })()
  inflight.set(runId, task)
  return task
}

export function useRunUsageRefresher(runId: string | undefined, active: boolean): void {
  useEffect(() => {
    if (!runId || !active) return
    if (typeof window.subagents?.piHost?.runs?.attach !== 'function') return
    const timer = window.setInterval(() => {
      // 隱藏時跳過——推送事件不受可見度影響，輪詢只是自癒，聚焦後自然追上。
      if (document.visibilityState === 'hidden') return
      void pullLatestPage(runId)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [runId, active])
}
