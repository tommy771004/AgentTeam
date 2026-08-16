# DoD Verified Reports：DoD 產品化與可分享 Run 報告

Status: 可交給代理

## Problem Statement

「可驗證的完成」是本產品相對於 ChatGPT Desktop 最深的差異化：Goal-based Task run 會迭代到可量測的 DoD 滿足才宣告成功，而且整個過程（工具呼叫、Capability Packs、檔案差異、迭代歷程）都被完整 journal。但這件事對外完全不可見——DoD 只在 run 結束後以「剩 N 個 gaps」的文字出現；執行證據只活在 app 內的 debug 型面板；沒有任何輸出物能回答「為什麼這個任務算完成」。競品的 agent「done」是模型自稱；本產品的「done」是量測出來的，卻沒有計分卡、沒有報告、沒有可分享的形式。對需要審計、需要向同事證明、需要留檔的使用者，這個護城河等於不存在。

## Solution

把量測到的完成變成看得見、帶得走的資產：

1. **DoD Scorecard**：run 結束時計分卡呈現於 chat 內 run 摘要位置——各 DoD 項目的通過／未驗證狀態、迭代次數與收斂歷程、證據連結；外部 CLI run 固定顯示「未執行內建 DoD 驗證」的誠實標示。
2. **驗證完成報告**：從 run journal 渲染可分享的文件（Markdown 與 HTML 同源），內容含 objective、DoD 與逐項判定、執行軌跡摘要（工具呼叫、檔案變更、sub-agents）、外部資料決策紀錄；失敗／部分完成的 run 也有報告（gap 清單與下一步建議）。
3. **Run transcript 匯出**：把 chat 內的分組執行紀錄（Context Gathered、工具 chips、diff 摘要）匯出為美觀、可離線閱讀的文件，供留存與重播審視。
4. **隱私內建**：報告渲染沿用 Protected Data 排除與「決策不含內容」原則，敏感內容不進輸出物。

## User Stories

1. 作為使用者，我想要 run 結束時看到一張 DoD 計分卡（各項通過／未驗證），以便一眼判斷「完成」的成色。
2. 作為使用者，我想要計分卡顯示迭代收斂歷程（每輪後剩餘 gaps），以便理解 agent 是怎麼逼近目標的。
3. 作為使用者，我想要每個 DoD 項目連到支撐它的證據（工具呼叫／輸出摘錄），以便驗證不是自說自話。
4. 作為使用者，我想要把驗證完成報告匯出成檔案分享給同事，以便對方不裝 app 也能審視。
5. 作為使用者，我想要報告同時有 Markdown 與 HTML 版本，以便貼 wiki 或直接開瀏覽器。
6. 作為失敗 run 的使用者，我想要報告列出未達成的 DoD gaps 與下一步建議，以便接手處理或重跑。
7. 作為使用外部 CLI 的使用者，我想要報告明確標示「外部 CLI 執行，未執行內建 DoD 驗證／iterate」，以便不誤判完成度。
8. 作為重跑後的使用者，我想要新 run 的報告連結舊 run（重跑來源），以便追溯任務史。
9. 作為重視隱私的使用者，我想要報告自動排除 Protected Data、敏感 token 遮敏，以便分享不洩漏。
10. 作為企業使用者，我想要報告包含外部資料決策紀錄（哪些內容被送出到哪個 provider），以便符合審計要求。
11. 作為使用者，我想要匯出整段執行 transcript（分組的 context／工具／diff 摘要），以便離線留存完整過程。
12. 作為使用者，我想要從 run 摘要卡與 Archive 兩處都能匯出報告，以便事後隨時補抓。
13. 作為 Timeline 使用者，我想要 background delegate 的 run 也有報告，以便背景工作可審。
14. 作為使用者，我想要計分卡在 DoD 全數通過時有明確的「已驗證完成」視覺狀態，以便與「只是跑完」區別。
15. 作為開發者，我想要報告渲染是純函數（journal → 文件），以便測試與重構成本低。

## Implementation Decisions

- 資料來源單一：DoD 判定結果與執行軌跡全部讀自既有 run journal 與 Archive（ADR-0040），不新建 store、不做第二份真相。
- 報告 renderer 為純函數：輸入 journal 摘要 + run metadata，輸出文件模型；Markdown 與 HTML 是同一文件模型的兩個序列化端。
- 能力歸屬（ADR-0031）：報告產製屬 Orchestration Extension 的輸出能力；Electron UI 只提供匯出觸發與檔案落地（存檔對話框、預設檔名含 runId 與日期）。
- 誠實契約維持：外部 CLI run 的報告與計分卡固定帶既有外部執行標章語義，絕不呈現為 DoD 已驗證。
- 遮敏規則沿用：報告渲染套用與 Outbound Data Gate 同源的 Protected Data 排除與證據遮蔽原則（決議紀錄不含內容）；report 產製在本地完成，不經網路。
- 計分卡元件嵌入既有 run 摘要卡位置，chat 內即見；「已驗證完成」與「執行完畢（未驗證）」為兩種明確狀態。
- 重跑關聯：retry／continue 產生的新 run 在報告 metadata 記錄來源 runId，形成可追溯鏈。
- 匯出入口兩處：run 摘要卡動作區、Archive 的 run 詳情。

## Testing Decisions

- 好的測試只驗外部行為：給定 fixture journal → 期望的文件模型結構（DoD 項判定、迭代歷程、遮敏、CLI 標章），不測渲染內部。
- smoke（純邏輯）：renderer 純函數的完整覆蓋——成功 run、部分 gap run、外部 CLI run、含 Protected Data 的 fixture（驗證遮蔽）、retry 來源鏈；文件模型 → Markdown／HTML 序列化的穩定性（golden 檔）。
- 元件測試（vitest + testing-library）：計分卡渲染（通過／未驗證／已驗證完成狀態）、匯出按鈕與檔名組裝。
- 手動驗證：匯出檔在瀏覽器/編輯器開啟的版式、長 run 的可讀性。
- Prior art：smoke scripts 的 fixture 驅動純邏輯模式（capability／compaction）。

## Out of Scope

- 報告的雲端分享連結與線上渲染（本地檔案為限）。
- 客製報告範本／品牌。
- DoD 建立時輸入（見 `composer-new-task-flow` spec）。
- PDF 序列化（Markdown／HTML 先行）。
- 自動化彙總報告（多 run 統計）。

## Further Notes

- 建議執行順序：在 `composer-new-task-flow` 之後（其「使用者編輯 DoD」欄位會讓報告的 DoD 文本更有意義）。
- 與 pi-core-migration 銜接：journal 欄位最終由 Pi Host 持有（ADR-0040），renderer 的文件模型從 Host projection 消費即可；純函數 renderer 不受 migration 影響。
- 這是「把護城河變成可感知價值」的核心 spec——優先級建議高於 05／06，僅次於 01 的誠實性修復。
