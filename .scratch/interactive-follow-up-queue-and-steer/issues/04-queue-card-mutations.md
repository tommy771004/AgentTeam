# 04 — Queue 卡片編輯、刪除與重新排序

Spec: `../spec.md`

**What to build:** 讓使用者直接在 composer pending cards 管理尚未 dispatch 的 Host queue：可編輯文字、刪除項目、以 pointer 或鍵盤重新排序。每次 mutation 都以 expected queue revision 進行 Host compare-and-set；成功後由新 snapshot/event 更新 UI Projection，衝突則保持 Host 順序並提示重新整理，不在 renderer 先寫一份競爭真相。

**Blocked by:** 03 — Host-owned 同 Pi Session FIFO Queue.

**Status:** 可交給代理

- [ ] Host 公開 bounded、versioned 的 edit、cancel 與 reorder mutations，且全部限定同一 Pi Session 的 mutable queued items
- [ ] Mutation 以 expected queue/item revision 原子驗證；stale revision 明確失敗且不造成 partial update
- [ ] 使用者可編輯 queued item 的指令與允許變更的附件 metadata，成功後仍保留相同 item identity 與新的 revision
- [ ] Cancel 為 idempotent，移除 queued item 不停止 active Task run，也不讓較舊 renderer event 將它復活
- [ ] Reorder 維持同 session item 集合完整，不跨 conversation 移動、不遺失、不複製，並更新真實 queue positions
- [ ] Accepted steer、dispatching、settled、cancelled items 不提供成功的 edit／cancel／reorder path，UI 只顯示合法 controls
- [ ] 卡片支援鍵盤可達的編輯、刪除、上移與下移；焦點、accessible name 與 status announcement 正確
- [ ] Rendered Host-backed smoke 覆蓋成功 mutation、stale conflict、idempotent cancel、鍵盤排序與 immutable states

