# 04 — JSON → SQLite 原子遷移與 authority cutover

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

在 Host startup 將舊 JSON memories 原子遷移至 SQLite，並把 production Memory Extension 切換為 DurableMemoryStore 唯一 authority。遷移必須可重啟、可診斷且不 dual-write：成功前舊 JSON 仍是來源，成功後只認 SQLite，backup 只是 recovery evidence。

## Acceptance criteria

- [x] startup 先驗證舊 snapshot、建立可識別 backup，再於單一 SQLite transaction 匯入有效 entries 與 migration marker
- [x] v1/v2、空資料、duplicate id、跨 project 同 key、profile/document、invalid date/tag/oversized row fixtures 都有確定結果
- [x] invalid rows 被 quarantine/report，不讓整批靜默消失，也不把 wholly corrupt JSON 當空資料覆寫
- [x] crash-before-commit 會從 JSON 安全重試；crash-after-commit-before-state-advance 由 marker 識別且不重複匯入
- [x] migration commit 後 Host state schema 宣告 SQLite authority，production list/recall/mutation 只讀寫 DurableMemoryStore
- [x] JSON memories 不再被 live update，且沒有任何 dual-write window
- [x] 不相容舊版本 downgrade fail closed 並提供 actionable message，不得恢復 JSON write
- [x] 真 Host migration/restart smoke 證明 cutover 前後資料、scope、revision 與 special entries 一致

## Blocked by

03 — Authority boundary 的 scope、policy 與 idempotency

## Progress — 2026-08-27（尚未 cutover）

- 已實作 `DurableMemoryStore.migrateLegacy`／`migrationStatus`，in-memory 與 SQLite 共用 legacy row staging、scope/key normalization、validation、quota 與 credential rejection。SQLite 將有效 rows、revision 與 source-hash migration marker 放在同一 transaction。
- 同 scope/key 的有效重複資料採最後一筆；不同 project 同 key 共存；既有 SQLite entry 不覆寫，列入 `existing_entry` 報告。invalid／credential／quota rows 以 source index + typed reason 回報，不在 marker 複製正文。profile/document 保留 global special kind 與 always-recall。
- 相同 source hash 重試回傳已完成報告、不重複寫入；來源 hash 改變拒絕。空來源也保存 marker。Host 接入時必須先保存原始 JSON backup，再從原始 rows 呼叫遷移，不能使用經 `isPiMemory` 過濾的 projection 當來源。
- 已修正目前 Host startup 的危險 fallback：只有 ENOENT 代表新安裝；損壞 JSON、未知 schema 或讀取失敗會拒絕啟動，不再回空 state 後覆寫原檔。
- `smoke-durable-memory-migration.mts` 覆蓋共用 adapter fixtures、重啟 retry、existing-entry/配額、敏感資料與 marker 寫入失敗整筆回滾。`smoke-pi-host-memory-migration.mts` 用真 Host 驗證損壞／未知 schema 不宣告 ready、不覆寫來源。兩支已掛 `smoke:pi-parity-qualification`，因此也在主 smoke chain。
- 驗證：`npm run build`、`npm run smoke:pi-parity-qualification`、Node typecheck、相關 oxlint 與 complexity gate 通過。本次未重跑完整 `npm run smoke`；未勾選本票全 workflow AC。

## 歷史阻塞（已於 2026-08-27 核准）：既有舊版的 downgrade barrier

既有舊版（`cf76e89` 及之前）的 `piHostState.ts` 對未知 schema 會回 empty state，且 `piHostEntry.ts` 隨即 save。只新增 schema、JSON marker 或 sidecar 檔案，無法讓不讀這些標記的舊 binary 停止寫入。上面的 startup 修正只保護此版本及以後，不能反向修補既有 binary。

