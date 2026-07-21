# 07 — 提供 PDF／Office Sanitized Sidecar

**What to build:** 讓 PDF、DOCX、XLSX 與 PPTX 在本機經過 structure-aware extraction 與既有保護規則後，生成 provider-specific Markdown/JSON Sanitized Sidecar。AI 只讀 sidecar，不取得或覆寫原始 binary；圖片與未知格式維持 deny-by-default。

**Blocked by:** 05 — 建立 Sanitized Workspace 與安全回寫

**Status:** resolved

- [x] PDF extraction 保留 page/block locator，Office extraction 使用適合格式的 paragraph、slide、sheet/cell locator。
- [x] extracted text 經過同一 baseline 與 Company/Provider policy，Protected Data 以安全 marker 呈現。
- [x] AI transport、builtin tools 與 external CLI 都只看到 sidecar，不包含原始 PDF/Office binary。
- [x] sidecar 被視為衍生 artifact，不能 write back 或取代原始文件。
- [x] 圖片預設 whole-file exclusion，未經明確 vision policy 時不提供 decoded pixels 或 OCR 結果給 AI。
- [x] ZIP、SQLite、未知與 parser 不可信格式顯示 unavailable，其他安全檔案仍可繼續任務。
- [x] parser failure 不會 fallback 成直接上傳 original binary。
- [x] evidence 只記原始 filename 與 page/block、sheet/cell 等 locator，不記 extracted text。
- [x] fixtures 證明 synthetic secret 在 PDF/Office sidecar 被排除，普通結構仍可供 fake LLM/CLI 使用。
- [x] 原始 non-text 文件在第一版保持 immutable。


## Answer

- `sanitizedSidecar.ts`: classify pdf/office/image/zip; `buildSanitizedSidecar` extracts marker structure, sanitizes with profile, never returns binary; images deny-by-default; writeback always false.
- Opaque binary → unavailable (no original fallback).
- smoke-sanitized-sidecar in smoke/smoke:ci.
- Full PDF/Office binary parsers deferred; synthetic/extractable fixtures cover the contract.

