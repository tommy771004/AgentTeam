# 02 — Builtin Pi same-turn Steer

Spec: `../spec.md`

**What to build:** 讓使用者在 Builtin Pi 的 Task run 執行中送出「引導」，輸入經正常 composer/controller 與 Task run coordinator 邊界交給 Pi Host，加入 active Pi turn 的 pending input，並在下一個 model/tool 安全邊界恰好交付一次。原 Task run 不被停止、不換 run identity；composer 上方立即投影一張包含實際指令摘要與 Host 接受狀態的 pending steer card。

**Blocked by:** 01 — Follow-up 動作契約與「中止並接手」語意展開.

**Status:** 可交給代理

- [ ] Active Builtin Pi run 的 steer 從公開 composer submission 流程抵達 Pi Host，renderer 不直接呼叫 Pi runtime
- [ ] Host 接受 steer 時驗證 conversation、Pi Session 與 active turn/run identity，成功回傳同一 active Task run identity
- [ ] Accepted steer 在下一個安全 model/tool 邊界進入模型輸入恰好一次，不中止 active run、不另建 Chat turn 或 Task run
- [ ] Composer 執行中同時保留送出與停止兩個獨立控制；送出 steer 不觸發 stop
- [ ] Pending steer card 顯示 bounded 實際指令、動作與 submitting／accepted 狀態，不退化成重複 generic label
- [ ] Accepted steer 不顯示編輯、刪除或撤回控制；其 lifecycle 由 Host facts 單向投影
- [ ] Turn Record／conversation 在 truthful boundary 記錄使用者 steer，不從 model prose 或 transcript parser 重建接受狀態
- [ ] 真 Pi Host black-box smoke 證明 run identity 不變、無 stop、單次安全邊界交付，rendered composer smoke 證明卡片與獨立 controls

