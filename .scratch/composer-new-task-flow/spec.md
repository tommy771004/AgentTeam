# Composer New-Task Flow：新任務流程收斂

Status: 可交給代理

## Problem Statement

新任務的 composer 把開發者級決策前置：送出前要理解 Build/Plan 模式、五種 Loop Pattern、七種執行引擎。更糟的是兩個「死路」：釘選「排程／事件」loop 只在內部標記語意，真正的觸發規則要到 Automation 頁面另外建立，使用者以為設了排程、其實什麼都不會發生。DoD（Definition of Done）是產品最深的差異化——Goal-based run 會迭代到可量測的 DoD 滿足——但它在建立時不可見、不可編輯，只在結束後以「剩 N 個 gaps」出現，價值完全後置。此外，retry-with-overrides（調 maxIter/minConfidence/timeout 重跑）藏在 legacy 的裸殼失敗頁；`/execution`、`/success`、`/failed` 裸殼路由與四個死頁面檔案、樣板殘留 CSS 仍在；rewind 卻用原生 confirm 對話框，與全 app 的 styled sheet 不一致。

## Solution

讓 composer 對大多數人是一個輸入框，對進階使用者是完整駕駛艙：

1. 分層：基礎列（輸入、附件、聽寫、送出/停止、Approval Mode pill、Model pill）常駐；Loop Pattern、執行引擎、思考深度、Build/Plan 收進「進階」折疊區（記住偏好）。
2. 「排程／事件」從語意標記改為動作：點擊即以目前輸入的 objective 開啟建立排程／事件規則的表單（預填、chat 內完成），不再是死路。
3. DoD 建立時可見可編輯：Auto 判定為 Goal-based 或使用者釘 Goal 時，composer 上方浮出 auto-parse 的 DoD 卡，可編輯、可略過；使用者編輯的 DoD 隨 ingress snapshot 送出。
4. Retry-with-overrides 搬進 chat：在 run 的後續動作區加「調整參數重跑」，legacy 失敗頁退役。
5. 清除 legacy：裸殼路由移除（redirect 回首頁）、死頁面檔案刪除、樣板殘留 CSS 刪除；rewind 的原生 confirm 換成共用 styled confirm sheet。

## User Stories

1. 作為一般使用者，我想要預設只看到輸入框與少數幾顆按鈕，以便像用一般 chat app 一樣直接開始。
2. 作為進階使用者，我想要展開「進階」折疊區選 Loop Pattern／執行引擎／深度／Build-Plan，以便保留全部控制力。
3. 作為使用者，我想要折疊偏好被記住，以便每次開新 thread 不用重新展開。
4. 作為想排程的使用者，我想要輸入「每天早上整理 inbox」後點「排程」就直接建立 ScheduledJob，以便一句話完成自動化而不是踩到死路。
5. 作為想設事件的使用者，我想要點「事件」時進入事件規則建立（預填來源與關鍵字建議），以便 Proactive 觸發有明確落點。
6. 作為使用者，我想要從 composer 建立的排程出現在 Automation 頁與清單中，以便兩處狀態一致。
7. 作為 Goal-based 使用者，我想要送出前看到 auto-parse 的 DoD，以便在任務開跑前修正驗收標準。
8. 作為 Goal-based 使用者，我想要直接編輯 DoD 文字後再送出，以便 DoD 反映我的真實驗收條件。
9. 作為 Turn-based 使用者，我想要簡單任務不出現 DoD 卡，以便輕量互動不被打斷。
10. 作為使用者，我想要 DoD 卡顯示「Auto 判定為 Goal-based」的原因一句話，以便理解為什麼跳出這張卡。
11. 作為遇到失敗 run 的使用者，我想要在 chat 內直接調整 maxIter／minConfidence／timeout 重跑，以便不用去 legacy 頁面。
12. 作為使用者，我想要「Continue Goal／Continue Turn」與「調整參數重跑」在同一個動作區，以便後續處理一目了然。
13. 作為會 rewind 的使用者，我想要確認對話框與全 app 視覺一致，以便操作體驗統一。
14. 作為開發者，我想要裸殼路由與死頁面檔案被移除，以便維護面縮小、_dead code 歸零。
15. 作為透過舊連結進來的使用者，我想要 `/execution` 等舊路由 redirect 回首頁，以便升級後不撞白屏。
16. 作為鍵盤使用者，我想要 Tab 切 Build/Plan 與摺疊區操作都有 focus 樣式，以便純鍵盤完成設定。

