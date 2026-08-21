# 03 — 第一條 contract-driven pipeline Task run

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓一個已解析、已授權的 v1 plugin 透過 SubDesign 發起完整 Task run，使用 deterministic fake provider 執行一個 pipeline stage，並產生活動訊息、可信 evidence、artifact 與準確 settlement。這張票建立後續真實 providers 共用的最高層 seam。

## Acceptance criteria

- [ ] SubDesign 發起的 plugin execution 一律通過 Task run coordinator admission、capacity、queue 與 unique finalization。
- [ ] Pi Core tool loop 擁有 stage tool execution、approval、cancel 與 settlement；renderer 不直接啟動 provider。
- [ ] Fake provider 實作統一的 availability、timeout、output budget、cancel、structured result 與 adapter-issued evidence contract。
- [ ] Pipeline stage 的 queued/running/completed/failed/blocked/cancelled 狀態會投影到對話 activity，切換功能再返回仍可恢復。
- [ ] 成功路徑產生 project-relative evidence locator 與 artifact manifest，並能從對話開啟。
- [ ] Provider success、stage success 與 Goal-based DoD 是不同狀態；fake provider exit success 不會自動標記 DoD met。
- [ ] Stop 依 run identity targeted cancel provider session，且 late event 不會改寫 cancelled settlement 或復活 archived run。
- [ ] Capability denial、provider timeout、malformed evidence、failure、blocked 與 cancelled 都有不同的 terminal summary。
- [ ] 不同 conversations 的 runs 可在容量內並行；同一 conversation 的 follow-ups 仍保持有序。
- [ ] 最高層 smoke 從 SubDesign action 驗證完整生命週期，不以 renderer local state 或 inline mirror 代替 shipped path。
- [ ] Model text、tool arguments 或 provider payload 不能製造 accepted Execution evidence；只有 trusted adapter 可簽發。

## Blocked by

- 02 — Plugin resolved snapshot 與 capability grants