要滿足本票的「舊版不得恢復 JSON write」，需要允許調整 Host state 檔案佈局，讓舊路徑無法被舊版正常覆寫，並為新位置加上可重啟的轉換／備份流程。這份 snapshot 也包含 sessions/settings/queue；它們仍保持 JSON 與原 ownership、不遷入 SQLite。使用者已核准讓舊 pathname 成為目錄 barrier、將 snapshot 移至其中；詳細恢復界線見 [`cutover-recovery.md`](../cutover-recovery.md)。

此段記錄的是核准前狀態；下節為正式 cutover 結果。

## Progress — 2026-08-27（已核准 state 佈局，驗證中）

- 使用者回覆「是」，同意變更 Host state 檔案佈局。舊 pathname 改成目錄 barrier，sessions/settings/queue 等仍在其中的 `snapshot.json`，並未遷入 SQLite。schema 3 宣告 SQLite authority、`memories: []`。
- `openPiHostStorage` 是 startup 唯一切換 owner：驗證 raw JSON → 私有原始備份 → SQLite entries + marker transaction → staged schema/report/README → retire legacy file → 安裝目錄。每個可觀察邊界可重啟；已 installed 的 state 缺少 DB 或 marker 不符會拒絕啟動，絕不回放 backup。
- legacy 管理 API／snapshot response 改從 store 產生一次性 projection；turn recall/write 與 Memory Pack 改接 store，不再更新 JSON array。Pack 的 scope/flags 取自 session/run binding，未綁定任務拒絕存取。完整 provenance、tool metadata、最終 learning settlement 與 UI paging 仍由 05–08 等後續票承接。
- 已通過 focused parity gate：含真 Host 四個中斷點重啟、clear 後 backup 不復活、DB 遺失拒絕、跨 scope 同 key 與 ambiguous legacy delete 拒絕、Memory Pack policy/commit/retry。兩軸 review、build、Pi Host gates 與第二次完整主 smoke 均全綠，AC 已依證據翻牌。

## Answer

Pi Host startup 現以 `openPiHostStorage` 完成 restart-safe cutover。原 pathname 安裝成目錄 barrier；其中 `snapshot.json` 只保存 sessions/settings/queue 等原 owner state 與 schema 3 SQLite marker，`memories` 固定空陣列。SQLite 是 production list/recall/mutation 唯一 authority；legacy API、turn 與 Memory Pack 都只能取得相容 projection 或 scoped service，沒有 JSON dual-write。

原始來源以 `0600` 保存為 `.pre-sqlite.json`，invalid rows 的 index/reason 落在 report。四個切換邊界分別強制退出後皆可重啟，marker 防止 commit 後重匯；已安裝 state 遇到 DB 遺失／marker 不符會拒絕，不會回放 backup。downgrade 證據是歷史 writer 行為查核 + 真 OS rename barrier + actionable README，未宣稱執行歷史 Electron binary；完整界線見 [`cutover-recovery.md`](../cutover-recovery.md)。

兩軸 review 的 backup 權限與 invalid-project active-run 問題均已先 RED 重現再修正；複查無阻擋項。驗證：相關 oxlint、Node typecheck、complexity gate、`npm run build`、`npm run smoke:pi-parity-qualification`、`npm run smoke:pi-host` 與完整 `npm run smoke` 全綠。首次完整 smoke 曾遇既有 UI fixture timeout，該 fixture 單獨重跑與第二次完整主鏈均通過。

## Comments

- #04 只完成 authority cutover 所需的最小 consumer adapter。Turn Record recall provenance（#05）、Memory Pack 完整真模型契約（#06）、final settlement learning（#07）、paged renderer projection（#08）與完整 degraded/shutdown matrix（#13）仍依各票接續註記驗收，未被本票提前宣稱完成。
- 以 `memoryWriteEnabled: false` 執行明確「請記住」現在會 fail closed，不再繞過凍結的 write policy；相對 smoke 已改成同時證明 denied 與 enabled 情境。
- Async store failure 會把同一 Turn Record／attachment 結算為 failed 再清除 binding；非法 project 在任何 attachment side effect 前 canonicalize，避免不可重試的永久 active run。
