# 20 — `smoke:pi-host` 不在 gate 上，已經爛掉

**What to build:** `smoke:pi-host` 這條 47 支腳本的鏈納入 `npm run smoke`，並修好目前失敗的 5 支。一條沒有人跑的測試鏈，其綠燈不代表任何事。

**Blocked by:** 無。

**Status:** resolved

## 問題

`smoke:pi-host` 串了 47 支 `.mts`，包含 `smoke-pi-parity-removal.mts` —— 也就是 `.scratch/pi-host-tool-and-skill-parity` issues 14/15 據以授權刪除六個 renderer 工具的那份 parity 證據。

它**不在** `npm run smoke` 裡，因此 `dist*` 的 packaging gate 也不涵蓋它。沒有人跑，於是它悄悄爛掉了。

逐支執行後，目前 5 支失敗：

- `smoke-pi-host-codemode.mts`
- `smoke-pi-bash-tool.mts`
- `smoke-pi-host-pack-tools.mts`
- `smoke-pi-host-skills.mts`
- `smoke-pi-host-disclosure.mts`

（另外 `smoke-pi-host-run-config.mts` 與 `smoke-pi-parity-removal.mts` 已在發現當下修好 —— 見下。）

## 驗收條件

- [x] 上列 5 支逐一查明失敗原因，判定是**測試期望過時**還是**程式真的壞了**，分別處置。不得為了讓鏈變綠而放寬斷言。
- [x] `smoke:pi-host` 納入 `npm run smoke`，因此也進入 `dist*` 的 packaging gate。
- [x] 掃過 `package.json`，確認沒有其他 `smoke:*` 腳本同樣不在任何 gate 上；有的話一併納入或刪除。
- [x] 一條不在 gate 上的測試鏈不得再新增：加一個檢查，讓「定義了 smoke 腳本卻沒有被任何 gate 引用」在 build 失敗。

## 逐支查明結果（2026-08-25）

四支已處理，其中**一支是真的程式錯誤，不是測試過時**。

### `smoke-pi-bash-tool` — 真的壞了，已修

在 `approvalMode: 'full'` 之下，**危險指令可以不經核准直接執行**。ticket 07/10 把 direct protocol 遷到 `evaluatePiInvocationPolicy` 時，把 `bashDecision` 的結果放進了 `requirements.approvalRequired`；但那個欄位在 `full` 之下會被略過（`piPolicyEvidence.ts`：`if (approvalRequired && effectiveMode !== 'full')`）。

於是「危險／不可分割的指令一律 ask，allow pattern 不可越過」這條語意在 direct 路徑上消失了 —— 正是 `pi-host-tool-and-skill-parity/issues/15` 明列的驗收條件。

**修法**：`bashDecision.action === 'ask'` 時改走 `capabilityApproval`。那是設計上**能存活於 complete/full access** 的通道（`piPolicyEvidence.ts` 註解：「Capability-declared approval survives complete/full access」），語意正好吻合。`approvalRequired` 保留給一般副作用核准，仍可被 `full` 略過。

### `smoke-pi-host-run-config` — 我自己造成，已修

issue 18 讓 `buildRunContextPolicy` 多回 `gitPolicy`，期望值未更新。這正是「不在 gate 上的鏈會被自己的改動打壞而沒人知道」的實例。

### `smoke-pi-parity-removal` — 期望值過時，已修

範圍逃逸訊息改為 `path escapes the frozen Restricted Project View`。

### `smoke-pi-host-skills` — 一半期望值過時（已修），一半是既有產品缺口（未修）

路徑斷言原本要求字面的 `skills/` 路徑段；技能已改由 per-session resource view 供應（ADR-0034），該段不復存在。已改為斷言「一個可解析的絕對路徑指向該技能的 SKILL.md」—— 保住原意，不釘死刻意改掉的佈局。

但下一條「malformed skill 被回報為 diagnostic」仍失敗。這**不是測試的問題**：`pi-host-tool-and-skill-parity/issues/16` 早已被指出 —— Host 建了遷移報告，renderer 的 `App.tsx` 從未渲染 `report.results`。屬該票的未竟事項。

### 仍然紅的三支，以及為什麼我沒有動

- **`smoke-pi-host-codemode`**：無 `sessionId` 的 `tools/code` 現在回 `tool_contract_not_found`。`tools/bash` 有 `detachedIdentity` 退路，`tools/code` 沒有。這可能是遷移的疏漏，**也可能是刻意**：讓模型 JS 在沒有 session contract 的情況下執行，本來就值得禁止。兩種讀法都站得住，而這是安全相鄰的路徑 —— 我不猜。需要 ticket 07 的擁有者決定。
- **`smoke-pi-host-disclosure`**：巢狀 `http_fetch` 經 `run_code` 回傳空 text（`[{"type":"text","text":""}]`）。需要實際查明是 sandbox proxy 還是 pack 回傳的問題。
- **`smoke-pi-host-pack-tools`**：**測試設計問題**，非產品錯誤。它等一個「無人回應的 ask 自行逾時」，但 `waitFor` 只等 20 秒，而互動式核准逾時是 90 秒。這支會依時序時好時壞（我觀察到它在同一份程式碼上一次通過、兩次失敗）。要嘛讓 Host 在測試中用可注入的短逾時，要嘛把等待拉長。

## Comments

發現於修復 issue 15 遺失的負向覆蓋時。當時的斷言在 `smoke-pi-parity-removal.mts` 加不上去，才發現整條鏈根本沒在跑。

本次已順手修好兩支，因為它們擋住了正在進行的工作：

