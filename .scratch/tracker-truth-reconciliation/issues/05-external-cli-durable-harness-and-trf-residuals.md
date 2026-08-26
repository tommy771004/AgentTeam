# 05 — external-cli-durable-harness 對帳 + turn-record-fidelity `[~]` 殘留核對

**What to build:** 核對 external-cli-durable-harness 七張票確實全未動（排工估算可信）；核對 trf 三處刻意 `[~]`（#04 toolAudit 非投影、#10 視窗虛擬化→trajectory-review-closure、#11 seam-1 真 CLI 斷言→durable-harness effort）仍被標記且 INDEX known residuals 可見。

**Blocked by:** 01

Status: resolved

## Comments

**2026-08-26 — resolved（核對完成）。**

- external-cli-durable-harness：七張票共 66 個驗收框全開、零勾——確實未動，排工估算可信。`smoke-external-cli-durable-harness.mts` 是主鏈第一支腳本（seam 現狀守衛）。
- trf 三處 `[~]` 核對仍被如實標記：
  - #04 `toolAudit` 非投影（設計決策，理由在票內：涵蓋回合外工具呼叫，純推導會遺失）。
  - #10 視窗虛擬化：純函式窗口＋掛載已由 trajectory-review-closure 01/02 落地（`smoke-trajectory-window.mts`、`smoke-trajectory-panel-mounted.mts` 皆在主鏈）；量測證據歸其 #03。
  - #11 seam-1 真 CLI 斷言：形狀斷言在 `smoke-external-cli-record.mts`（主鏈）；端到端歸 durable-harness effort。
- 三者已彙整進 INDEX「Known residuals」節，可見性成立。
