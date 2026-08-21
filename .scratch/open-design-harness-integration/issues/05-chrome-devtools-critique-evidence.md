# 05 — Chrome DevTools Critique evidence provider

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓 SubDesign Critique 可從受控 browser target 收集 console、network 與 performance findings，正規化為 run/stage/artifact-scoped Execution evidence，讓使用者能從對話查看摘要並開啟大型附件。

## Acceptance criteria

- [x] Critique 可選擇執行 browser runtime evidence collection，未啟用時維持既有靜態檢查。
- [x] Provider 由 Pi Core capability/tool boundary 啟動，renderer 不直接連線 DevTools 或選擇任意 remote target。
- [x] Browser target、provider package 與 protocol expectations 使用 reviewed pinned version/configuration。
- [x] Console errors、failed requests 與 performance findings 轉為穩定的內部 evidence vocabulary。
- [x] 每個 finding 帶有 run、stage、artifact、provider 與觀測時間；adapter-issued snapshot 才能標記為可信 evidence。
- [x] Large traces、screenshots 或 protocol captures 保存為 project-relative attachment locator，而不是塞入 conversation payload。
- [x] UI 顯示 findings 摘要、severity、來源與附件入口，切換功能後可由 Host projection 恢復。
- [x] Target unavailable、timeout 或 partial trace 產生明確 blocked/partial evidence，不會誤標 Critique 通過。
- [x] Deterministic fixtures 覆蓋 console、network、performance、timeout、partial result 與 malformed provider payload。
- [x] Evidence 和附件不包含 cookies、authorization headers、raw connector tokens 或未經 gate 的頁面敏感內容。

## Blocked by

- 03 — 第一條 contract-driven pipeline Task run
