# SubDesign × Open Design IDE 分階段實作計畫書

日期：2026-07-15
狀態：執行中；完成項目直接打勾。
依據：官方 source research、README Product tour、既有 SubDesign canonical stores。

## 成功條件

使用者能從 Home 選擇 artifact/skill/design system/agent 並建立 Project；之後所有方向選擇、Agent run、Artifact revision、Preview/Code、Critique、Export 都在 `/subdesign/:briefId` 的同一 Project Studio 完成，沒有假資料 owner 或第二套執行生命週期。

## Phase 0 — Source map 與產品模型

- [x] 讀取官方 README Product tour 與 workflow 說明。
- [x] 下載並保存 Home、entry、Design System、Prototype、Deck、Image screenshots。
- [x] 研究官方 IDE routes、agent runtime、project/artifact contracts、tools/plugins/skills。
- [x] 建立 workflow blueprint。
- [x] 建立 object/event/tool authority map。
- [x] 明確定義 Home、Project Studio、Design System picker、Contract Studio 的 route 責任。

驗收：文件中的每個重要行為能連回官方 source 或本專案 canonical owner。

## Phase 1 — Home creation context

- [x] `/subdesign` 只負責建立 Project，不再自動顯示最近 brief 的 Project header。
- [x] Composer 選擇 surface/platform/design system。
- [x] 增加 Agent selector，僅列 Built-in 與 enabled + authorized CLI。
- [x] 建立 Thread 時把 selector 寫入 `Thread.runner`。
- [x] 空 brief 時停用 Create，避免建立無目標 Project。
- [x] 最近 Project 點擊後進入 `/subdesign/:briefId`。
- [ ] 將 Skill selector 從 template 隱式推導改成明確可檢查的 selection summary。
- [ ] 將 attachment/reference 直接放進 Home composer，而非 Project 建立後才顯示。

## Phase 2 — Project Studio shell

- [x] `/subdesign/:briefId` 與 Home 分離。
- [x] 建立左 Agent context／右 Artifact workspace 的雙欄 Studio。
- [x] Header 顯示 Project、surface/platform、active Design System、run/stage status。
- [x] Design journey 顯示 Brief → Direction → Build → Critique → Deliver。
- [x] Direction cards 可由使用者直接鎖定並寫回 canonical brief。
- [x] Agent 執行使用原有 `runTask` 與 run-scoped `RunProcessFeed`。
- [x] Design Files／Critique／Deliver tabs 使用既有 stores 與 tools。
- [x] Preview／Code 讀取相同 artifact revision。
- [ ] 在 Studio composer 支援 follow-up，而不必跳回通用 thread page。
- [ ] Agent／model 切換需明示會從新 session 還是 resume 現有 upstream session。

## Phase 3 — Design System contract

- [x] `/design-systems` 改為 searchable single-select picker。
- [x] 支援 Project default、查看、選取、套用與 `returnTo + briefId`。
- [x] `/design-systems/:id` 改為雙欄 Contract Studio。
- [x] 提供 Design System／DESIGN.md tabs。
- [x] active Design System 顯示於 Project Studio header。
- [ ] 將 Contract sections 做成可展開 preview specimen，而不只是 Markdown 摘要。
- [ ] Agent 修改 Contract 時產生 revision/diff，並要求明確採用。

## Phase 4 — Artifact event loop

- [x] Artifact manifest、renderer、exports、revision、status 有 canonical types。
- [x] Electron read/list/patch/tweak IPC 已接線。
- [x] HTML preview 使用 sandbox iframe + CSP。
- [x] Source mode 顯示同一份 artifact content。
- [x] Artifact selection 使用 id + revision key。
- [ ] 將 streaming artifact event 即時投影到 Studio，不等 run 結束才刷新。
- [ ] Design Files 顯示 supporting files 與 manifest diagnostics。
- [ ] Comments／annotation 轉為可追蹤 revision request。

## Phase 5 — Critique、Deliver、Memory

- [x] Critique Theater 使用兩輪三 panelist、capture/lint evidence。
- [x] mutation tools 在 Critique 階段被阻擋。
- [x] verdict 綁定 artifact revision。
- [x] Deliver 只在 critique pass 後開放。
- [x] Export 需要 HITL 並記錄 path/bytes/hash/revision。
- [x] passed preference 可回填下一次 Project 的 design system/template/skills。
- [ ] 將 revision request 直接變成可執行 follow-up action。
- [ ] Memory UI 顯示預設來源、最後確認時間與清除操作。

## Phase 6 — Settings、Agent、Plugin/Tool parity

- [x] 重用既有 `LlmSettings`、CLI provider、role model、sub-agent 開關。
- [x] 重用 `taskRunCoordinator`，不引入 Open Design daemon 的第二套 run lifecycle。
- [x] Open Design vendor inventory 有 digest/license/provenance 與安裝狀態。
- [ ] Plugin/Skill/Design System 三個 selection plane 在 Home 顯示成可檢查 summary。
- [ ] 每個 Plugin 顯示它會啟用的 tools、side effects 與 approval needs。
- [ ] 外部 CLI capability matrix 顯示 resume/image/MCP/tool support，避免只顯示名稱。
- [ ] 對 enabled sub-agent 設定在 Studio 顯示「可委派／已停用」狀態。

## Phase 7 — Verification

- [x] 新 Studio source 通過 TypeScript。
- [x] 新 Studio source 通過 targeted oxlint。
- [x] 更新 smoke contract，鎖定 Home/Studio 分離與 Agent selector。
- [x] 完整 `npm run smoke`。
- [x] 完整 `npm run build`。
- [x] `npx oxlint src`（通過；僅保留其他既有頁面的 warnings）。
- [x] Browser 驗證 Home selector、空 brief gate、Project route、Project Studio 與 Design System picker。
- [ ] Electron 真實 project root 驗證 DESIGN.md、artifact read/preview/export。

## 本次 commit 範圍

本次先交付 Phase 0、Phase 1 高優先項與 Phase 2 Studio shell，並保留既有 Phase 3–5 功能。後續依未勾選項目順序實作，禁止再次把 Home、Design System library 與 Project Studio 混成同一頁。
