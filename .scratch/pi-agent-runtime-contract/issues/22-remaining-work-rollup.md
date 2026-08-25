# 22 — 剩餘未完成事項彙整

**What to build:** 一張把 2026-08-25 這批工作留下的所有未竟事項收在一起的追蹤票，讓每一項都有明確的擁有者與完成定義。個別票仍是事實來源；這裡是清單與優先序。

**Blocked by:** 無。

**Status:** 可交給代理

## 1. 需要人決定的（我沒有猜）

### 1.1 七個孤兒 Settings 欄位 → 實為五個（issue 21）

`check-pi-contract.mts` Guard 6 找出使用者能撥動、但不改變任何執行行為的設定。**注意：第一版守衛有偽陽性** —— 它把整個 `agent/llm.ts` 當宣告處排除，但那個檔案同時放預設值和真正的消費邏輯，害 `llmRetryMaxAttempts` / `llmCircuitBreakerEnabled` 被誤列。守衛已修正為只排除 defaults 字面量，真正的孤兒是**五個**：

- `llmParseEnabled`
- `classificationEndpointUrl`
- `classificationAllowPlaintextHttp`
- `concurrentRunsEnabled`
- `ambientSuggestions`

宣告面（`types.ts` / `llm.ts` / `settingsStore.ts`）刪除是機械性的，**但 `classificationEndpointUrl` 綁著 `SettingsPage.tsx` 一整塊「測試分類器連線」的 UI**，那是需要產品決定與目視驗證的手術。逐欄位決定「接上行為」或「移除」。

`classificationEndpointUrl` / `classificationAllowPlaintextHttp` 名稱暗示會送資料到外部端點：若選擇接上，必須先通過 Outbound Data Gate 的審視，不得繞過。

### 1.2 `hermes/skills.ts` 的 read-only 過渡期何時結束（issue 17 / 前一 effort 的 issue 18）

檔案仍在，Guard 3 凍結其 4 個消費者。過渡設計本身合理，但沒有寫下它在哪個版本結束、由誰收尾。

## 2. 等 CI 首次綠燈

### 2.1 Linux bubblewrap 的三條驗收（issue 14）

`.github/workflows/ci.yml` 的 `verify` job 已加兩個 Linux-only 步驟（安裝 bubblewrap、跑 `smoke-pi-bwrap-builtin-shell.mts`）。實作與 smoke 都在，但 **kernel 才能回答的斷言在本機（macOS）從未執行過**。CI 首次綠燈後才可打勾：

- 真實 Pi bash turn 完成 view 內操作並回 success settlement
- View 外讀取／寫入與 network 在 sandbox 層失敗
- Linux qualification 覆蓋 verified success、unsupported、probe failure、view escape、replay refusal、cancellation

## 3. 技術債，可直接派

### 3.1 45 個測試檔仍不在任何 gate 上（issue 20）

`KNOWN_UNGATED_TESTS` 從 90 降到 45。清空它是 issue 20 的完成定義。每一支都要先查明「期望值過時」還是「程式真的壞了」—— 這批五支裡就有一支是**真的安全錯誤**（`full` 模式下危險指令免核准），不能假設剩下的都只是過時。

### 3.2 inactive 路徑的 `session.toolAudit` phase 對稱性未驗證（issue 19）—— 已完成

補了三條斷言（見 issue 19）。結論比推論精確：執行的兩個 phase（`start` + 恰好一個
`result`）確實對稱，第三個 `decision` **刻意缺席** —— activation 在 Approval
Decision 之前就拒絕了，沒有裁決可記，補一個假的才是錯的。順帶釘住「未知名稱記
`failed`、未啟用記 `denied`」在稽核層也不得collapse。已 mutation 驗證會咬。

### 3.3 `types.ts` 還原的完整性需要人確認

