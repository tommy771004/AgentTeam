# 01 — 單一 goal 的 Host-owned Working State vertical slice

**What to build:** 讓一個 builtin Task run 從 admission 開始便擁有 Host-owned、revisioned Working State。使用者能經既有 Host protocol 與 Turn Record 看到 objective、constraints 與一個 pending goal，而 renderer、transcript 和 compatibility loop 都不是可回寫 authority。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Claim 前先檢查 dirty worktree；若 durable-memory migration session 仍在修改本票需要碰觸的共享 Host protocol surface，停止並協調，不覆寫、重排或合併其未完成變更。
- [x] Builtin Task run 經 canonical coordinator admission 後建立 schema-valid Working State revision 1，包含穩定 run identity、objective、constraints 與至少一個 stable goal identity。
- [x] Working State 的 authoritative snapshot 由 Pi Core Host 提供；renderer 或 plain-browser fallback 無法提交 canonical state。
- [x] Turn Record v3 記錄第一個 Host-accountable Working State entry，且 live page 與 replay page 產生相同狀態。
- [x] v1 與 v2 Turn Record fixtures 仍可讀並明確投影為 legacy/no-verified-state；未知 future version 仍 fail closed。
- [x] 真實 Host protocol smoke 證明 run admission、state snapshot、record paging 與 settlement 走 shipped modules，並已加入實際 smoke gate。
