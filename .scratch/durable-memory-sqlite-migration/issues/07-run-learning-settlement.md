# 07 — Task run learning 的結算生命週期

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把明確「請記住」與 automatic learning 接進 Task run 的唯一 finalization，定義何時能 commit、何時必須不寫。External CLI 在尚未具備相同 scoped recall 前不得自動塑造 shared memory，避免只寫不讀的不對稱 lifecycle。

## Acceptance criteria

- [ ] explicit remember 使用 deterministic source operation，只有成功 interpretation/response settlement 後 commit，retry 不重複
- [ ] automatic learning 只在 final success 且 DoD met 後 commit；寫入發生於既有 unique finalization，不另建 coordinator
- [ ] success without DoD、failed、cancelled、denied、interrupted 與 finalization recovery failure 都不建立 automatic memory
- [ ] temporary、memory disabled 與 write disabled 套用 admission snapshot，run 中 Settings 改變不改寫既定政策
- [ ] finalization retry／renderer reattachment／idempotent settlement 不會重複寫 automatic memory
- [ ] External CLI automatic shared-memory write 被停用；手動 admin memory 不受影響，UI/record 不宣稱 CLI 已學習
- [ ] run memory digest／project artifact 等其他既有 finalization 產物維持原 owner，不與 durable memory 混為同一儲存
- [ ] lifecycle matrix smoke 覆蓋每個 terminal outcome、DoD、temporary、policy、retry 與 external runner

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover
