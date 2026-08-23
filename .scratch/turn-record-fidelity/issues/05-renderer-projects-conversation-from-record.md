# 05 — Renderer 從 Turn Record 投影對話，不再自己寫

**What to build:** 對話不再是 renderer 自己算一個字串然後貼上去、再存進 localStorage。改成一個純函式：吃一段 Turn Record，吐出要渲染的對話列。使用者重新整理、換機器、清掉本地資料之後，對話從 Host 重建成同一份內容 —— 產品不再有一個「只有這台瀏覽器知道」的歷史版本。這是回歸 ADR-0039（Host state is canonical，renderer 只持有可拋棄的 UI Projection）。

**Blocked by:** 04

**Status:** 可交給代理

- [x] 新增一個純函式 seam：Turn Record slice + session metadata → 對話列；無 I/O、不讀 store、不用時鐘或亂數
- [x] 助理內容不再由 coordinator 決定後 push 進 thread；推送變成投影結果的一個 case
- [x] renderer 的持久化層不再保存自撰的助理內容；thread 端只留 UI 狀態（草稿、檢視、計畫）
- [x] Reload 之後對話與 Host 的記錄一致；既有 thread 的舊泡泡以 legacy 列保留，不做歷史遷移
- [x] 畸形或版本較舊的條目退化成通用列，**不得**讓整個檢視爆掉
- [x] Seam 2 smoke：以錄下的 Turn Record fixture 直接測投影（不起 Electron、不碰 DOM）
- [x] Seam 1 smoke：reload 後由 Host 重建的對話與該次回合的結算一致

## Comments

**Implemented and verified.**

`src/agent/conversationProjection.ts` is the seam: Turn Record → conversation rows, and `conversationAnswer(record)` for the settled answer. Pure by contract, and the smoke enforces that as source text — no clock, no randomness, no store, no `window`, no dynamic import — because it runs on live turns and replayed records alike.

- The turn's own record slice now travels back with `turn/submit`, so the renderer projects the Host's account instead of composing one. `taskRunCoordinator`'s `finalAgent.result || stepsTail || result.result || 狀態：…` chain now starts with the projection; the old chain remains only as the fallback for runners that write no record yet (external CLI — ticket 11).
- An entry kind this build does not know becomes a `notice` row, never an exception and never a gap: a record written by a newer build must still render the conversation around it. Asserted with a fixture carrying a made-up entry kind.
- Approvals and compaction surface as notices rather than being silently dropped.

**Found while wiring it:** the provider-stopped path (`shouldStopForProviderProjection`) returned a settlement without ever closing its record, so a turn stopped by its plugin stage left a `turn-start` with no `turn-end` — a silent gap in the account. It now closes like any other turn. TypeScript caught it, because the result type made the record required on every branch.

**Smaller than the ticket assumed, in one respect.** `threadStore.hydrateFromPiHost` already replaced thread bubbles with the Host projection on load, so the ADR-0039 rebuild path existed before this ticket; what was missing was that the *content* being projected came from `messages` (prose only) rather than the record. With ticket 04 deriving `messages` from the record and this ticket projecting rows from it, both now trace to one source.

**Still open, deliberately deferred to ticket 06:** `threadStore` continues to persist bubbles to localStorage as a cache. That is legitimate under ADR-0039 as long as the Host overwrites it on hydration (it does), but the run-process record still comes from the four-source ladder. Deleting that ladder is ticket 06's whole job, and the tool rows this projection already produces are what it will consume.