本次工作中我用 `git checkout --` 當 undo，炸掉了 `src/agent/types.ts`、`src/agent/llm.ts`、`src/store/settingsStore.ts` 的未 commit 修改 —— 其中包含另一個 session 進行中的工作。

已依編譯錯誤逐一還原（`gitPolicy`、`approvalTimeoutMs`、`GitCommandPolicy` import，以及 `deniedTools` / `approvalTools`），build / lint / contract guard / 完整 gate 全綠。**但編譯器只能抓到「有人用到卻不存在」的欄位；一個加了卻還沒有消費者的欄位不會報錯，也就不會被發現。** 請 tickets 01–12 的擁有者過目 `git diff` 中的 `types.ts`，確認沒有遺漏。

## 4. 已知但刻意不處理

- **Turn Record 的 `tool-call` args 記的是模型的請求，不是 Host 改寫後的指令。** 改寫本身在 evidence trail 裡（`Git 偏好已套用：…`），兩者合起來才是完整的帳。已釘成斷言，不是巧合。若日後要讓 args 反映實際執行值，那是 ADR-0050 的取捨，需要獨立決定。

## 驗收條件

- [x] 1.1 五個欄位逐一決定並執行，`KNOWN_UNCONSUMED_SETTINGS` 清空。
- [x] 1.2 `hermes/skills.ts` 過渡期改為版本到期，build 會自己提醒。
- [ ] 2.1 CI 的 Linux job 首次綠燈，issue 14 的三條打勾。
- [ ] 3.1 `KNOWN_UNGATED_TESTS` 清空，Guard 7 的欠債清單移除。
- [x] 3.2 補上 inactive 路徑的 toolAudit 斷言。
- [x] 3.3 `types.ts` 還原完整性已用交叉比對驗證，不需人工過目。


## 收斂（2026-08-25 後續）

### 1.1 完成 — 七個名字是四種不同的事

兩個是守衛誤報（`agent/llm.ts` 同時放預設值和執行邏輯，被整檔排除）；一個不是假開關（`concurrentRunsEnabled` 無 UI、刻意保留的相容欄位）；一個功能沒建（`ambientSuggestions` → 已建）；一個功能已被架構取代（`llmParseEnabled` → 已刪，Pi Core 接管 settlement 後 per-objective DoD 不存在）；兩個功能沒做完（分類器 → 已接進出站流程，`required` fail closed）。詳見 issue 21。

### 1.2 完成 — 過渡期改成會自己到期

Guard 3 原本只在註解寫「survives one release」，沒有任何機制提醒 —— 這正是暫時檔案變永久的方式。改為 `SKILLS_ROLLBACK_WINDOW_ENDS_BEFORE = '1.2.0'`：版本一到就 build 失敗，訊息要求刪除或**刻意**延長。實測 1.1.0 過、1.2.0 失敗。

### 3.3 完成 — 不需要人工過目

`electron/piSessionContext.ts` 的 Host 端 parser 沒被 checkout 波及，是同一份契約的另一端。欄位集合對比顯示「Host 有、renderer 型別沒有」為**空** —— 還原完整。

反向比對另外查出兩個真問題，一併修掉：

- `shellIsolationVerified` 是惰性欄位（ticket 12 移除 Host 端讀取後，型別宣告留著，只剩 smoke 引用）。已移除，使「renderer 無法宣稱隔離」由**結構**成立而非靠斷言 —— 原本的 `assert.equal(..., undefined)` 只證明「這個生產者沒設」。
- `preload.ts` 的 contextPolicy 型別漏了 `approvalTools` / `deniedTools`。runtime 能動但型別介面少講，與先前 `outboundShellMode` 同一類。已補。

### 仍未完成

- **3.1** 45 個測試檔不在 gate 上（建議下一個做，這次接上的那批就抓到一個真的安全漏洞）
- **3.2** inactive 路徑的 toolAudit 對稱性未驗證
- **2.1** Linux bubblewrap 等 CI 首次綠燈
