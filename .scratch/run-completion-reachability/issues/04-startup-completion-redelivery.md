# 04 — 重啟補送(pending-delivery 完成事件)

**What to build:** App 重啟後,啟動復原管線對「success 但 pending-delivery」的 run,在其擁有 thread 補一則系統 bubble(objective、結束時間、結果摘要;耗盡收尾的 run 帶 01 的誠實文案;external CLI 只說「已結束」不宣稱 DoD)。每個事件恰好補送一次;無法對應到存活 thread 的 entry 如實以「結果未知」項目呈現(不宣稱成功也不宣稱失敗,ADR-0048 語意)。使用者重開 app,thread 裡有「你不在時任務完成了」的敘事,而不是空白。

**Blocked by:** 03 — journal 投遞狀態;01 — iteration-exhausted 語彙(補送文案消費)。

**Status:** resolved

- [x] 補送走既有 reconcileStartup → recovery report → 系統 bubble + OS notify 路徑,不新開第二條恢復路徑
- [x] 每個 pending-delivery entry 補送後標記 consumed;反覆重啟不重複
- [x] 補送訊息落在擁有 thread;thread 已不存在時,該項以「結果未知」進入復原報告
- [x] external CLI run 的補送文案不宣稱 DoD;耗盡收尾帶「未達 DoD · 用盡 N 輪」
- [x] 補送訊息含 objective、結束時間、結果摘要;無法證明 side effects 的情況不宣稱成功
- [x] 既有 interrupted/quarantined 復原行為不變;fail-closed 序列不受影響
- [x] smoke(shipped-module)涵蓋:補送恰好一次、正確 thread 導向、unknown 標注、external 文案

## 實作備註

- `claimPendingRunDeliveries()` 會一次認領所有 terminal 的 pending-delivery run（不只 success），在同一次寫入標記 consumed。success 且擁有 thread 仍存活者補一則系統 bubble；非 success 者只在復原報告留一行。若只認領 success，失敗的 pending entry 會永遠留在 journal 並被 retention 保護，形成無上限累積。
- 補送訊息末行固定聲明「內容取自本機執行紀錄，未重新驗證任何變更」——journal 只存 bounded metadata，沒有 side effect 佐證，因此不宣稱成功已驗證（ADR-0048）。
- 02 的即時 toast 會呼叫 `markRunDelivered()`，所以「使用者當下已被告知、但沒重啟」的 run 不會在下次啟動被當成新消息再講一次。
