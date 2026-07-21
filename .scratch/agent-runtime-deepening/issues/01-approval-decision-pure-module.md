# 01 — 核准決策抽成純模組

**What to build:** 把 `authorizeTool`現行 9 層判斷中的前 8 層（plan mode、policy、bash 段級、capability approvalTools、hooks、forceAsk、mcpWrite 啟發式、unattended/full-access 降級）收進一個純函式 `decide()`，回傳 `{ verdict, reason, logs[], events[], askSpec? }`（效果即資料）；第 9 層（HITL ask）與所有效果（notify/metrics/log）留在既有 guard adapter。bash 段級判斷所需的 resolver 以函式形式作為輸入。決策語意 bit-for-bit 保留（含 bash allowlist 清除先前 ask 的既有怪癖），唯一例外是三類先前不發送 `permissionDenied` 事件的 deny 路徑——這是觀測缺口，修正為與其他 deny 路徑一致都發送事件。既有兩個呼叫端（function-calling 工具迴圈、engine 的 heuristic 路徑）外部介面零改動。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 純函式 `decide()` 涵蓋前 8 層判斷，輸入含 tool/args/settings 旗標/blockedTools/plan mode 狀態/policy/projection/bash resolver/hookRules/forceAsk/sideEffect/unattended/mode，輸出含 verdict、reason、logs[]、events[]、可選 askSpec。
- [x] hook deny 贏過一切（含 full-access）；capability 宣告的核准在 full-access 下仍生效——兩條既有優先序 bit-for-bit 保留。
- [x] bash 段級 allow 清除先前 policy ask 的既有怪癖，原樣保留，不修正。
- [x] 三類先前不發 `permissionDenied` 事件的 deny 路徑（sub-agent gate／blockedTools／SubDesign gate），修正為與其他 deny 路徑一致，events[] 帶完整事件。
- [x] unattended 時 full-access 降級為 auto；unattended + side-effect 一律 ask；mcpWrite 名稱啟發式強制 ask——三條既有語意 bit-for-bit 保留。
- [x] 既有兩個呼叫端（function-calling 工具迴圈、engine heuristic 路徑）的呼叫介面零改動。
- [x] 新測試套件真 import `decide()`，涵蓋上述優先序案例矩陣，decision 相關欄位精確比對、日誌只鎖 level+關鍵字；既有手抄鏡像測試刪除，由新套件承接測試意圖。
- [x] `npm run build`、`npm run smoke`、`npx oxlint src` 全綠；人工核對新純函式與被取代的既有內聯判斷順序逐層對齊。

## Comments

### Grilling session 決策摘要（2026-07-20）

- Seam：1–8 層全入純模組，第 9 層與效果留在 adapter。
- 效果即資料：`decide()` 回傳 `{ verdict, reason, logs[], events[], askSpec? }`。
- bash resolver 作為輸入（函式），非模組全域依賴。
- 語意 bit-for-bit，僅觀測缺口（`permissionDenied` 事件漏發）主動補齊。
- 測試新增 smoke 套件，兩級鎖定：決策欄位精確比對、日誌字串僅鎖關鍵字。
- CONTEXT.md 已新增「Approval Decision」詞條（本輪 session 完成，非本 ticket 待辦，但尚未 commit）。
- 不開 ADR：可逆內部重構，三條門檻皆不滿足。

## Answer

Implemented 2026-07-20:

- `app/src/agent/tools/approvalDecision.ts` — pure `decide()` + `decideApprovalNeed` / `effectiveApprovalMode`
- `app/src/agent/tools/toolGuardShared.ts` — leaf helpers (side-effect set, SubDesign bash gate)
- `app/src/agent/tools/toolGuard.ts` — adapter only: resolve dynamic inputs → `decide()` → emit events → HITL
- `app/scripts/smoke-approval-decision.mts` — 17 true-import tests; mirrors removed from smoke-caps
