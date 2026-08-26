# Qualification — cli-subscription-pi-loop（ADR-0052）

日期：2026-08-26 · 機器：開發機（macOS，有真實 Codex CLI 登入；無 Claude CLI 登入）
結論：**GO** — 六項全過，無降級。

## 1. 建置與靜態驗證 ✅

| 項目 | 結果 |
|---|---|
| `npm run build`（tsc -b + vite） | exit 0（`/tmp/build-final.log`） |
| `npx oxlint src` | 0 錯誤（含所有新檔：subscriptionCatalog、兩個訂閱元件、apiProviders、piProduction、三支 smoke/guard 腳本） |
| 完整 `npm run smoke`（`env -u SUBAGENTS_PI_SYNC_CLI_OAUTH` 淨空環境） | **OK - qualification chain passed**（99 支全綠，log `/tmp/smoke-final.log`） |

## 2. Protocol v4 negotiation ✅

- `smoke-pi-host-protocol.mts`：握手斷言升為 v4（host 接受 {4,3,2}、拒 v1），chain 內綠。
- `smoke-pi-child-session.mts`：70+ 個以 v2 發話的既有 script call site 相容性證據，chain 內綠。
- 實機複驗：`scripts/qualify-subscription-snapshot.mts` 與 `qualify-subscription-e2e.mts` 均以 v4 client 握手成功並取得完整 snapshot。

## 3. Fail-closed 矩陣 ✅

自動化（`smoke-subscription-catalog.mts`，chain 內綠）：conflict 全隱藏／未登入不回退 ambient key／runtime error 原文轉述／零模型不可選／bounding 可見／assemble≡project 等價。

實機活體證據（真 host、真 agent dir）：

```
subscriptionCatalog rows: openai-codex=available(models=7) anthropic=unavailable(models=0)
```

— 有 Codex 登入的 provider available 且列 7 個模型；無 Claude 登入的 provider unavailable。投影判定在真實資料上行為正確。

## 4. 真實端到端 ✅

`node scripts/qualify-subscription-e2e.mts gpt-5.4-mini` → **PASS**：

1. 隔離 agent dir + `SUBAGENTS_PI_SYNC_CLI_OAUTH=true` 啟動真 host entry → 真實 `~/.codex/auth.json` 匯入隔離 dir。
2. catalog 顯示 codex available（7 models）。
3. `settings/update {provider:'openai-codex', model:'gpt-5.4-mini'}` → patch 被接受。
4. `turn/submit 'Reply with exactly: pong'` → **settlement=answered**，經真實 Codex 訂閱後端回答；全程 builtin Pi loop，無 vendor binary 被 spawn。
5. `sessions/record` 含完整交換（Turn Record 是唯一 timeline 的契約成立）。

誠實觀察（非缺陷，是 fail-closed 契約的活體驗證）：

- 目錄首模型 `gpt-5.3-codex-spark` 被帳號拒絕（vendor 明確回覆「not supported by your current account」），呈現為**有解釋的 failed settlement**——壞狀態誠實可見。
- 一次對全部 7 個模型的連續掃描觸發限流導致全數失敗（短時間爆發）；單模型重試立即通過。UI 的逐模型嘗試節奏遠低於此強度。

Approval / outbound gate 一致性：由設計保證——`smoke-subscription-labeling.mts` 斷言 dispatch 路徑對訂閱 provider 零特殊分支，outbound gate 位於 `chatCompletionWithTools` 之下、與 credential 來源無關；HITL 政策由 Host 統一擁有。

## 5. 安全抽查 ✅

- `auth.json` 權限實測：`-rw-------`（0600）；agent dir `drwx------`（0700）。寫入路徑 `piUserConfig.ts` 以 `mode: 0o600` / `mkdir mode: 0o700` 原子寫。
- Snapshot 全文掃描（`qualify-subscription-snapshot.mts`，真機真憑證）：v4 握手後抓取 `settings/get` + `state/snapshot` + 全部事件，序列化全文比對 7 種 credential 形狀（access/refresh token 欄位、id_token、JWT 形狀、非空 apiKey、sk-/sk-ant- 字面值、account_id 欄位）→ **零命中**。探針只輸出判定、不輸出內容。
- Renderer 面積守恆：`smoke-subscription-labeling.mts` Guard 3 斷言新訂閱面檔案全面禁 credential 字串、既有大面禁訂閱憑證專屬標記。

## 6. 文件同步 ✅

- `CLAUDE.md` Settings 段補訂閱連線一行（credential Host-side、renderer 不送 baseUrl/apiKey、模型來自 bounded catalog、fail-closed）。
- `.scratch/INDEX.md` 本 effort 標 resolved。
- 六張 issue 全部 resolved；本檔為收口證據。

## 附錄：新增的可重跑驗證腳本

| 腳本 | 性質 | 是否進 chain |
|---|---|---|
| `scripts/smoke-subscription-labeling.mts` | 三支 source-text drift guards | ✅ 已掛鏈 |
| `scripts/qualify-subscription-snapshot.mts` | 安全探針（需真機憑證） | ❌ 資格驗證專用 |
| `scripts/qualify-subscription-e2e.mts` | 真實訂閱 E2E（需網路+登入，花費 token） | ❌ 資格驗證專用 |
