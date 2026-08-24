# 03 — Turn Record：Host 在既有歷史旁附加一份有 seq 的帳本（expand）

**What to build:** Pi Core Host 在每個回合執行的同時，寫下一份 append-only、有序號的 **Turn Record**：誰說了什麼、呼叫了哪個工具、工具回了什麼、核准怎麼決定的、上下文在哪裡被壓縮過，每一筆都帶 `seq`、所屬回合與步驟、以及時間戳。這一票只**新增**，既有的 `messages` 與 `toolAudit` 一字不動，所以沒有任何現有行為改變 —— 可驗證的成果是：跑完一個用了工具的回合之後，可以從 Host 讀出一份依序、可重播、跨 Host 重啟仍然連續的記錄。

**Blocked by:** 01（帳本上的結算條目要直接記閉合聯集，避免落地後再改一次形狀）

**Status:** 可交給代理

- [x] Turn Record 是 append-only 的條目串，條目以 kind 標記的 discriminated union：回合邊界、步驟邊界、user 文字、assistant 文字、tool call、tool result、核准決策、compaction checkpoint
- [x] 每一筆帶 `seq`（單調遞增）、`turn`、`step`、時間戳；顯示順序永遠由 `seq` 決定，不由陣列位置或 map 迭代決定
- [x] 記錄隨 session 持久化，並隨 Pi Host Protocol 版本化
- [x] 版本讀不懂時**大聲拒絕**，不當成空記錄；尾端寫壞的條目被偵測並回報，不靜默丟棄
- [x] 補上 ticket 01 延後的 protocol 版本升級：`runs/settle` 已拒絕退役的 `'success'`、`turn/submit` 已回新結算詞彙，但 `PI_HOST_PROTOCOL_VERSION` 仍是 `1`。ADR-0038 要求這是有版本的協定，且本票本來就要把 Turn Record 隨協定版本化 —— 兩件事一起升。注意 blast radius：40 個檔案送 `protocolVersion: 1`，`piHostReleaseEvidence` 也斷言 1，所以這同時是一次 release qualification 變更
- [x] `messages` 與 `toolAudit` 在這一票維持原樣，既有 smoke 不需修改即應全綠
- [x] ADR-0048 的執行證據仍由受信任的 adapter 發出：帳本區分「Host 執行過的」與「模型宣稱的」
- [x] Seam 1 smoke：一個含工具往返的回合寫出預期的條目序列與座標
- [x] Seam 1 smoke：Host 重啟後同一 session 的帳本連續，序號不重置、不斷號

## Comments

**Implemented and verified.**

The record lives in `src/agent/turnRecord.ts` — shared vocabulary, no execution, so the Host appends and the renderer will read the same module (tickets 04/05).

- **Ten entry kinds** as a discriminated union, each carrying `seq` / `turn` / `step` / `at`. `turnRecordEntries()` sorts by `seq`, so display order is never array position and never map iteration order.
- **`source` is on every entry** (ADR-0048): `user` said it, `model` claimed or asked for it, `host` did or decided it. A `tool-call` is `model` (the model asking); the matching `tool-result` and `approval` are `host`, taken from the tool audit — the trusted adapter's own account, not the model's.
- **Entries are recorded when they happen**, not collected afterwards. They arrive from three places with no shared call stack — the turn handler, the Pi event stream, and the tool audit — so the recorder is held per session in a module map for the life of the turn.
- **Three load outcomes, deliberately different.** An unreadable *version* throws; a damaged entry *in the middle* throws; a damaged *final* entry is a torn append, so the good prefix is kept and the loss is reported to stderr. The validation runs outside the state parser's `catch` on purpose — falling back to an empty state there would turn "this build cannot read your history" into "you have no history", which is data loss performed rather than reported.

**Protocol bumped to version 2** (the item deferred from ticket 01). Version 2 retired the ambiguous `success` settlement and added the record to a session, so a version-1 peer would both misread a settlement and miss the record. 42 files updated, including `piHostReleaseEvidence`, which is why this was a release-qualification change and not a settlement change.

`messages` and `toolAudit` are untouched, as the ticket required — every existing smoke passes unmodified. Turning them into projections of the record is ticket 04.

Two notes for the tickets that follow:
- The record is committed once, at turn end. Good enough for restart continuity (asserted), but a crash mid-turn loses that turn's entries. If incremental durability is wanted, it belongs with ticket 09/10 rather than here.
- `sessions/list` currently returns the whole record with each session. That is fine at this size and is exactly what ticket 10 replaces with a paged read.
