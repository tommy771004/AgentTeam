# 07 — Task run learning 的結算生命週期

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

把明確「請記住」與 automatic learning 接進 Task run 的唯一 finalization，定義何時能 commit、何時必須不寫。External CLI 在尚未具備相同 scoped recall 前不得自動塑造 shared memory，避免只寫不讀的不對稱 lifecycle。

#04 已把既有候選 write 接到 DurableMemoryStore、套用 frozen write flag，async storage error 會關閉同一份 Turn Record/attachment。但候選目前仍在舊 iteration commit 點；本票必須移到規定的 final settlement、補完整 DoD／取消／retry matrix，以及停用 External CLI asymmetric learning。

## Acceptance criteria

- [x] explicit remember 使用 deterministic source operation，只有成功 interpretation/response settlement 後 commit，retry 不重複
- [x] automatic learning 只在 final success 且 DoD met 後 commit；寫入發生於既有 unique finalization，不另建 coordinator
- [x] success without DoD、failed、cancelled、denied、interrupted 與 finalization recovery failure 都不建立 automatic memory
- [x] temporary、memory disabled 與 write disabled 套用 admission snapshot，run 中 Settings 改變不改寫既定政策
- [x] finalization retry／renderer reattachment／idempotent settlement 不會重複寫 automatic memory
- [x] External CLI automatic shared-memory write 被停用；手動 admin memory 不受影響，UI/record 不宣稱 CLI 已學習
- [x] run memory digest／project artifact 等其他既有 finalization 產物維持原 owner，不與 durable memory 混為同一儲存
- [x] lifecycle matrix smoke 覆蓋每個 terminal outcome、DoD、temporary、policy、retry 與 external runner

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover

## Resolution evidence

- Pi turn 只在 Host attachment 保存 deterministic learning candidate 與 admission-frozen memory policy；iteration 不再直接寫入 durable memory。
- renderer 的既有 app-finalization CAS 提交 final status、execution kind 與 DoD evidence；Host 在 SQLite commit 成功後才完成 finalization claim，失敗則保留 attachment 供 reattachment 重試。
- `run-learning-finalization` 是穩定 operation identity；相同 payload 的重試回傳既有結果，不增加 store revision，也不重複發布 write evidence。
- explicit remember 只要求 builtin final success；automatic learning 額外要求 `dodMet === true`。所有非 success、無 DoD、external runner、temporary、memory/write disabled 均 fail closed。
- `persistRunMemoryDigest`、artifact index、archive、journal terminal 與 queue release/drain 仍留在原 `runFinalizationSequence` owner，未與 SQLite durable memory 混成第二套結算器。
- 驗證：`npm run build`、`smoke-run-learning-settlement.mts`、`smoke-finalize-idempotency.mts`、`smoke-run-lifecycle.mts`、`smoke-pi-host-memory-policy-matrix.mts`、`smoke-pi-memory-pack-lifecycle.mts`。
