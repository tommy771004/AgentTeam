# 03 — pi-host-tool-and-skill-parity 對帳

**What to build:** 核對 19 張票勾選框與 gate 證據；spec 問題陳述（「Host 只有 6 個 builtin tool」等）為動工前歷史，補帶日期對帳註記；INDEX frontier 翻正。

**Blocked by:** 01

Status: resolved

## 已知現實（待本票核對後確認）

- 19/19 驗收框全滿；僅 #18 一個刻意 `[~]`（`hermes/skills.ts` READ-ONLY 回滾版本，Guard 3 凍結，追蹤於 rc#17）。
- `electron/piExtensionPacks/` 十個 pack、`piTurnContext` 技能注入已移除。
- gate 證據：`npm run smoke:pi-parity-qualification` 在主 smoke 鏈上。

## Comments

**2026-08-26 — resolved（effort 翻 resolved，唯一 [~] 入 known residuals）。**

- 勾選框現實：19/19 全滿；僅 #18 一個刻意 `[~]`（`hermes/skills.ts` READ-ONLY 回滾版本，Guard 3 凍結 4 個消費者，收口追蹤於 rc#17）。
- Gate 證據：`smoke:pi-parity-qualification` 在主 smoke 鏈（含 build:pi-host）；pack 工具載入（a604d51）、parity proven＋renderer equivalents removed（a6d7754）、skill branch removed＋registrations frozen（b0f615a）、票框補勾含實作證據註記（6d6ec84）。
- Spec 對帳註記已加：問題陳述「Host 只有 6 個 builtin tool／技能在 localStorage」為動工前歷史，現況以註記與 gate 為準。
- INDEX frontier 列由「19 張可交給代理」改為 resolved＋residual 指引。
