# 01 — Host-backed 已安裝清單

**What to build:** 在 Settings 提供 Pi Packages 的唯讀已安裝清單。使用者開啟頁面時，renderer 經 feature-detected bridge 向 Pi Core Host 取得目前有效 user agent directory 的真實 package state；每列呈現固定來源、版本、已解析的相容資源與 diagnostics，並清楚區分 Pi-native packages 與既有 connector／MCP integrations。這張票建立後續 mutation 共用的 Host authority read path，不從 renderer storage、catalog cache 或 metadata registry 推測 installed 狀態。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Settings 可開啟 Pi Packages 區塊，並在 Host 不支援 package protocol 時如實顯示 unavailable，而不是報錯或假資料
- [x] 已安裝清單由 Pi Core Host 讀取目前有效 user agent directory 的 persisted package settings 與 installed state
- [x] 每列顯示 package source、exact version、可辨識的 resource types 與 bounded diagnostics；缺資料時明確標示 unknown
- [x] Pi Packages 與 curated connector／MCP integrations 使用不同語意，不共用模糊的 installed flag
- [x] Renderer 不掃描 package 目錄、不讀寫 package authority，也不以 local storage 或 catalog result 判定已安裝
- [x] 現有 build 與相關 Host protocol／Settings checks 維持通過，且不新增新的測試框架

## Comments

- 2026-08-31：`npm run build` 通過；受控 agentDir fixture 證明 configured package、exact version 與 skill resource inventory；`smoke-pi-host-capabilities.mts`、`smoke-pi-host-extensions.mts` 與 focused oxlint 通過。Code review 修正 bounded package.json TOCTOU、project-settings 汙染與 configured/installed version mismatch。
- 完整 `npm run smoke` 已執行但未全綠：既有 `smoke-instruction-run-snapshot.mts:335` 在 durable-memory revision 斷言期望 `1`、實得 `11`，單獨重跑實得 `12`。失敗發生於本次 package inventory 之外，且共享 worktree 已有未提交的 Host/memory 變更；未修改無關模組來掩蓋。Ticket 暫維持 `claimed`，不宣稱 resolved。
- 2026-09-01：重新執行 shipped-bundle `npm run smoke:pi-packages`、原始失敗點 `smoke-instruction-run-snapshot.mts`、in-memory 與 SQLite durable-memory contract，全部通過。先前 revision mismatch 已不存在，故依既有 acceptance 收口為 `resolved`。
