# SubDesign × Open Design workflow audit

日期：2026-07-15

## 官方證據

- [Open Design README](https://github.com/nexu-io/open-design/blob/main/README.md)
- [影片：告別 Claude Design，擁抱 Open Design](https://www.youtube.com/watch?v=yKXqup5Fyck&t=181s)
- [Open Design 操作指南](https://yujustcoding.com/step-by-step/open-design-claude-alternative.html)

本次以官方 README 的圖片順序與說明為主要依據。影片播放器在自動化環境會出現黑色合成層，因此不把影片影格當成唯一證據。

## README 圖片串起的 workflow

1. **Home / Brief**：使用者從同一個 composer 開始，選 artifact kind、Skill 與 Design System，再輸入需求。
2. **Direction**：沒有既有品牌時選 curated direction；已有品牌時可由 screenshot、URL 或 Figma 萃取成 `DESIGN.md`。
3. **Design System contract**：Design System 是綁在 project 上的生成契約，不是獨立的品牌素材首頁。
4. **Project Studio**：左側持續與 Agent 對話、執行與修訂；右側在 Design Files、Preview／Code 與不同 artifact renderer 間切換。
5. **Critique in place**：在相同 Studio 對區段或 artifact 提出 feedback，修改後立即預覽，不切離專案上下文。
6. **Share / Export**：輸出 HTML/CSS、PPTX、PDF、MP4 等真實檔案。
7. **Memory**：已確認的 screenshot、font、palette、Design System 與 artifact 成為下一次 session 的預設脈絡。

簡化狀態鏈：

`brief → plugin/skill → direction → DESIGN.md → artifact → critique/revision → handoff → memory`

## Design System 的兩個入口

| 位置 | 責任 | UI 形式 |
| --- | --- | --- |
| 建立前 | 決定本次 brief 綁定哪一份品牌契約 | 建立流程中的 searchable single-select picker |
| 建立後 | 檢查、編輯並持續套用同一份契約 | Project Studio 內的 Design System／DESIGN.md workspace |

因此 `/design-systems` 不應是大標語、統計卡與品牌資源 landing page；它應服務「選契約」與「進入契約 Studio」兩個工作。

## 本次修正

| 節點 | 錯誤版本 | 修正後 |
| --- | --- | --- |
| Design Systems 首頁 | 行銷式 hero、三段流程卡、品牌卡片牆 | 簡潔的搜尋、單選、清除、查看與套用 picker |
| 無品牌狀態 | 要求先建立品牌才能繼續 | 提供真實的 `Project default` 選項 |
| 套用時機 | 點卡片即跳頁，選擇與套用混在一起 | 先選取，再用 footer CTA 寫回 brief 並返回 Studio |
| 契約詳情 | DESIGN.md 大型 hero + 文件與側欄 | 左 Agent／契約脈絡、右 Design System／DESIGN.md 的 Studio shell |
| Project Studio | Design System 只藏在 composer | active project header 顯示目前契約並可直接開 picker |

## 實作檢查表

- [x] 依官方 README 六張 Product tour 圖重建 workflow。
- [x] 將 Design System 定義為 brief 的輸入契約，而非獨立產品區。
- [x] 將 `/design-systems` 改為 searchable single-select picker。
- [x] 支援 `Project default`、選取、搜尋、查看契約與套用回程。
- [x] 保留 `returnTo` + `briefId`，避免丟失 Project Studio context。
- [x] 將 detail 改為雙欄 Studio，提供 Design System／DESIGN.md tabs。
- [x] Project Studio header 顯示目前 Design System 並可返回 picker。
- [x] 更新 smoke contract，移除舊 landing-page 的 Capture／Contract／Apply 斷言。
- [x] TypeScript、lint、build、smoke 與瀏覽器 route/interaction 驗證。
- [ ] 在 Electron 內用真實 project root 建立、編輯並套用一份 DESIGN.md（需要桌面 IPC 實際檔案環境）。

## 視覺證據

官方：

- [Home](./official-home.png)
- [舊版建立流程中的 Design System picker](./official-entry-view.png)
- [Design System Studio](./official-design-system.png)
- [Prototype Studio](./official-studio-prototype.png)
- [Deck Studio](./official-studio-deck.png)
- [Image Studio](./official-studio-image.png)

本次實作：

- [修正後 picker](./04-corrected-picker.jpg)
- [Home 建立後進入 Project Studio](./05-project-studio.jpg)

## 驗證限制

瀏覽器 preview 沒有 Electron workspace API，因此可驗證 picker 路由、搜尋／單選語意、空狀態與 Studio 導覽，但無法在 preview 注入真實檔案系統中的 DESIGN.md。桌面 IPC 路徑由既有 smoke contract 覆蓋，仍保留一項真實桌面 E2E 待辦。
