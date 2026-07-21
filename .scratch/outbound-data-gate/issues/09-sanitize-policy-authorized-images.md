# 09 — 支援政策授權的圖片辨識與遮罩

**What to build:** 只有 Company Base Policy 明確授權特定 Company Classification Endpoint 的 vision 能力時，才允許該公司端點檢視圖片並回傳 Protected Data bounding boxes。圖片由 deterministic local sanitizer 遮罩，外部 AI 只收到驗證過的 sanitized derivative。

**Blocked by:** 07 — 提供 PDF／Office Sanitized Sidecar；08 — 接入公司 `/v1` 分類端點

**Status:** resolved

- [x] 預設 policy、Provider Supplemental Policy 或使用者設定都不能自行啟用 vision；授權必須來自 Company Base Policy。
- [x] 未授權、classifier unavailable、response invalid 或 sanitizer failure 時，整張圖片保持 unavailable，其他內容繼續。
- [x] vision request 使用既有 pinned endpoint、auth、transport、device/source identity 與 retry 契約。
- [x] response 只接受邊界內、格式正確的 bounding boxes 與 additive classification；異常座標不被寬鬆修正成允許送出。
- [x] local sanitizer 對受保護區域套用不可逆遮罩，並在輸出前驗證尺寸、格式與 policy version。
- [x] original image、unmasked pixels 與 classifier finding text 不進入外部 LLM/CLI workspace。
- [x] 每個 provider connection 的 derivative 與 cache 隔離，不跨 provider 重用。
- [x] evidence 只記 filename、image locator/bounding-box range、policy/classifier status，不保存圖片或像素 digest。
- [x] PDF/Office embedded images 遵守同一 deny-by-default 與 authorized derivative 規則。
- [x] fake vision scenario 證明未授權時零圖片讀取，授權後 fake AI 只收到 masked derivative。


## Answer

- `imageSanitize.ts`: Company Base-only `visionAuthorization`; strict bbox validation; RGBA mask derivative; unauthorized/classifier fail → whole image unavailable.
- Supplement cannot enable vision. Evidence: boxes + dimensions only (no digests).
- Covered by smoke-outbound-phase2.

