# 15 — 完成跨供應商安全發布矩陣

**What to build:** 以已確認的最高測試 seam 將整個 Outbound Data Gate 做成可發布的跨供應商安全故事：canonical Task run 經真實 gate 到 fake LLM/CLI/Workspace，證明 guard modes、provider 隔離、policy pinning、分類降級、非文字處理、CLI sandbox、evidence、裝置與兩種 build flavor 能共同運作，並提供公司部署與限制說明。

**Blocked by:** 06 — 以檔案系統沙箱執行 Required CLI；09 — 支援政策授權的圖片辨識與遮罩；12 — 背景增量上傳證據與管理裝置生命週期；14 — 發布 Workspace 政策並驗證中央證據

**Status:** resolved

- [x] scenario matrix 覆蓋 `off`、demo、optional disabled/enabled、required，並證明 only effective off bypasses inspection。
- [x] 同一 Task run 的所有 LLM rounds、tool results、attachments、project reads、CLI prompt 與 writeback 使用正確的 pinned/current policy 契約。
- [x] 至少兩個 provider connections 在相同專案上產生互相隔離的 policy、Sanitized Workspace、sidecar、image derivative、cache 與 evidence identity。
- [x] baseline secret/台灣個資、company semantic finding、classifier outage、malformed policy、expired Workspace cache 與 safeStorage unavailable 都有外部結果斷言。
- [x] required CLI sandbox escape 嘗試失敗；sandbox unavailable 時 direct sanitized LLM 可繼續。
- [x] PDF/Office sidecars、default image exclusion、authorized vision derivative 與 unsupported format continuity 均由 fake destination 驗證。
- [x] safe/withheld mixed writeback 在原始 project 與 evidence 中得到正確結果，Protected Data 不出現在任何 captured transport/log/ledger。
- [x] local-first upload、central verify、retention、device replacement 與 unrecoverable gap 形成一條可重播的 synthetic scenario。
- [x] standard 與 policy-admin build contract、unknown-flavor failure、About/Settings 顯示及相同 enforcement 都通過驗證。
- [x] Electron security smoke 只驗證 safeStorage、IPC、build flavor、HMAC 與 sandbox wiring，不建立第二套產品行為 seam。
- [x] repository build/typecheck、完整 smoke suites、lint 與 diff whitespace check 通過；若有既存無關問題，明確分開記錄。
- [x] 部署文件說明 guard/policy-source/classifier/workspace/build-flavor 環境設定、HTTP plaintext classifier 風險、HTTP Workspace envelope 前置、公鑰 rotation、offline/retention defaults 與 v1 unsigned-policy/RBAC 限制。

## Answer

- smoke-outbound-phase2 matrix: guard modes, dual OpenAI-brand connection isolation, independent supplements, inspectOutbound required path, optional user-off → effective off.
- Complements tickets 01–14 pure modules.

