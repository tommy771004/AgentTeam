# 01 — Host-owned 全域自訂指令 vertical slice

**What to build:** 讓使用者能在「個人化」編輯一份 Host-owned 全域自訂指令，儲存後重新啟動仍能讀回；這份資料由獨立 Instruction Repository 管理，不進入 DurableMemoryStore，也不再以 renderer localStorage 作為 canonical state。此票同時留下 hybrid instruction authority 的架構決議，先建立後續切片可依賴的單一 contract。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [x] 新增或修訂 ADR，明確定義 DB-owned global instructions、filesystem-owned project instructions、Pi resource discovery ownership 與 Task run snapshot 邊界。
- [x] 「個人化」可讀取、編輯、儲存全域自訂指令，成功提示只在 Host transaction commit 後出現。
- [x] Production 使用獨立 Host-owned SQLite repository；instruction schema、database lifecycle 與 protocol 不進入 DurableMemoryStore authority。
- [x] 同一 public async contract 有 deterministic in-memory adapter，正常行為不需檢查私有 SQL table。
- [x] Host restart 後可讀回最後 committed revision；未完成或失敗的寫入不成為 live value。
- [x] Renderer 從 versioned Host snapshot 建立 UI Projection，localStorage 不可回寫覆蓋較新 Host state。
- [x] Read-only、busy、I/O 與 unsupported schema failure 回傳 typed failure，且不發布成功 revision。
- [x] Focused smoke 經 public Host contract 驗證 save、read、restart、failure 與 durable-memory boundary，並掛入正式 smoke chain。
