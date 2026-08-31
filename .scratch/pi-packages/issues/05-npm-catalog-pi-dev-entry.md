# 05 — npm Catalog 與 pi.dev 詳情入口

**What to build:** 在 Pi Packages Settings 提供可搜尋的 v1 catalog，使用 npm registry 的 `pi-package` metadata 呈現 package name、exact version、description、repository 與可判斷的 resource compatibility，並提供 pi.dev、npm 與 repository 外部詳情入口。使用者從 catalog 選擇版本後，仍走既有 Host trust/install lifecycle；catalog 只是 discovery projection，不是 installed authority。沒有官方穩定 feed 時，不 iframe pi.dev，也不把其 HTML 當資料契約。

**Blocked by:** 02 — Pinned npm 安裝、移除與安全 reload

**Status:** resolved

- [x] Settings 可依關鍵字搜尋帶 `pi-package` metadata 的 npm packages，並以 bounded result 呈現 loading、empty 與 error 狀態
- [x] Catalog card 顯示 package name、selected exact version、description、source/repository 與可判斷的 supported／unsupported／unknown resource compatibility
- [x] 使用者可外部開啟對應 pi.dev、npm 與 repository 詳情；不可用連結不顯示或明確 disabled
- [x] 從 card 安裝時 source 固定為使用者看到的 exact version，並完整經過既有 trust confirmation 與 Host install path
- [x] Catalog cache/result 不可宣告 package installed、trusted 或 active；這些狀態只從 Host package state 投影
- [x] Catalog request 不夾帶 workspace 內容、conversation、credentials 或其他不必要使用者資料
- [x] 不使用 iframe、webview 或 undocumented pi.dev HTML scraping；pi.dev presentation change 不影響 installed package lifecycle
- [x] Themes、TUI UI、prompts、commands 與 provider extensions 不因 catalog badge 被誤標為 AgentStudio v1 可用

## Comments

2026-08-31：新增 Host npm catalog（最多 12 筆、response/time/cache bounded），只送 explicit query。Manifest 的 extensions 標為 unknown，skills 為 supported、prompts/themes 為 unsupported；不可從 extension 檔案宣稱其 hooks/provider/UI 相容。Settings 沿用既有 install confirmation，顯示 pinned source 與詳情連結，installed 狀態只 join Host inventory。Catalog fixture 及窄版 Settings 渲染檢查通過；未透過 UI 安裝任何真實第三方 package。詳見 [release evidence](../release-evidence.md)。
