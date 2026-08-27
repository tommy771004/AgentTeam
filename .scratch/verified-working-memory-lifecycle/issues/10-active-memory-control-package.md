# 10 — Active Memory-Control Package 綁定 Task run

**What to build:** 建立 immutable Memory-Control Package lineage，將 Experiential Skills、Working Memory specification、invocation policy 與 Checkers 的精確 revisions/digests 綁定到每個新 Task run。

**Blocked by:** 08 — Skill 命中後的 not-executed redraft

**Status:** 完成

- [x] Package schema 對四個 components 分別保存 immutable identity、revision 與 digest，並具有 parent revision 與 candidate/active/rejected status。
- [x] 新 Task run 在 admission 時原子取得一個 active package revision，run 中途的 activation 不改寫已凍結 identity。
- [x] Turn Record 在 turn 開始記錄 governing package identity，後續 Skill invocation 與 Checker trace 可連回同一 revision。
- [x] Package repository 與 durable-memory SQLite authority 隔離；本票不新增或修改 durable-memory schema、migration、CRUD 或 export contract。
- [x] Host restart 後 active revision 與 immutable package bodies 保持一致；未知、corrupt 或 digest mismatch package fail closed。
- [x] Package content 只能經 versioned Host interface 讀取，renderer 不能直接修改 active package。
- [x] Host lifecycle smoke 證明兩個不同時間 admission 的 runs 各自固定在正確 revision，並已加入實際 smoke gate。
