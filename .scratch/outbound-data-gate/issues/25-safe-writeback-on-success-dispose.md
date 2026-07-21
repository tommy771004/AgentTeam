# 25 — 成功 run dispose 時 Safe Writeback

**What to build:** 保護 run 成功結束時，dispose Restricted Project View 前對 mapped 文字檔做 ADR-0008 safe writeback：安全編輯回寫原專案，受保護行永不覆寫。

**Blocked by:** 18, 05

**Status:** resolved

- [x] create workspace 保留 `initialSanitizedText`
- [x] `writebackSanitizedWorkspace` + dispose `{ writeback }`
- [x] coordinator：`status === 'success'` 時 writeback
- [x] smoke：secret 保留 + agent safe edit 回寫

## Answer

- sanitizedWorkspace writeback helpers
- disposeOutboundRunView({ writeback })
- finalizeTaskRun dispose with writeback on success
