# 13 — Host storage lifecycle、corruption 與 downgrade

Status: 已解決
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

#04 已落地核准的 state 目錄 barrier、私有 backup/report、重啟式 cutover，並使 stdio EOF 等待 in-flight request/persistence 後 close。詳見 [cutover-recovery.md](../cutover-recovery.md)。本票仍須 bounded shutdown、typed degraded health／Settings 呈現、integrity/corruption 與完整 WAL/permission matrix；目前的 OS rename barrier 測試不是歷史 Electron binary 測試。

完成 memory database 的 startup/readiness/shutdown/recovery lifecycle。Host 只有在 DB open、integrity/schema validation 與 migration 成功後才 ready；關閉會 drain/checkpoint/close。corruption、unsupported schema 與 downgrade 都進入可見的 degraded/fail-closed 狀態，不會靜默生成空 authority。

## Acceptance criteria

- [x] Host readiness gate 等待 memory DB open、schema/integrity check 與必要 migration；未完成時不接受 memory-dependent turn
- [x] shutdown 停止新 writes、drain 已接受 transactions、checkpoint WAL、close，並有 bounded timeout 與 honest failure
- [x] committed WAL 在 crash restart 後恢復；uncommitted mutation 不可見
- [x] JSON parse failure、SQLite integrity failure、unsupported future schema、migration failure 與 permission error 是不同 typed health states
- [x] degraded state 不覆寫、rename 或清空原資料；安全時可提供 read-only recovery/export，否則明確拒絕
- [x] incompatible downgrade 不重新啟用 JSON owner，錯誤訊息說明需要相容版本或 explicit export
- [x] Host status／Settings projection 能顯示 memory unavailable/degraded，不把它呈現為「0 筆記憶」
- [x] lifecycle smoke 覆蓋 clean start/stop、immediate kill、WAL recovery、corrupt JSON/DB、future schema、permission failure 與 restart

## Implementation evidence

- `SqliteDurableMemoryStore.open()` 先跑 integrity、future schema 與既有 schema shape preflight，再於 transaction 內完成 migration；只有成功後才切 WAL 並由 Host 回報 ready。
- storage lifecycle 以 `ready`、`closing`、`closed`、typed `degraded` 投影；JSON parse、SQLite integrity、future schema、migration、permission、checkpoint 與 timeout 不再混成空 authority。
- close admission 先拒絕新 writes，再 drain 已接受 mutation、`wal_checkpoint(TRUNCATE)`、close；store 與 supervisor 都有 bounded timeout，失敗不宣稱 clean shutdown。
- Pi Host startup failure 會先送出 metadata-only `host/storage-health`；supervisor 保留 degraded 原因，Settings／Learning 停用 memory writes 並顯示 unavailable，而不是 0 筆。
- unsafe corruption/downgrade 明確回報 `readOnlyExport: false` 且保留原檔；future schema 指示使用相容版本或由相容版本 explicit export，沒有重新啟用 JSON owner。
- `smoke-memory-storage-lifecycle.mts` 覆蓋 clean/bounded close、拒絕新 write、accepted write drain、immediate kill、committed WAL recovery、uncommitted rollback、corrupt DB、future schema、migration shape、OS/SQLite permission、Host shutdown 與 corrupt JSON preservation。
- `npm run smoke:pi-parity-qualification` 通過；完整 `npm run smoke` 亦通過 Ticket 13 memory matrix，之後才在未屬本票的 `smoke-pi-host-orchestration.mts:165` 既有斷言停止。

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover
