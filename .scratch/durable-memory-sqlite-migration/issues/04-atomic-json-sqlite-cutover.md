# 04 — JSON → SQLite 原子遷移與 authority cutover

Status: 待補資訊
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

在 Host startup 將舊 JSON memories 原子遷移至 SQLite，並把 production Memory Extension 切換為 DurableMemoryStore 唯一 authority。遷移必須可重啟、可診斷且不 dual-write：成功前舊 JSON 仍是來源，成功後只認 SQLite，backup 只是 recovery evidence。

## Acceptance criteria

- [ ] startup 先驗證舊 snapshot、建立可識別 backup，再於單一 SQLite transaction 匯入有效 entries 與 migration marker
- [ ] v1/v2、空資料、duplicate id、跨 project 同 key、profile/document、invalid date/tag/oversized row fixtures 都有確定結果
- [ ] invalid rows 被 quarantine/report，不讓整批靜默消失，也不把 wholly corrupt JSON 當空資料覆寫
- [ ] crash-before-commit 會從 JSON 安全重試；crash-after-commit-before-state-advance 由 marker 識別且不重複匯入
- [ ] migration commit 後 Host state schema 宣告 SQLite authority，production list/recall/mutation 只讀寫 DurableMemoryStore
- [ ] JSON memories 不再被 live update，且沒有任何 dual-write window
- [ ] 不相容舊版本 downgrade fail closed 並提供 actionable message，不得恢復 JSON write
- [ ] 真 Host migration/restart smoke 證明 cutover 前後資料、scope、revision 與 special entries 一致

## Blocked by

03 — Authority boundary 的 scope、policy 與 idempotency

## Progress — 2026-08-27（尚未 cutover）

- 已實作 `DurableMemoryStore.migrateLegacy`／`migrationStatus`，in-memory 與 SQLite 共用 legacy row staging、scope/key normalization、validation、quota 與 credential rejection。SQLite 將有效 rows、revision 與 source-hash migration marker 放在同一 transaction。
- 同 scope/key 的有效重複資料採最後一筆；不同 project 同 key 共存；既有 SQLite entry 不覆寫，列入 `existing_entry` 報告。invalid／credential／quota rows 以 source index + typed reason 回報，不在 marker 複製正文。profile/document 保留 global special kind 與 always-recall。
- 相同 source hash 重試回傳已完成報告、不重複寫入；來源 hash 改變拒絕。空來源也保存 marker。Host 接入時必須先保存原始 JSON backup，再從原始 rows 呼叫遷移，不能使用經 `isPiMemory` 過濾的 projection 當來源。
- 已修正目前 Host startup 的危險 fallback：只有 ENOENT 代表新安裝；損壞 JSON、未知 schema 或讀取失敗會拒絕啟動，不再回空 state 後覆寫原檔。
- `smoke-durable-memory-migration.mts` 覆蓋共用 adapter fixtures、重啟 retry、existing-entry/配額、敏感資料與 marker 寫入失敗整筆回滾。`smoke-pi-host-memory-migration.mts` 用真 Host 驗證損壞／未知 schema 不宣告 ready、不覆寫來源。兩支已掛 `smoke:pi-parity-qualification`，因此也在主 smoke chain。
- 驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、Node typecheck、相關 oxlint 與 complexity gate 通過。本次未重跑完整 `npm run smoke`；未勾選本票全 workflow AC。

## 待確認：既有舊版的 downgrade barrier

既有舊版（`cf76e89` 及之前）的 `piHostState.ts` 對未知 schema 會回 empty state，且 `piHostEntry.ts` 隨即 save。只新增 schema、JSON marker 或 sidecar 檔案，無法讓不讀這些標記的舊 binary 停止寫入。上面的 startup 修正只保護此版本及以後，不能反向修補既有 binary。

要滿足本票的「舊版不得恢復 JSON write」，需要允許調整 Host state 檔案佈局，讓舊路徑無法被舊版正常覆寫，並為新位置加上可重啟的轉換／備份流程。這份 snapshot 也包含 sessions/settings/queue；它們仍應保持 JSON 與原 ownership、不遷入 SQLite，但檔案位置／形態會受影響。此範圍需使用者確認後才接正式 startup cutover。

剩餘工作：backup/quarantine 落盤 → 可重啟的 state 佈局／authority advance → 全部 live read/write adapter 切換 → 真 Host crash-before/after-commit 與舊版拒絕啟動證據。目前 production supervisor 與 legacy Memory Pack 仍沿用既有 JSON authority，沒有雙寫。