- `smoke-pi-host-run-config.mts`：`buildRunContextPolicy` 現在多回 `approvalTools` / `deniedTools`（frozen run policy），期望值未更新。
- `smoke-pi-parity-removal.mts`：範圍逃逸訊息已從 `outside the requested project scope` 改為 `path escapes the frozen Restricted Project View`，期望值未更新。**訊息變具體是進步，過時的是期望值。**

這兩支現在都綠。剩下 5 支未動 —— 它們看起來是另一個 session 進行中工作的產物，盲修有把未完成的工作粉飾掉的風險。


## 規模比這張票原本假設的大得多

原本以為是「一條 47 支的鏈沒接上」。實際掃過之後（以**檔案**為單位，而不是 npm script 名稱 —— 別名可能存在而檔案早已被 gate 直接以路徑執行）：

**189 個 smoke／qualify 檔案中，90 個從任何 gate 都到不了。** 接近一半的測試套件沒有人在跑。

### 新增 Guard 7

`check-pi-contract.mts` 現在展開 `smoke` / `build` / `dist*` 的所有 `npm run` 引用，取出實際被執行的檔案集合，比對 `scripts/` 下所有測試檔。實測新增一個沒被 gate 引用的測試檔 → build 失敗。

那 90 個列在 `KNOWN_UNGATED_TESTS` —— **是列出、不是豁免**。守衛因此立刻對任何**新**孤兒生效，而清空那份清單就是這張票的完成定義。同樣加了反向斷言：某檔案一旦被接上 gate，就必須從清單移除。

### 本輪修好的

- `smoke-pi-bash-tool` — 真的安全錯誤（`full` 之下危險指令免核准），改走 `capabilityApproval`。
- `smoke-pi-host-pack-tools` — 測試等 20 秒、核准逾時 90 秒，只能靠巧合通過。**修法不是把等待拉長**：`approvalTimeoutMs` 現在能隨 run 從 renderer 傳到 Host（`RunContextPolicy` → IPC → `freezePiRunPolicy`）。這同時補上一個真的缺口 —— `hitlTimeoutMs` 原本只到得了 browser loop，Pi Host 路徑上的 HITL 逾時根本無法設定，而 `CLAUDE.md` 寫的是 adapter 會把它交給 Host。連跑三次穩定通過。
- `smoke-pi-host-disclosure` — `http_fetch` 的回傳形狀自相矛盾：成功路徑回**原始 response body**，失敗路徑回 `{ok:false,…}`。同一個工具兩種形狀，呼叫者分不出「空的 404 body」和「工具沒回東西」。`details` 早就帶著結構化事實，現在模型看到的 `content` 與它一致。
- `smoke-pi-host-run-config` — 我自己在 issue 18 造成的（`gitPolicy` 新欄位）。
- `smoke-pi-parity-removal`、`smoke-pi-host-skills`（路徑那條）— 期望值過時。

### 鏈仍未接進 gate

`smoke:pi-host` 還有 2 支紅，接進去只會讓 gate 紅著：

- `smoke-pi-host-codemode` — 無 sessionId 的 `tools/code` 回 `tool_contract_not_found`。疏漏或刻意兩種讀法都成立，安全相鄰，等 ticket 07 擁有者決定。
- `smoke-pi-host-skills` — malformed skill 的 diagnostic 未被回報，屬 `pi-host-tool-and-skill-parity/issues/16` 的未竟事項（Host 建了報告，`App.tsx` 從未渲染）。


## 完成（2026-08-25）

五支全部處理完，`smoke:pi-host` 已接進 `npm run smoke`。gate 實際執行的測試檔 **99 → 152**，`KNOWN_UNGATED_TESTS` 欠債 **90 → 45**。

- `smoke-pi-host-codemode` — 不是疏漏。挖下去發現 Code Mode 綁的是**已發佈的 tool contract**，而 contract 只在 turn 內產生（`toolContracts.publish`）。這是 ADR-0050 的契約模型在運作，維持禁止。smoke 改為先斷言無 contract 被拒，再跑一個 trivial turn 建立 contract —— isolation／cancel 等既有覆蓋一條沒刪。
- `smoke-pi-host-disclosure` — `http_fetch` 成功路徑回原始 body、失敗路徑回 `{ok:false}`，同一工具兩種形狀。已統一。
- `smoke-pi-host-pack-tools` — 20s 等待對上 90s 核准逾時。修法是把 `approvalTimeoutMs` 從 renderer 接到 Host，順帶補上 `hitlTimeoutMs` 原本只到得了 browser loop 的缺口。
- `smoke-pi-host-skills` — 兩處期望值釘的都是 ADR-0034 刻意換掉的路徑佈局。診斷本身**一直都有**被回報（`description is required`），只是斷言在找舊路徑裡的 `broken` 字樣。第二處更值得記：smoke 自行用 `skillsDir` 組出 SKILL.md 路徑去讀，而那是模型從未被給過的位置，被 Restricted Project View 正確拒絕。改為讀**系統提示實際公告的位置** —— 這才是該驗證的性質。
- `smoke-pi-host-run-config` — 我自己在 issue 18 造成的。

## 最終收口（2026-08-27）

剩餘清單實際為 44 支，不是 tracker 沿用的 45 支。逐支執行與修正 stale expectations 後，37 支 deterministic tests 已接入 `smoke:orphan-closure`，並由主 `npm run smoke` 到達。舊 `smoke-coordinator-browser.mjs` 仍假設已移除的 renderer engine，已連同 npm alias 刪除，避免用相容實作粉飾。

最後 6 支是刻意由 operator 執行的 credential/release qualifications，不是 automated smoke：它們改由語意明確的 `MANUAL_QUALIFICATION_TESTS` 列表管理，且 `qualify:pi-host` / `qualify:pi-sync` 也有明確 npm 入口。Guard 7 現在要求所有其餘 deterministic test 都必須從主 gate 可達；`npm run check:pi-contract` 已綠。
