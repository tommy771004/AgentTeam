# 05 — Builtin Pi scoped recall 與 Turn Record provenance

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓每個 builtin Pi Chat turn 以 admission 已凍結的 memory context 從 SQLite 召回 current project + global memories，並把使用過的 memory identities 與 store revision 寫進同一份 Turn Record。完整 memory text 只以 bounded、untrusted context 進入模型，不複製進 timeline metadata。

## Acceptance criteria

- [x] recall 使用 run admission 的 canonical project、memoryEnabled 與 temporary snapshot，不在執行途中重讀可變 Settings
- [x] current project + global 可召回，其他 project 無論 query 命中與否都不可見
- [x] profile 與 memory document 維持 always-recall；一般 entries 維持 01 parity corpus 的排序與 limit
- [x] temporary 或 memory disabled 的 turn 完全不讀 durable memory，context 與 Turn Record 都無假 recall
- [x] recalled content 維持 bounded untrusted framing，明確不能被當成 system instruction
- [x] Turn Record 保存 recalled identity、scope-safe metadata 與 store revision，不保存完整 private memory text
- [x] live 與 replay 從同一 Turn Record 看見一致 provenance，沒有第二條 activity timeline
- [x] 真 Pi Host turn smoke 覆蓋 scoped recall、global recall、disabled/temporary 與 restart 後 recall

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover

## 接續註記（#04）

#04 為避免切換後仍讀 JSON，已將 turn recall 改為 await DurableMemoryStore，並在建立 attachment 前驗證 frozen project/flags。此票仍需補 recalled identities/revision 的 Turn Record provenance、live/replay 與完整真 Host turn matrix；不要再引入 snapshot.memories owner。

## Progress — 2026-08-27

- 新增 Turn Record v2 `memory-recall` entry：只含 store revision 與 bounded `{id, logicalKey, scope kind, memory kind, entry revision}`；v1 可無損讀取升級，未知版本 fail-closed。
- 真 Host turn 已覆蓋 current project + global、other project 隔離、profile/document always-recall、disabled、temporary、live/returned/replayed record 一致與 Host restart 後 recall；model request 證明正文只出現在 bounded untrusted context。
- bounded context builder 同時回傳真正貢獻 bytes 的 memories，provenance 不再把截斷後未使用的項目算入；Host 以 canonical `cwd` 凍結 scope，拒絕 caller 傳入不一致 project。
- `npm run build`、完整 `npm run smoke`、修復後 `smoke:pi-parity-qualification`／`smoke:pi-host`、oxlint、complexity 與 tracker guard 全綠。雙軸 review 的 standards／spec findings 均已修復並重審通過。
