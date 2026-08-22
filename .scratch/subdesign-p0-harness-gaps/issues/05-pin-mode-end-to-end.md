# 05 — Pin 模式端到端：點元素 → scoped patch → 單次 runTask

**What to build:** ArtifactPreview 新增 pin 模式：使用者在 sandboxed 預覽上點擊任何元素、留一句話。元素解析由 host 注入的唯讀 script 完成（iframe 內容零信任），payload 經 schema validation（element selector、region 座標、user text、artifact revision），提交時編譯成結構化 followUp 輸入進 workspace controller——與其他 follow-up 完全同軌，單次 `runTask` 迭代內 agent 只修正該 region（patch 操作復用既有 artifact patch operation 形狀，以 pin 區域預先計算 scope）。使用者得到的改變：回饋從「用文字描述位置」變成「指著說改哪裡」，且其他頁面不會被順手改動。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Pin 模式可選取預覽元素並附留言；解析由 host 注入唯讀 script 完成
- [ ] Payload 經 schema validation；畸形 payload 被拒絕且不觸發 run
- [ ] 結構化 followUp 走 workspace controller 既有路徑，恰好一次 `runTask`；prompt context 含 pin 結構
- [ ] Patch 以 pin 區域為 scope，不產生全域字串替換
- [ ] Controller-level smoke（fake deps）：結構化輸入、單次 run、live 中拒絕
- [ ] 元件層 fixture：pin UI 狀態流（idle → pinning → submitted）

## Comments

**2026-08-22 實作記錄（部分偏離）**：「Patch 以 pin 區域為 scope」目前由 prompt contract 承擔——`buildPinnedCommentContext` 產生結構化 context（selector + 使用者文字 + 只准改該元素的指令），agent 在單次 runTask 內執行；尚未編譯成 host-side 的 `SubDesignArtifactPatchOperation` 精確替換（需要 host 對 artifact 內容做 selector→字串定位）。schema validation、isTrusted 信任錨與單次 runTask 已落地。剩餘工作：host-side scoped patch 編譯。
