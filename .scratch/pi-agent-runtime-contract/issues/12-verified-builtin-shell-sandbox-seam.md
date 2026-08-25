# 12 — Verified builtin-shell sandbox seam 與新 ADR

**What to build:** 專案取得一個可審查的新 ADR 與 main-side verified sandbox seam，定義 backend probe、canary、profile、Restricted Project View、network posture、metadata-only evidence 與 unsupported-platform refusal。任何 renderer 或模型資料都不能把沒有驗證的 builtin shell 變成可執行。

**Blocked by:** 11 — ADR-0047 真實 Pi turn denial qualification.

**Status:** 可交給代理

- [x] 新 ADR 明確描述與 ADR-0022、ADR-0047、ADR-0048 的關係，且在啟用任何 backend 前被接受。
- [x] Sandbox seam 能表示 supported/verified、unsupported、probe-failed 與 canary-failed，而不是一個可由 caller 填寫的 boolean。
- [x] Verification 只由 trusted main-side adapter 產生，renderer、model text 與 tool arguments 無法簽發 evidence。
- [x] Evidence 為 metadata-only，綁定 run、backend、profile digest、view root 與必要 expiry/replay facts。
- [x] Canary 同時證明 view 內預期存取可行、view 外存取被拒絕；backend binary 存在本身不算 verification。
- [x] Evidence 缺少、格式錯誤、過期、run/view 不符或 canary 失敗時，builtin shell 在 `required` 下拒絕。
- [x] Unsupported platform 明確回不可用理由，不降級成 optional execution。
- [x] 一個 no-backend production path qualification 證明新 seam 在尚無平台 adapter 時不改變 ADR-0047 fail-closed 行為。

## Comments

- Accepted ADR-0051 定義 Host-owned verified sandbox seam，並明確銜接 ADR-0022、ADR-0047、ADR-0048；平台 adapter 尚未啟用。
- Deep module 以 `supported+verified`、`unsupported`、`probe-failed`、`canary-failed` 表達結果；雙 canary 必須同時證明 view 內 allow 與 view 外 deny。
- Evidence 只含 run/backend/profile digest/view root/expiry/replay metadata，並以 Host-private issuance identity 驗證；renderer/model/tool args 的同形 plain object 無法偽造。
- Legacy caller `shellIsolationVerified` 路徑已移除；Host admission 自行驗證，required 遇缺失、格式/期限/run-view mismatch、unsupported 或 canary failure 均拒絕且不降 optional。
- 主代理獨立重跑 `npm run smoke:pi-builtin-shell-sandbox`、`npm run smoke:pi-adr0047-real-turn`、`git diff --check`，全部通過；實作代理亦通過完整 build。
