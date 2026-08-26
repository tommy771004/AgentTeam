# 06 — 追蹤器／文件本身對帳（INDEX 死連結 + DEV_STATE）

**What to build:** 自 git 歷史查明兩個死目錄去向，以文字下場註記取代死連結（不留死連結也不丟歷史）；subagents-paid-beta #14 殘餘遷入 Remaining blocked 文字區；DEV_STATE.md 重寫至對帳日。

**Blocked by:** 01

Status: resolved

## 已查明事實

- `.scratch/loop-runner-deepening/` 由 remove-legacy-engine 收口（PR #8–#13 合併，engine.ts 與 agent/loop/ 已刪，drift guard 接管）。
- `.scratch/subagents-paid-beta/` 目錄已不存在（git 759d691, 2026-07-22 清理）；#14 release qualification 殘餘仍 blocked-pending-real-signed-platform-evidence。
- DEV_STATE.md 停在 2026-08-15；之後已落地：reattachment 決策與 protocol v3 attachment persistence、remove-legacy-engine、trajectory window、subscription surface 等。

## Comments

**2026-08-26 — resolved。**

- 死連結查明：guard 首跑抓出 4 條——`subagents-paid-beta/{spec.md,issues/14-…}`、`loop-runner-deepening/{spec.md,issues/05-…}`。兩目錄最後蹤跡見 git 759d691（2026-07-22 清理提交）。
- 下場考據：loop-runner-deepening 由 remove-legacy-engine（PR #8–#13，merge commits 6ccd23d／3b378af／b73dc41→2044d11）收口——engine.ts 1702 行遺產與 agent/loop/ 全數刪除，Pi Host 為唯一 owner；舊票 #05 manual parity 失去主體。subagents-paid-beta 目錄移除，但 #14 release qualification 殘餘仍在（工具 `smoke-release-qualification.mts` / `qualify-release.mts` 皆 gate 上）→ 遷記 Remaining blocked。
- INDEX 改寫完成：Active frontier 只留真開工作；resolved 移入下表並附一 hop 證據欄；新增 Known residuals 與待維護者裁決 queue。
- DEV_STATE.md 重寫至 2026-08-26（另檔）。
- **重要附記**：工作區有一批未提交的 subscription WIP（`SubscriptionConnectionStatus.tsx` 改讀 `useSubscriptionCatalog` hook 等 20+ 檔），使工作樹上的 `npm run smoke` 在 `smoke-subscription-labeling.mts` 中段紅燈——屬 subscription-surface-hardening 進行中工作，非已提交狀態；本 effort 不代修（spec 明文不動產品碼），已於 DEV_STATE 如實記錄。
