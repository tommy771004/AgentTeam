# 04 — harness-gap-closure 對帳

**What to build:** 核對 17 張票：10 張框全滿翻正、7 張如實列為未完成；#09 維持待分流並以顯式佇列呈現於 INDEX；#01 問題陳述早於 remove-legacy-engine 合併，補對帳註記。

**Blocked by:** 01

Status: resolved

## 已知現實（待本票核對後確認）

- 框全滿（10）：#02 #03 #04 #05 #08 #12 #13 #14 #16 #17。
- 未動（0 勾）：#01 #06 #07 #10 #11 #15。
- #09 待分流（builtin shell 是否納入 ADR-0022 sandbox 義務）——維護者裁決，本 effort 不代答。

## Comments

**2026-08-26 — resolved（核對完成；7 張未動如實呈列）。**

- 已完成 10 張（框全滿）且證據檔皆在 gate 聯集（smoke/build/dist* 展開）：#16 `smoke-compliance-report.mts`、#12 `smoke-ops-console.mts`、#15 相關 `smoke-outbound-run-view.mts`、#17 `smoke-paid-workflow.mts`、#14 `smoke-evidence-ledger.mts` 系、#05 `scripts/smoke.mjs` 本體改造等。（#02/#03/#08 的驗收落在既有投影與 CLI contract smokes 內。）
- 未動 7 張（0 勾）：#01 敘述統一、#06 workspace grep/glob、#07 spill 大工具輸出、#10 headless 入口、#11 evaluation harness、#15 outbound run view——注意 #15 雖有 gate 上的 view smokes，票本身驗收框全開，兩者不混淆；#09 待分流。
- #01 問題陳述寫於 remove-legacy-engine（PR #8–#13）合併前：「兩條 bash 路徑並存」「legacy loop 仍是架構」已是歷史；動工前需照現實重新框限（engine.ts／agent/loop 已刪）。已在 INDEX 列註記。
