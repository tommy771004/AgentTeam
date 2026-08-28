# 06 — Pin 提交摘要與稽核記錄

**What to build:** 兩個使用者可見的補完：提交 pin 前，顯示即將送出的結構化 patch 摘要（目標檔案、scope、操作數）供確認——使用者確認的是具體操作而非一句模糊指令；pin 留言本身保留為可稽核記錄（region + 文字 + 時間戳 + 觸發的 runId），之後能回答「這裡為什麼變了」。

**Blocked by:** 05 — Pin 模式端到端：點元素 → scoped patch → 單次 runTask

**Status:** resolved

- [x] 提交流程含確認步驟，摘要呈現 patch 目標與 scope
- [x] 每筆已提交 pin 記錄 region、文字、時間戳、runId，並可在 UI 回查
- [x] 記錄儲存於 project-relative workspace store，遵循既有上限模式
- [x] 元件層 fixture 驗證摘要確認與記錄回查兩種狀態

## Comments

- 2026-08-28 implemented and reconciled: `ArtifactPreview` 提供留言、確認與 history；canonical records 寫入 `.subagents/subdesign/pinned-comments`；`smoke-subdesign-pinned-audit.mts` 與元件 pointer fixture 在主鏈通過。
