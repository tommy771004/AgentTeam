# Subscription Surface Hardening — 訂閱設定面誠實性與模組衛生

Status: 可交給代理
Effort: subscription-surface-hardening
Origin: 2026-08-26 三輪 two-axis code review（Standards／Spec 軸）累積發現之修復 effort。接縫確認提問未獲回覆，依 skill 預設採建議案（零新接縫）。

## Problem Statement

從使用者视角：Settings 的訂閱連線面會說謊與停滯——新 profile 上看到與事實不符的「API key is empty」（真正的狀況是沒有 Host）；解決了 provider 衝突之後畫面永遠不更新，使用者不知道修好了沒；離線時看不到任何可用的模型清單，也沒有任何「這是過期快取」的如實標示；文案裡還有異體字。

從維護者视角：同一份 model-row sanitize、同一份 catalog 載入 effect、同一份 provider 清單、同一個 protocol 版本號，各自存在兩份以上、僅靠註解維持同步——每一次改動都是漂移機會。usage 即時輪詢借用了 reattachment IPC 面，且晚到的資料有機會把已結束的 run 翻回進行中。

## Solution

一個誠實、會呼吸的訂閱設定面：

- 文案正確、分支順序正確——沒有 Host 就說沒有 Host；
- 衝突解決後，狀態與模型清單會刷新，fail-closed 癒合可以被看見；
- 離線或 Host 組裝失敗時，退回最後一份快取 catalog，並帶著醒目的「過期」標示——絕不冒充即時資料（ADR-0048：量到才報，沒量到就缺席）;
- 每一份共用邏輯只剩一個 owner：sanitize、provider 清單、catalog 載入、版本常數；
- usage 輪詢維持現有 attach 契約，但晚到寫入永遠不能復活終態 run。

## User Stories

1. As 一個剛完成安裝、尚未連上任何 Host 的使用者, I want Settings 如實告訴我「Pi Core Host 尚未就緒」而不是「API key is empty」, so that 我知道下一步是啟動 Host 而不是去填 key.
2. As 一個使用訂閱連線（無 apiKey）的使用者, I want 連線狀態頁的錯誤訊息反映真實原因, so that 我不被誤導去設定根本不需要的 API key.
3. As 在繁體中文環境使用的使用者, I want 所有介面文字使用標準繁體字形（訂閱而非訂閲）, so that 產品文案一致且可信.
4. As 一個剛在 CLI 登出以解決 provider 衝突的使用者, I want 回到 Settings 時看到狀態已刷新, so that 我能確認衝突真的解除了.
5. As 一個在兩個視窗間切換的使用者, I want Settings 的訂閱狀態不是 mount 時的一次性快照, so that 長時間開著的設定頁不會呈現過期事實.
6. As 一個離線中（或 Host 組裝 catalog 失敗）的使用者, I want 看到最後一份成功的模型清單並清楚標示「過期快取」, so that 我仍有參考資訊而不被誤導為即時資料.
7. As 一個首次使用、從未有過任何 catalog 的離線使用者, I want 看到誠實的「尚無可用目錄」與原因, so that 我知道沒有任何被發明的資料（fail-closed）.
8. As 一個審查程式碼的維護者, I want model-row sanitize 只有一個 owner, so that 兩處 guard chain 永遠不可能漂移.
9. As 一個審查程式碼的維護者, I want provider 合法清單只有一個定義, so that 新增訂閱 provider 時不用記得同步第二處.
10. As 一個審查程式碼的維護者, I want catalog 載入邏輯抽成一個 hook, so that 兩個 settings 元件不會各自演化出不同的載入行為.
11. As 一個審查程式碼的維護者, I want OAuth 同步三兄弟欄位打包成既有的 shape 型別傳遞, so that 新增第四個狀態欄位時只改一處.
12. As 一個要升級 protocol 的開發者, I want 版本號只有一個常數來源, so that supervisor、smoke、qualify 三處不會各自硬編出分歧.
13. As 一個在長對話中使用即時上下文用量的使用者, I want 用量數字持續更新但不閃爍其他區塊, so that 閱讀回答時不被視覺雜訊打斷（既有契約，保持不退化的驗收）.
14. As 一個 run 已結束的使用者, I want 晚到的輪詢資料不把已完成的 run 翻回「進行中」, so that 紀錄的終態可信.
15. As 一個維護 smoke gates 的維護者, I want 每個修復都有對應的防復發斷言, so that 這些發現不會在下個迭代悄悄回歸.
16. As 一個 AFK 代理, I want 每張票的驗收條件可直接由既有 smoke seam 驗證, so that 我不需人工判斷即可宣告完成.
17. As 一個追蹤 effort 狀態的維護者, I want INDEX.md 的每列都與 issue 檔案的 Status 一致, so that 排工決策基於真相.
18. As 一個關心 finalization exactly-once 語意的維護者, I want 「terminal finalization 不阻塞啟動」這個行為擁有自己的 ticket 記錄, so that 未來任何人改動啟動路徑時找得到它的理由與約束.

## Implementation Decisions

