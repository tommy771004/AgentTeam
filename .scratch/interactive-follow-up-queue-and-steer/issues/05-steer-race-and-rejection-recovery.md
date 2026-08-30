# 05 — Steer 競態與拒絕恢復

Spec: `../spec.md`

**What to build:** 讓執行中的 steer 在 active turn 變更、無 active turn、non-steerable operation 或 Host 暫時不可用時誠實失敗且不遺失使用者文字。Host 以 expected active identity 原子拒絕 stale target；client 最多在取得最新 Host snapshot 且語意仍成立時重試一次，否則保留 rejected card，讓使用者明確改成 Queue 或放回 composer 編輯。

**Blocked by:** 02 — Builtin Pi same-turn Steer; 03 — Host-owned 同 Pi Session FIFO Queue.

**Status:** 可交給代理

- [ ] Steer acceptance 與 active turn/run identity check 在 Host 內原子完成，renderer 觀察值不能單獨授權注入
- [ ] Stale target 回傳 bounded current identity／revision 或明確 stale result，輸入不會進入舊 turn 或錯誤的新 turn
- [ ] Client 只可在刷新 Host truth 後進行一次 bounded retry，retry 沿用同 client identity 且不重複交付
- [ ] No-active-turn、non-steerable、Host unavailable、capability lost 與 protocol rejection 有可區分結果，不以 accepted 或 busy 模糊帶過
- [ ] 未接受的原始文字與附件 metadata 保留於 rejected card 或 composer recovery state，不靜默丟棄
- [ ] 使用者可明確把 rejected steer 改為 Queue；系統不得自動改變動作後又宣稱 steer 成功
- [ ] Rejected／recoverable cards 提供 bounded reason、下一步與合法 controls，並維持鍵盤及 screen-reader 可用性
- [ ] Black-box smoke 覆蓋 turn swap race、一次 retry、retry 後仍 stale、non-steerable fallback、Host failure 與 identity dedupe

