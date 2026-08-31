# 06 — Lifecycle qualification 與 release gate

**What to build:** 以一個受控 fixture package，從現有 Host package protocol／runtime qualification seam 驗證完整使用者 lifecycle：pinned install、installed truth、safe reload、Agent Chat／Pi-backed SubDesign 的 package skill discovery、明確 trust 後的 extension tool admission、remove 與下一輪資源消失。再以一個關鍵失敗情境證明 active Pi run 期間 mutation fail-closed。驗證掛入既有 release gate，不建立新測試框架或擴成邊界矩陣。

**Blocked by:** 03 — Package Skills 共享到 Chat／SubDesign; 04 — Trusted Extension Tools admission; 05 — npm Catalog 與 pi.dev 詳情入口

**Status:** resolved

- [x] 單一 fixture package 僅包含一個 skill 與一個不碰撞 builtin 的 extension tool，足以驗證已接受的主路徑
- [x] 主路徑從 pinned install 開始，證明 Host installed truth、runtime reload、Agent Chat 與 Pi-backed SubDesign 看見同一 package skill provenance
- [x] 主路徑證明 extension tool 安裝後預設 inactive，明確 trust/enable 後才進 active Host tool contract 並留下 package source/version evidence
- [x] 主路徑完成 remove，並證明安全 reload 後 Chat、SubDesign 與 active-tool contract 均不再看見 fixture resources
- [x] 唯一新增關鍵失敗路徑在 active Pi run 期間提出 mutation，斷言 fail-closed、package state 與 runtime generation 不變
- [x] 驗證沿用既有 Host protocol、Pi runtime fixture 與 smoke infrastructure，不新增測試框架、browser E2E 基礎設施、snapshot 或參數矩陣
- [x] Qualification 掛入既有 release gate，且 gate 執行 shipped modules 而非重寫 production logic
- [x] 現有 build 與完整 smoke 維持通過，release evidence 可一 hop 回查主路徑與 fail-closed 結果

## Comments

2026-08-31：`smoke:pi-packages:built` 已掛入 `qualify:pi-runtime-contract`，由既有完整 smoke 呼叫。Lifecycle 透過同一 Host 的 Chat／SubDesign session seam 驗證安裝、共享 skill、trust、approval/record、同 session 移除與 busy refusal；不聲稱是兩個 UI 的 browser E2E。移除只要求當輪 system prompt 不再注入，合法歷史訊息仍保留。

完整 `npm run smoke` 僅啟動一次，遇到失敗後依序修正並從失敗段落續跑，所有段落已各自取得通過結果；**不是修正後再跑一次單一命令全綠**。修正了 workspace search 過期 guard、Pi settings 無 provider 的過期 fixture，以及 Electron reattach fixture 意外讀取真實 native Pi/OAuth 的隔離缺口。Build、package focused、recovery、剩餘 gate 與 2 active + 2 terminal Electron reattach 均通過。詳見 [release evidence](../release-evidence.md)。