- **settingsStore 訊息衍生順序**：訂閱連線的診斷分支移到 apiKey 檢查之前；訂閱連線本就不攜帶 apiKey（Host 端早已剝除），因此「沒有 Host」必須先於「API key is empty」被判斷。文案修正為標準繁體「訂閱」。
- **useSubscriptionCatalog hook**：新增一個共享 hook 承載 catalog 載入 effect（兩個 settings 元件的唯一載入路徑），並提供手動 refresh 能力——衝突解決提示旁提供重新整理入口，且元件獲得焦點（visibilitychange/focus）時自動重查一次。介面：回傳 catalog、載入狀態、refresh()。
- **離線 catalog 後備**：Host 端每次成功組裝 catalog 時持久化最後一份（走既有的 main-process 設定持久化路徑，不新增儲存機制）；snapshot 組裝失敗或離線時改帶快取，並在 catalog 物件上加 `cachedAt`／`stale: true` 標示（型別擴充，保持 bounded 與無 credential 的既有保證）。Renderer 對 `stale` 如實渲染過期徽章＋時間；完全沒有快取時維持現行 `unavailable`＋reason，不發明資料。
- **sanitizeModelRow 單一 owner**：row sanitize（id 驗證＋label/contextWindow/reasoning 條件展開）收斂為 subscriptionCatalog 模組匯出的純函式；Host runtime view 與 catalog 投影都呼叫它。
- **provider 清單單一來源**：apiProviders 的 preset 表改為 import subscriptionCatalog 的訂閱 provider 清單，刪除僅靠註解鏡射的第二份定義。
- **OAuth sync shape**：piHostEntry 的 config 欄位與函式參數改用既有的 `PiOAuthSyncStatusShape` 型別打包傳遞，消除兩處手寫展開。
- **protocol 版本常數**：版本號由 protocol 模組匯出單一常數；supervisor 協商值、smoke 斷言、qualify 腳本全部 import，刪除三處字面值。
- **SettingsPage 重複運算式**：`isSubscriptionProviderPreset(apiProvider || 'custom')` 推導為單一 local boolean，六處引用改讀它。
- **usage 輪詢契約硬化**：refresher 寫回前複查該 run 是否仍在活躍集合；晚到的 poll 頁不得將 `active: false` 的 presentation 翻回 active、不得清空 draftText。attach-as-poll 的借用與 hidden-tab ≥3s 癒合取捨已在程式註解聲明，維持不變（不改道新 IPC）。
- **InlineRunPanel 用量隔離補完**：右欄的用量微縮文字比照主 feed 改由 memo leaf 自行訂閱，使 R1 的「其他區塊不因用量重繪」在兩個表面都成立。
- **Tracker 對帳**：為「terminal finalization 不阻塞啟動」在三 commit 中引入的行為補一張 owning ticket（掛 active-run-reattachment effort，記錄 claim lease＋ack gate 如何保住 exactly-once）；本 effort 各票 resolved 時同步更新 INDEX 列。

## Testing Decisions

- 好的測試只斷言外部行為：投影輸出、序列化後的 config 內容、store 衍生的訊息字串與順序、hook 回傳值；不斷言內部實作細節。
- 受測模組與所屬接縫（全部既有）：subscriptionCatalog 純投影（sanitize 去重後行為不變、stale/cachedAt 標示語意、無 credential 保證）；protocol 握手（版本常數單一來源、v2/v3/v4 接受矩陣不變）；settingsStore 訊息衍生（無 Host 先於無 key；正字）；refresher 防復發 guard（終態 presentation 不被晚到頁翻轉）；UI drift guard 以 repo 慣用的 source-text 斷言釘住「訂閱分支先於 apiKey 分支」「兩個 settings 元件皆經由共享 hook 載入」。
- Prior art：smoke-subscription-catalog.mts（純投影＋序列化防護）、smoke-pi-host-protocol.mts（握手與版本）、smoke-trajectory-panel-mounted.mts（mount smoke）、smoke-composer-approval-handoff.mts（source-text drift guard 指向真 owner）。

## Out of Scope

- 不為 usage 輪詢新增專用 IPC 面（繼續契約內使用 runs.attach）。
- 不實作 Host 啟動後的 catalog 週期性自動重組（只做「啟動組裝失敗→帶 stale 快取」）。
- 不動 connector vault、runTask 入口、agent/loop/ 相關邊界。
- 不重構 SettingsPage 訂閱區塊以外的任何區域。
- 不改變 protocol 版本語意或接受矩陣（v2/v3 接受、v4 現行、v1 拒絕）。

## Further Notes

- 發現來源：2026-08-26 三輪 two-axis review（v1 對 5e60e00、v2 對 ce68392、v3 對 6419de9）。v3 已確認乾淨的項目（INDEX 列真實性、qualify 不進 smoke chain、v4 時序、R2 文字移除）不在本 effort 範圍。
- 「離線快取 catalog」原屬 cli-subscription-pi-loop effort 的 spec 承諾（L26/story 9）但無票認領；本 effort 的 02 號票即為其歸宿，完成後應在原 effort 的 PROGRESS 註記指向。
- 依賴：03（模組衛生）與 01（誠實性）互不相依可並行；02 依賴 03 的 sanitize owner 就位；04 獨立；05 最後收口。
