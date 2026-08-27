# Host state 切換與復原邊界

使用者於 2026-08-27 核准更改 Host state 檔案佈局。只有長期記憶移到 SQLite；sessions、Turn Record、settings、queue 等仍由原 Host snapshot owner 保存為 JSON。

## 佈局

以預設 `pi-host-state.json` 為例（測試／自訂環境可覆寫路徑）：

```text
pi-host-state.json/                  ← 舊 pathname 改成目錄，阻擋舊 writer 的 rename
  snapshot.json                    ← schema 3，memoryAuthority，memories: []
  migration-report.json            ← source hash、匯入數、拒絕 index/reason，不含正文
  README.txt                       ← 相容版本／明確匯出與備份說明
pi-host-state.json.pre-sqlite.json  ← 原始來源，0600，僅供復原
durable-memory.sqlite             ← 唯一 live memory authority
durable-memory.sqlite-wal / -shm   ← SQLite 管理的 sidecars（可能不存在）
```

來源、資料庫、WAL 與備份可能含 private plaintext。這不是加密儲存；分享診斷時不要附上正文。備份包含被拒絕的原始 rows，所以即使 live memory 已刪除內容，歷史備份仍可能保留；此票不宣稱 hard delete，後續 #09/#14 定義其策略。

## 啟動與恢復

`openPiHostStorage` 驗證來源、保存原始備份後，將有效 rows 與 source-hash marker 放在同一 SQLite transaction。commit 完成才寫 staged snapshot/report 並安裝目錄。新版本僅在這些步驟成功後接受請求。

- backup-ready 或 commit 前退出：從原始 JSON／已保存備份安全重試。
- commit 後、目錄安裝前退出：依同 source-hash marker 跳過匯入，繼續 state advance。
- 原 pathname 已 retire、目錄尚未安裝：以同層備份接續；不把缺少原 pathname 當新安裝。
- 目錄已安裝：只使用 SQLite。即使 live entries 已全部清空也不回放備份。
- 已安裝但 DB 遺失、marker 不符、來源 JSON 損壞、未知 schema 或 permission failure：拒絕啟動，不生成空白 authority。

若啟動失敗，先停止相關 Host，保留整個 state 目錄、SQLite 及其 sidecars、原始備份與錯誤訊息；使用相容版本診斷。不要刪除目錄 barrier、移除 migration marker 或把 backup 覆蓋成 live JSON。這些操作會破壞 authority／版本邊界。完整 degraded UI、read-only recovery/export、bounded shutdown 與 hard-delete 支援仍由 #09/#11/#13/#14 承接。

## 降級證據的範圍

已查核歷史 `cf76e89` 的 writer 使用 temp-file + rename，舊 reader 遇到 schema／讀檔錯誤會回空 state。此次測試以真實 OS rename 驗證一般檔案不能取代已安裝目錄，並檢查 actionable README。**沒有宣稱執行歷史 Electron binary**，也無法反向改善歷史 binary 的錯誤 UI；它會遇到檔案系統拒絕，使用者需遵照 README 使用相容版本或日後的明確匯出流程。

測試入口：`app/scripts/smoke-pi-host-memory-migration.mts`、`smoke-durable-memory-migration.mts`、`smoke-pi-memory-cutover-consumers.mts`，皆由 `npm run smoke:pi-parity-qualification` 執行，後者已在主 smoke chain。
