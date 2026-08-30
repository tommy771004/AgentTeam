# 13 — External CLI collaboration capability honesty

**What to build:** 外部 CLI subprocess 只對 UI 與 parent 宣告真實支援的 collaboration 能力。沒有 durable session/mailbox adapter 時，follow-up 是獨立 execution 或 unsupported，completion 是 runner settlement，不假裝具有 live peer messaging、wait wake-up、DoD 或 Checker guarantee。

**Blocked by:** 04 — Follow-up task 與 profile continuity; 06 — One-hop child completion delivery.

**Status:** resolved（2026-08-30；見 `../qualification.md`）

- [x] Runner contract 分別表達 session reuse、mailbox、follow-up、interrupt、completion、DoD 與 Checker support
- [x] CLI help/version probe 不會把模型推測或 process stdin 誤判成 durable agent messaging
- [x] Unsupported send/wait/follow-up 回傳明確 degraded reason，不建立假 Turn Record success
- [x] 支援 reconnect 的 provider 維持 conversation identity，其他 provider 每次建立可稽核的新 execution
- [x] Process timeout、exit、signal、auth failure 與 cancellation 投影成真實 terminal state
- [x] UI 明確區分「子程序」和「子智慧體」以及 unavailable capabilities
- [x] 真實可用 CLI qualification 覆蓋 record、restart、recovery；不可用 provider 保留 honest blocked evidence
- [x] External CLI success 永遠不自動等於 Definition of Done 或 verified adoption
