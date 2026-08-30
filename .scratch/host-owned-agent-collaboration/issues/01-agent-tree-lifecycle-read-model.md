# 01 — Agent tree 與 lifecycle read model

**What to build:** 使用者與 agent 能從同一個 Host-owned read model 看見 root、parent、children、canonical task path 與每個 agent 的 lifecycle state。既有 Child Pi Session 也投影成相同契約；列表、Turn Record 與最小診斷 UI 對同一狀態給出相同答案。

**Blocked by:** None — can start immediately.

**Status:** 實作完成；整體 qualification 依使用者要求延後至全部 tickets 完成後一次執行（2026-08-30）

- [x] Root 與 child 都有穩定 tree identity、canonical task path、parent edge 與 bounded display metadata
- [x] Lifecycle 至少區分 queued、admitted、running、waiting-approval、blocked、completed、failed、cancelled、interrupted，未知或舊資料誠實降級
- [x] Host protocol 可列出一棵 tree 或指定 agent 的公開 read model，且不能跨 root 洩漏其他 conversation
- [x] Tree/lifecycle 變化使用 typed Turn Record entries，live 與 replay 順序一致
- [x] Renderer 只 feature-detect 並投影 Host snapshot，不保存第二份 canonical tree
- [x] 既有 child session 可讀且不需要破壞性資料遷移
- [x] Protocol-level smoke 以外部行為驗證 root、child、nested child、archived/legacy session 與狀態轉移
- [ ] 全部 tickets 完成後執行一次完整 smoke

## Evidence

- `app/scripts/smoke-agent-tree-read-model.mts`：negotiated `agent-tree-v1`、root-scoped protocol、nested child、live/replay lifecycle、全部狀態 projection、UTF-8 bounds、非法 transition、upcoming-turn attribution 與 legacy fail-closed projection。
- `app/scripts/smoke-pi-host-steer-queue.mts`：active follow-up 經共用 enqueue port，並在上一輪 terminal 後以 turn 2 落盤。
- `app/scripts/smoke-pi-delegated-goal-host.mts`：delegated child enqueue 經相同 port 寫入 child lifecycle record。
- `app/scripts/smoke-pi-turn-record.mts`：Turn Record v13、typed `agent-lifecycle`、v12 migration boundary 與 bounded metadata。
- `npm run build`、`npm run smoke:pi-host` 全綠；完整 `npm run smoke` 已依使用者指示停止重複執行，保留到 ticket 15 統一 qualification。
