# 04 — Storybook component context provider

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓 SubDesign 在 brief、direction 和 generation 階段取得專案真實的 Storybook components、stories、controls 與 docs，正規化為產品擁有的唯讀 context evidence，並在 Storybook 不可用時安全降級。

## Acceptance criteria

- [x] 使用者可為 project 啟用或停用 pinned Storybook provider，不依賴 production `latest`。
- [x] Provider 只能讀取 component metadata、stories、controls 與 docs，不取得寫檔或任意 browser authority。
- [x] Upstream response 被轉為內部 context evidence；未穩定的 Storybook response types 不會成為產品公開型別。
- [x] Context evidence 記錄 provider、resolved version、取得時間與來源，但不包含 raw credentials。
- [x] Prompt composition 使用明確 token/byte budget，超量內容經摘要或 locator 處理，不直接灌入整份 Storybook catalog。
- [x] 相同 project snapshot 可使用 bounded cache；source fingerprint 改變時 cache 失效。
- [x] Timeout、Storybook 未啟動、無 stories 或 schema 新增未知欄位時，Task run 仍可使用 local artifacts 繼續。
- [x] UI 顯示是否使用 Storybook context、取得多少 components，以及 unavailable/fallback 原因。
- [x] Fake-server smoke 覆蓋 success、budget、cache、timeout、unavailable fallback 與 unknown extra fields。
- [x] Feature flag 關閉時不啟動 server、不註冊額外 authority，也不改變既有 SubDesign 行為。

## Blocked by

- 03 — 第一條 contract-driven pipeline Task run
