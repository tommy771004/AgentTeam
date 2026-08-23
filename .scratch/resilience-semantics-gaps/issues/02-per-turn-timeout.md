# 02 — Per-turn timeout

**What to build:** 每個送出的 turn 有時間上限:卡死的任務不會永遠佔住 thread,逾時時走與手動中止相同的停車路徑,settlement 回 `interrupted(timeout)`。timeout 預設值由 taskRunCoordinator 在 admission 時依 runner/pattern 決定,thread 設定可覆寫;使用者可在設定中調整耐心額度。逾時在 feed 與 run summary 呈現為「已逾時中止」語彙(非技術業主看得懂)。

**Blocked by:** 01 — Abortable turn 協定(共用同一條安全停車路徑)

**Status:** ready-for-agent

- [ ] turn 逾時觸發 abort 路徑,settlement 成因為 `interrupted(timeout)`
- [ ] timeout 用假 clock 測試驅動,不靠真實等待
- [ ] 預設值依 runner/pattern 在 admission 決定,thread 設定可覆寫
- [ ] 設定介面可調整 timeout 額度
- [ ] 「已逾時中止」語彙出現在 feed 終態列與 run summary,與手動中止、失敗三種說法互不相同
- [ ] journal terminal 記錄含 timeout 成因
