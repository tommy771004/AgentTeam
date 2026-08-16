# 06 — HTML 同源包裹序列化

**What to build:** 與 Markdown 同一文件模型的第二個序列化端：自包含離線 HTML（樣式內嵌、可直接以瀏覽器開啟、無外部資源依賴），供貼 wiki 與直接分享。golden html fixtures 進 smoke，與 MD 端內容一致（同源不同殼）。

**Blocked by:** 05

**Status:** resolved

- [x] HTML 包裹：內嵌樣式、自包含、離線可讀
- [x] 與 MD 序列化同一文件模型（內容一致，僅殼不同）
- [x] smoke：golden html fixture＋與 MD 端的關鍵內容一致性檢查

## Answer

`renderRunReportHtml(model)`：與 MD 同一 RunReportModel 的第二序列化端——MD 內容經 HTML 轉義後包進自包含文件（`<style>` 內嵌、無外部資源、深色版面）。smoke 第 6 組：自包含檢查（無 src/href/@import/url）、與 MD 端關鍵內容同源（已驗證完成/DoD 文本/runId）、注入防護（objective 內 `<script>` 被轉義）。
