# 13 — Host storage lifecycle、corruption 與 downgrade

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

完成 memory database 的 startup/readiness/shutdown/recovery lifecycle。Host 只有在 DB open、integrity/schema validation 與 migration 成功後才 ready；關閉會 drain/checkpoint/close。corruption、unsupported schema 與 downgrade 都進入可見的 degraded/fail-closed 狀態，不會靜默生成空 authority。

## Acceptance criteria

- [ ] Host readiness gate 等待 memory DB open、schema/integrity check 與必要 migration；未完成時不接受 memory-dependent turn
- [ ] shutdown 停止新 writes、drain 已接受 transactions、checkpoint WAL、close，並有 bounded timeout 與 honest failure
- [ ] committed WAL 在 crash restart 後恢復；uncommitted mutation 不可見
- [ ] JSON parse failure、SQLite integrity failure、unsupported future schema、migration failure 與 permission error 是不同 typed health states
- [ ] degraded state 不覆寫、rename 或清空原資料；安全時可提供 read-only recovery/export，否則明確拒絕
- [ ] incompatible downgrade 不重新啟用 JSON owner，錯誤訊息說明需要相容版本或 explicit export
- [ ] Host status／Settings projection 能顯示 memory unavailable/degraded，不把它呈現為「0 筆記憶」
- [ ] lifecycle smoke 覆蓋 clean start/stop、immediate kill、WAL recovery、corrupt JSON/DB、future schema、permission failure 與 restart

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover
