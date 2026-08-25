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

### 3.2 inactive 路徑的 `session.toolAudit` phase 對稱性未驗證（issue 19）

它走的是 issue 16 建立的同一個 publisher，所以理論上與 allow／deny 兩條路對稱 —— 但那是推論，沒有斷言證明。補一條即可。

### 3.3 `types.ts` 還原的完整性需要人確認

本次工作中我用 `git checkout --` 當 undo，炸掉了 `src/agent/types.ts`、`src/agent/llm.ts`、`src/store/settingsStore.ts` 的未 commit 修改 —— 其中包含另一個 session 進行中的工作。

已依編譯錯誤逐一還原（`gitPolicy`、`approvalTimeoutMs`、`GitCommandPolicy` import，以及 `deniedTools` / `approvalTools`），build / lint / contract guard / 完整 gate 全綠。**但編譯器只能抓到「有人用到卻不存在」的欄位；一個加了卻還沒有消費者的欄位不會報錯，也就不會被發現。** 請 tickets 01–12 的擁有者過目 `git diff` 中的 `types.ts`，確認沒有遺漏。

## 4. 已知但刻意不處理

- **Turn Record 的 `tool-call` args 記的是模型的請求，不是 Host 改寫後的指令。** 改寫本身在 evidence trail 裡（`Git 偏好已套用：…`），兩者合起來才是完整的帳。已釘成斷言，不是巧合。若日後要讓 args 反映實際執行值，那是 ADR-0050 的取捨，需要獨立決定。

## 驗收條件

- [ ] 1.1 五個欄位逐一決定並執行，`KNOWN_UNCONSUMED_SETTINGS` 清空。
- [ ] 1.2 `hermes/skills.ts` 過渡期的結束版本與負責人寫進 issue 17。
- [ ] 2.1 CI 的 Linux job 首次綠燈，issue 14 的三條打勾。
- [ ] 3.1 `KNOWN_UNGATED_TESTS` 清空，Guard 7 的欠債清單移除。
- [ ] 3.2 補上 inactive 路徑的 toolAudit 斷言。
- [ ] 3.3 tickets 01–12 擁有者確認 `types.ts` 還原無遺漏。
