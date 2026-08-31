# 02 — Pinned npm 安裝、移除與安全 reload

**What to build:** 讓使用者從 Pi Packages Settings 輸入或選擇一個 `npm:<name>@<exact-version>` source，閱讀完整本機權限與 npm lifecycle scripts 警告並明確確認後，由 Pi Core Host 安裝到 user scope。使用者也能移除套件；成功 mutation 使舊 runtime 失效並讓下一輪載入新 state，失敗則保持原狀。執行中的 Pi run 存在時，安裝與移除必須 fail-closed，不在 turn 中熱切換資源。

**Blocked by:** 01 — Host-backed 已安裝清單

**Status:** 可交給代理

- [ ] Host 只接受 pinned npm user-scope source；unpinned npm、git、URL、local path 與 project-local request 均以可辨識原因拒絕
- [ ] 安裝前 UI 明示 package、npm lifecycle scripts 與 extensions 可能取得完整 filesystem、process、network、environment 與 credential authority，且不是 sandbox
- [ ] 未取得本次操作的明確 trust confirmation 時，Host 不啟動安裝
- [ ] 安裝直接復用 Pi 原生 package lifecycle 並持久化到有效 user agent directory，不 shell out 到 Pi CLI，也不經既有 MCP plugin installer
- [ ] 安裝成功後已安裝清單反映 exact source/version；安裝失敗時不宣告 installed、不留下 renderer-only 成功狀態
- [ ] 移除成功後 persisted package state 更新，且 UI 從 Host truth 移除該列
- [ ] 成功安裝或移除後舊 session runtime 失效，下一個 Pi-backed run 重新建立 resource loader；失敗操作不前進 runtime generation
- [ ] 有受影響 active Pi run 時 install/remove fail-closed，package state 與 runtime generation 均不變
- [ ] 現有 build 與相關 lifecycle checks 維持通過，不加入 update、背景更新或 package-manager 選擇功能
