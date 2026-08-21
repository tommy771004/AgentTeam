# 06 — Harness goal-based UX testing

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓使用者在 Critique 階段指定 goal 與 persona，透過 optional Harness provider 執行 user simulation，取得 success/failure/blocked、replay steps、screenshots 與 friction events，並能可靠停止 session。

## Acceptance criteria

- [x] Critique 提供 goal/persona UX check 選項，同時保留既有靜態與 browser evidence 路徑。
- [x] Harness 以 optional provider/tool 接入，不成為 Task run 或 Pi Core tool loop 的 owner。
- [x] Session 開始前顯示平台、Screen Recording、Accessibility 或其他必要權限與 unavailable 原因。
- [x] Goal outcome 正規化為 success、failure 或 blocked，並與 tool success、Task run settlement、Goal-based DoD 分開。
- [x] Ordered steps、friction events 與 screenshots 綁定 run/stage/artifact，並以 project-relative evidence/attachment 保存。
- [x] 對話顯示目前步驟、最新觀察與 friction 摘要，navigation 後可恢復而不重開 session。
- [x] Stop 會 targeted cancel Harness session，並阻止 late steps 或 completion 覆寫 cancelled settlement。
- [x] Unsupported platform、missing permission、provider timeout 與 application launch failure 可安全降級，不會阻止其他 Critique providers。
- [x] Fake-session smoke 覆蓋 successful goal、failed goal、blocked permission、friction capture、timeout、cancel 與 late event。
- [x] Provider 不把 API keys、OS permission data 或 screenshot 原始敏感內容寫入 activity metadata。

## Blocked by

- 03 — 第一條 contract-driven pipeline Task run
