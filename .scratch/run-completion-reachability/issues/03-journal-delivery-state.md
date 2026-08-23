# 03 — Journal 投遞狀態(delivered / pending-delivery)

**What to build:** run journal(ADR-0040)從狀態帳本升級為可投遞事件帳本的前半:finalization 在記 terminal marker 的同一同步段落,為每個 terminal run 記錄投遞狀態——擁有 thread 當時有活躍 renderer 且結果已寫入 bubble 為 `delivered`;terminal 但未消費為 `pending-delivery`。本 ticket 只建立記錄與判定,不改變任何使用者可見行為(補送在 04)。journal entry 維持 bounded metadata 原則:runId/threadId/status/timestamps,不存 prompt 或 payload。外部 CLI run 的記錄帶有 executionKind 標記,供 04 的文案區分。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] terminal 記錄路徑在同一同步段落寫入投遞狀態,不引入第二個寫入點
- [x] 判定規則單點化:UI 不各自猜測投遞與否
- [x] pending-delivery entry 帶 executionKind 與終態(status + dodMet/迭代資訊引用),external 一律標記「不得宣稱 DoD」
- [x] 既有行為零變化:無 pending-delivery 補送發生;啟動復原報告格式不變
- [x] journal 容量上限與既有 MAX_ENTRIES 淘汰策略相容,pending-delivery 不被靜默驅逐(或被驅逐時留下可見痕跡)
- [x] shipped-module smoke 斷言記錄形狀與判定規則
