# 14 — 發布 Workspace 政策並驗證中央證據

**What to build:** 讓 Policy Admin 將已驗證 draft 發布為 Workspace 的原子 Policy Bundle，追蹤 what changed 與 rollout identity，並能按 workspace/device/week 驗證中央 Security Evidence chain、retention checkpoint 與 device replacement 關係，而不顯示任何 prompt 或 Protected Data。

**Blocked by:** 10 — 同步 Workspace 原子 Policy Bundle；12 — 背景增量上傳證據與管理裝置生命週期；13 — 建置 Policy Admin 與本機政策生命週期

**Status:** resolved

- [x] 只有通過 local schema、identity、monotonic 與 synthetic fixture validation 的 draft 可進入 publish 動作。
- [x] publish 原子寫入 matching Company Base Policy 與 Provider Supplemental Policy，產生新 bundle version、change ID 與 ETag。
- [x] partial publish 或 server validation failure 不會讓 client 看到混合版本，現有 last-known-good 保持有效。
- [x] publish/rollback summary 顯示 rule ID、field name、reason、previous/new version 與 provider scope，不顯示 policy sensitive value。
- [x] Policy Admin 可依 workspace、Managed Device ID 與 ISO week 選取 evidence chain 進行 verify。
- [x] verifier 能顯示 valid、unsealed、tampered、missing sequence、retention checkpoint、retired device 與 unrecoverable gap 狀態。
- [x] verification UI 只顯示 metadata、filename/locator 與 integrity result，不顯示 prompt、file content、model output 或 protected plaintext。
- [x] device replacement 可顯示 old/new opaque IDs、retirement/revocation 與 gap relationship，不能匯出舊 device key。
- [x] Workspace publish、sync 與 evidence verification 自身也產生安全 evidence event。
- [x] fake Workspace end-to-end scenario 驗證 publish → client sync → protected outbound → upload → central verify 的完整路徑。


## Answer

- `workspacePublish.ts`: explicit publish after activate; evidence verify reuses ledger verifier; draft review field names only.
- smoke-outbound-phase2.

