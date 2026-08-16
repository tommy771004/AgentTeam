# Automation One-Click：自動化最後一哩

Status: 可交給代理

## Problem Statement

自動化引擎（ScheduledJob 排程、本機 Webhook、Telegram 閘道、事件規則與證據比對、FIFO 佇列與重排、背景委派）在能力上遠超競品的 Tasks（限額的雲端鬧鐘），但「從意圖到啟用」的最後一哩是斷的：使用者在對話裡說「每天早上八點幫我整理」，系統只產生一張建議卡；接受之後還要自己到 Automation 頁面完成建立。建議卡也不是總在對話現場出現，功能要靠探索才找得到。結果是最強的護城河之一（事件驅動、本地執行、無限額）沒有對應的順手入口。安全模型（絕不從對話文字直接啟動 Time/Proactive run、必須明示同意、觸發需要 claimed snapshot 或布林事件證據）是刻意設計且必須完整保留——本 spec 補的是「同意之後的路要短」，不是放寬同意。

## Solution

把建議→建立收斂到對話現場、一键完成：

1. 對話中偵測到排程／事件意圖時，直接在 chat 內渲染建議卡（預填 objective、建議的排程時間或事件條件、可編輯）。
2. 卡片上「建立」一鍵完成 ScheduledJob／事件規則的建立（與 Automation 頁共用同一條建立路徑，不旁路），成功後卡片變為「已啟用」狀態並附管理連結。
3. 全程 consent-first：沒有點「建立」之前什麼都不會發生；重複意圖降級為輕提示（同一 objective 已有活躍 job 時不再推卡）。
4. composer 的「排程／事件」快速動作（見 `composer-new-task-flow` spec 鋪的預填通道）與本卡片共用建立表單組件。

## User Stories

1. 作為使用者，我想要說「每天早上八點整理 inbox」時 chat 內出現可編輯的排程建議卡，以便當場完成設定不用跳頁。
2. 作為使用者，我想要在卡上改建議時間（每天 08:00 → 09:30）再建立，以便排程符合我的作息。
3. 作為使用者，我想要點「建立」後卡片變成已啟用狀態並附 Automation 連結，以便確認真的生效並能管理。
4. 作為使用者，我想要事件意圖（「當 webhook 收到 CI 失敗就…」）同樣出現建議卡，以便 Proactive 規則也有順手入口。
5. 作為使用者，我想要建議卡附一句話說明「排程只在 app 開啟或常駐時觸發」，以便對觸發條件有正確預期。
6. 作為重視安全的使用者，我想要「不點建立就什麼都不會發生」，以便自動化永遠出於明示同意。
7. 作為重視安全的使用者，我想要對話文字永遠不會直接啟動 Time/Proactive run，以便既有的觸發證據模型不被繞過。
8. 作為重複提出相同意圖的使用者，我想要系統偵測到已有活躍 job 時只輕提示不重複推卡，以便不被疲勞轟炸。
9. 作為使用者，我想要拒絕建議後一段時間內同 objective 不再建議，以便拒絕是有記憶的。
10. 作為使用者，我想要從卡片建立的 job 出現在 Automation 頁與執行佇列 strip，以便兩處狀態一致。
11. 作為忙碌中的使用者，我想要卡片顯示目前佇列狀態（待跑 n/24），以便建立前知道系統負載。
12. 作為使用者，我想要背景委派任務的完成通知附「轉為排程」的動作，以便一次性工作成功後一鍵常態化。
13. 作為使用者，我想要建議卡支援指定執行引擎與 Skills（沿用排程表單既有欄位），以便卡片不是閹割版。
14. 作為開發者，我想要「意圖→建議→建立」的每一步都是純資料轉換，以便 smoke 完整覆蓋。

## Implementation Decisions

- 建議產生維持既有 auto-classifier 語義：對話分類只產生 Turn/Goal；cron/事件字樣只產生 AutomationSuggestion，絕不直接 run。本 spec 不改觸發安全模型（Time-based 需 claimed ScheduledJob snapshot、Proactive 需布林事件證據，fail-closed）。
- 卡片「建立」呼叫 Automation Extension 的 job／rule 建立介面——與 Automation 頁面完全同一條路徑與驗證（含 interval 下限警告、專案綁定）；卡片是另一個殼，不是旁路 API。
- 建立成功：卡片轉為已啟用狀態（job 連結、下次觸發時間）；journal 記錄來源為 chat suggestion（ADR-0040 的來源欄位），供日後統計建議轉換率。
- 建立表單組件共用：Automation 頁、chat 建議卡、composer 快速動作三個殼共用同一表單元件（輸入：預填 objective；輸出：job/rule 建立請求）。
- 時間建議解析（「每天早上」→ 08:00 等）沿用既有建議邏輯，卡片內可改；事件條件建議（來源/關鍵字）同樣可編輯。
- 重複抑制：同一 objective 存在活躍（enabled）job 時降級為一句系統提示；明確拒絕後設冷卻（預設 7 天，硬編碼常數）。
- ADR-0026/0040：建立後的執行仍走 taskRunCoordinator ingress 與既有 journal/queue 模型，本 spec 零執行路徑變更。

## Testing Decisions

- 好的測試只驗外部行為：意圖文字 → 建議 payload、建立請求 → job 狀態、抑制與冷卻判定；不測卡片內部狀態。
- smoke（純邏輯）：意圖→建議 payload 轉換（排程/事件/ambiguous 各案）、建立 idempotency（不重複建立）、活躍 job 抑制判定、拒絕冷卻判定、journal 來源欄位標記。
- 元件測試（vitest + testing-library）：卡片互動（改時間、編輯條件、建立、拒絕）、已啟用狀態與連結、佇列狀態顯示。
- 手動驗證：卡片建立後 Automation 頁同步、實際排程觸發走一次端到端。
- Prior art：smoke scripts 的 event matching 與 scheduler 數學既有覆蓋。

## Out of Scope

- 新觸發來源（email、其他 IM）。
- Automation 頁面本身的資訊架構重設計。
- 自動化跨裝置/雲同步（本地為限）。
- 對話分類器模型更換（沿用現有 auto-classifier）。

## Further Notes

- 建議執行順序：在 `composer-new-task-flow` 之後（共用建立表單組件與預填通道）、與 `dod-verified-reports` 平行可做。
- 與 pi-core-migration 銜接：Automation Extension 的建立介面最終落在 Pi Host 側（ADR-0040 的 journal 模型），卡片只是 UI 殼；實作時以 Extension 介面為界，避免 renderer 直接触碰 journal 寫入。
