# 05 — 建立 Sanitized Workspace 與安全回寫

**What to build:** 為每個受保護的 provider connection 建立暫時 Sanitized Workspace，讓 builtin agent 的檔案工具與專案讀取只能看到 Restricted Project View。代理在淨化視圖中修改後，只把不重疊 Protected Exclusion 的安全差異寫回原始專案。

**Blocked by:** 03 — 在 LLM 出站執行文字基礎淨化

**Status:** resolved

- [x] 每個 provider connection 使用獨立 Sanitized Workspace、mapping、cache 與 exclusion state。
- [x] 原始專案不因視圖建立而修改；sanitized text 保留可用的相對路徑與 line mapping。
- [x] builtin file-reading tools、capability tools 與新加入的 AI-readable project operations 在保護啟用時只能解析受控視圖。
- [x] project 外部 symlink target 不被複製或暴露，無法安全解析的 path 會被明確略過。
- [x] agent edits 先落在 Sanitized Workspace，再以 mapping 產生可審查的 writeback diff。
- [x] 未重疊 Protected Exclusion 的 hunks 可套用回原始文字檔；重疊 hunks 被 withheld，其他 hunks 仍繼續。
- [x] withheld evidence 只記 source name 與 line range，不包含原文、replacement 或 digest。
- [x] provider run 完成、取消或失敗後，temporary view 依 lifecycle 安全清理且不影響原始 project。
- [x] scenario 同時修改安全與受保護區段，證明原始 project 只收到安全 hunk。
- [x] browser fallback 在無 Electron bridge 時不假裝具備公司檔案隔離；能力狀態須清楚可見。


## Answer

- `sanitizedWorkspace.ts`: create/dispose per-connection views; text sanitize copy; skip external symlinks & non-text; safe writeback (protected lines keep original; withheld metadata only locators).
- `runContext.resolveEffectiveProjectRoot(root, runId)` prefers bound Restricted Project View.
- registered tools pass `context?.runId`.
- browser capability `unavailable` (no fake isolation).
- smoke-sanitized-workspace (5) in smoke/smoke:ci.