## Implementation Decisions

- Composer 分層只是 UI 摺疊：所有既有選項語義不變、預設值不變（Auto loop、builtin runner）；「進階」展開狀態存 UI 偏好（per-app，不 per-thread）。
- 「排程／事件」tile 改為導航動作：點擊時以 composer 現有文字為 objective 預填，開啟建立表單（modal sheet，chat 內完成）；建立成功回填系統訊息與 job 連結。Composer 不再送出帶 Time/Proactive 語意的 run——這與既有 ADR-0026／觸發證據模型一致（Time/Proactive 只能由 claimed ScheduledJob snapshot 或 event evidence 進入）。
- DoD 預覽：ingress snapshot 新增可選的「使用者編輯 DoD」欄位；缺省時行完全不變（沿用 auto-parse）。Parse/classify 流程不變，使用者 DoD 只覆寫 DoD 文本，不影響 loop 判定。coordinator 維持薄 ingress（ADR-0026）。
- Retry-in-chat：將 legacy 失敗頁的參數覆寫重跑邏輯移轉為 run 後續動作區的 popover；重跑走既有 Task run 生命週期（新 runId、journal 記錄來源為 retry，ADR-0040）。
- Legacy 清理：`/execution`、`/success`、`/failed` 路由改 redirect 至首頁；四個已不被路由引用的死頁面檔案刪除；Vite 樣板殘留的 root 樣式檔內容刪除。redirect 相容至少保留一個版本週期。
- 共用 ConfirmSheet 元件：取代 rewind 的原生 confirm；文案與視覺沿用現有 styled sheet 規範。
- 執行引擎與 Approval Mode 的能力標示（「外部 CLI 執行」、DoD 未驗證標章）語義不動。

## Testing Decisions

- 好的測試只驗外部行為：ingress snapshot 是否正確攜帶使用者編輯的 DoD、tile 點擊產生的預填 payload、retry 參數是否進入新 run 的請求。
- smoke（純邏輯）：ingress snapshot 帶使用者 DoD（含缺省回退）；排程/事件 tile 的 payload 組裝；redirect 對照表；retry 參數白名單。
- 元件測試（vitest + testing-library）：折疊互動與偏好持久化、DoD 卡編輯同步與略過、retry popover 參數、ConfirmSheet 取代原生 confirm 的呼叫點。
- 手動驗證：legacy 路由 redirect、slash 導航指令回歸、Build/Plan Tab 切換 focus。
- Prior art：smoke scripts 對 coordinator ingress 與 scheduler/event 的既有覆蓋模式。

## Out of Scope

- Automation 建立表單的重設計與「對話中一鍵建立建議卡」（見 `automation-one-click` spec；本 spec 只鋪 tile→表單的預填通道）。
- DoD scorecard 與驗證報告（見 `dod-verified-reports` spec）。
- 設定頁重構（見 `settings-registry-restructure` spec）。
- DoD 的 LLM 精煉策略調整（沿用現有 parser 行為）。

## Further Notes

- 建議執行順序：在 `first-run-honesty` 之後（共用其引入的元件測試 runner）。
- 與 pi-core-migration 銜接：DoD 欄位與 retry 來源標記屬 Orchestration Extension 的 Task run 語義，實作時以 Pi Host journal 欄位落地，不在 renderer 另存。
- 裸殼頁退役後，`/failed` 的歷史連結（Handoff 匯出文件可能引用）依賴 redirect 相容。
