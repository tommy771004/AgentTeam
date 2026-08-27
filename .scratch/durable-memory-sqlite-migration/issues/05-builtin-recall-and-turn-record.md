# 05 — Builtin Pi scoped recall 與 Turn Record provenance

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

讓每個 builtin Pi Chat turn 以 admission 已凍結的 memory context 從 SQLite 召回 current project + global memories，並把使用過的 memory identities 與 store revision 寫進同一份 Turn Record。完整 memory text 只以 bounded、untrusted context 進入模型，不複製進 timeline metadata。

## Acceptance criteria

- [ ] recall 使用 run admission 的 canonical project、memoryEnabled 與 temporary snapshot，不在執行途中重讀可變 Settings
- [ ] current project + global 可召回，其他 project 無論 query 命中與否都不可見
- [ ] profile 與 memory document 維持 always-recall；一般 entries 維持 01 parity corpus 的排序與 limit
- [ ] temporary 或 memory disabled 的 turn 完全不讀 durable memory，context 與 Turn Record 都無假 recall
- [ ] recalled content 維持 bounded untrusted framing，明確不能被當成 system instruction
- [ ] Turn Record 保存 recalled identity、scope-safe metadata 與 store revision，不保存完整 private memory text
- [ ] live 與 replay 從同一 Turn Record 看見一致 provenance，沒有第二條 activity timeline
- [ ] 真 Pi Host turn smoke 覆蓋 scoped recall、global recall、disabled/temporary 與 restart 後 recall

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover

## 接續註記（#04）

#04 為避免切換後仍讀 JSON，已將 turn recall 改為 await DurableMemoryStore，並在建立 attachment 前驗證 frozen project/flags。此票仍需補 recalled identities/revision 的 Turn Record provenance、live/replay 與完整真 Host turn matrix；不要再引入 snapshot.memories owner。
