# 08 — Learning／Settings 即時 Host UI Projection

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

#04 已確保 legacy memory API 與 `state/snapshot.memories` 只從 SQLite 產生一次性相容 projection，並發布 post-commit revision；disk JSON 永遠 `memories: []`。本票仍需正式切換 paged capability、讓 UI invalidate/refetch，移除可回寫的 renderer collection／whole-list sync，不可把相容 projection 當另一份 authority。

讓 Learning page 與 Settings 的記憶控制成為 paged Host projection。使用者手動新增、編輯、刪除、切換 project scope 或更新 profile/document 後，畫面依 Host revision 即時 invalidate/refetch，不必切頁，也不再把 renderer collection 同步回 Host。

## Acceptance criteria

- [ ] UI 以 versioned Host list/query 取得 bounded pages、total、scope 與 revision，不在 startup 載入所有 memories
- [ ] `memory/changed` event 只作 invalidation signal；duplicate/out-of-order revision 無害，projection revision 不倒退
- [ ] Host mutation 後畫面不需導覽即可顯示 add/update/delete，stale request 不能覆蓋較新 revision
- [ ] manual add/edit/delete 經 admin origin、central validation/quota 與 commit-before-success，錯誤可見且不 optimistic 假成功
- [ ] profile 與 memory document 透過 global special-entry operations 管理並保留 always-recall semantics
- [ ] project/global scope selector 不允許普通頁面誤清其他 scope；plain-browser 缺 bridge 時安全降級
- [ ] renderer 不再執行 whole-bundle memory sync，也不以 localStorage/Zustand 覆寫 Host canonical memory
- [ ] projection fixture 與 UI smoke 覆蓋即時更新、分頁、stale generation、delete 不復活、profile/document 與 bridge 缺席

## Blocked by

04 — JSON → SQLite 原子遷移與 authority cutover
