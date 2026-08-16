# Full Localization：完整在地化（i18n）

Status: 可交給代理

## Problem Statement

UI 目前 100% hardcode 繁體中文，而且連帶鎖死了周邊能力：語音聽寫固定 `zh-TW`、Electron 原生選單與系統通知是 zh-TW、slash 指令描述與 agent 回饋系統訊息也是。非中文使用者被完全鎖在門外。產品定位是「本地優先、隱私優先、模型自由」的桌面 agent——要走出中文市場（尤其隱私敏感的國際使用者與企業），i18n 是前置條件，不是加分項。另外 light theme 目前依賴對 class 名稱的廣域 CSS override hack，字串與樣式重整時應一併清償。

## Solution

建立字串抽取層與語言檔，讓介面語言成為基本設定：

1. 抽取層：輕量 `t(key)` 模式，zh-TW 為 source of truth 語言檔（先把現行字串原樣入檔，零翻譯損失），en 為第一個完整翻譯；框架支援任意語言擴充。
2. 介面語言設定：外觀節新增「語言」（跟隨系統／zh-TW／en…），即時切換免重啟。
3. 全殼層本地化：頁面與元件字串、slash 指令標題與描述、agent 系統回饋 bubbles、錯誤訊息、設定 registry 的說明文字、Electron 原生選單、OS 通知、匯出報告的殼層標題。
4. 能力跟隨：聽寫語言映射介面語言（可手動覆寫）；日期/數字格式跟隨 locale。
5. 防退化：lint 規則擋新增 hardcode 字串進元件（允許例外清單）；語言檔 key 對帳進 smoke，fail-closed。
6. 順帶清償：light theme 的 class-name hack 以明確語義 class 重整取代。

## User Stories

1. 作為英文使用者，我想要把介面切成英文，以便不依賴中文也能操作全部功能。
2. 作為使用者，我想要語言設定「跟隨系統」自動匹配 OS 語言，以便換機器不用重設。
3. 作為使用者，我想要切換語言即時生效不重啟，以便嘗試不同語言零成本。
4. 作為使用者，我想要聽寫語言跟著介面語言（可手動覆寫），以便英文介面下聽寫不是中文辨識。
5. 作為使用者，我想要原生選單、右鍵選單與 OS 通知同步介面語言，以便整機體驗一致。
6. 作為使用者，我想要 slash 指令的標題與描述雙語，以便指令面板在英文介面下可讀。
7. 作為使用者，我想要 agent 的系統回饋訊息（排隊、核准、錯誤）本地化，以便狀態看得懂。
8. 作為繁中使用者，我想要 zh-TW 體驗與現在完全相同，以便升級零感知差異。
9. 作為開發者，我想要漏翻的 key 自動 fallback zh-TW 並在 smoke 報清單，以便缺翻不炸畫面也不silent。
10. 作為開發者，我想要 lint 擋住新的 hardcode 字串，以防 i18n 腐化。
11. 作為開發者，我想要 key 按頁面／元件分域命名，以便語言檔可維護。
12. 作為無障礙使用者，我想要字級、reduced-motion 與語言設定正交，以便組合不互相干擾。
13. 作為日期敏感的使用者，我想要時間與數字格式跟隨 locale，以便 08/09 不再歧義。
14. 作為企業採購者，我想要介面語言可由設定包匯出匯入，以便團隊統一部署。
15. 作為 light theme 使用者，我想要主題樣式不再依賴 class 名稱 hack，以便淺色模式視覺穩定。

## Implementation Decisions

- 抽取層採輕量自帶 `t(key)` + 型別安全 key（不做重型框架）；zh-TW 語言檔以現行字串原樣遷入為第一步（視覺零 diff），en 翻譯第二批。
- 語言設定遵循設定三處編輯慣例（interface 型別 + 預設值 + 設定 UI），並進 typed registry，tier 為 basic、所屬外觀節（銜接 `settings-registry-restructure` spec）。
- Electron main process 的選單與通知：依語言設定重建（語言變更事件跨 process 傳播），renderer 不擁有選單字串。
- 聽寫映射表：介面語言 → 聽寫語言 tag 的純資料表 + 手動覆寫欄位。
- 模型輸出內容（agent 回覆、報告正文）不翻譯——只本地化「殼」：UI 字串、系統訊息、選單、通知、報告標題與固定欄位名。
- key 對帳：掃描抽取層使用點 ↔ 語言檔 entries，雙向缺漏都 fail（smoke）；zh-TW 檔為基準，en 缺 key 時 fallback zh-TW 並輸出報表。
- lint：新增規則（或 oxlint 設定）禁止 JSX 中直接書寫中文字面值與常見英文字串常數，例外清單明示維護。
- light theme 清理：移除依 class 名稱模式匹配的廣域 override，改為元件掛明確 theme 語義 class；視覺驗收以兩主題截圖比對。
- 匯出匯入：語言設定隨設定包攜帶（既有遮敏規則不變）。

## Testing Decisions

- 好的測試只驗外部行為：切換語言後渲染的實際字串、fallback 行為、映射表正確性；不測語言檔結構細節。
- smoke（純邏輯）：key 對帳（使用點 ↔ zh-TW 檔 ↔ en 檔，雙向 fail-closed）、聽寫映射表完整性、locale 格式化函數（日期/數字各語系 golden）。
- 元件測試（vitest + testing-library）：語言切換即時渲染、fallback 顯示、系統訊息在地化。
- 手動驗證：Electron 選單/通知實機切換、兩主題視覺比對。
- Prior art：smoke 的 fail-closed 對帳模式（registry metadata 完整性檢查同型）。

## Out of Scope

- 模型輸出（agent 回覆內容）的翻譯。
- RTL（右到左）版面。
- 行銷網站與文件翻譯。
- 語言自動偵測（僅跟隨 OS 設定）。
- 繁中以外的第三語言檔（框架支援，檔案後補）。

## Further Notes

- **建議最後執行**：01–05 會新增/變動大量 UI 字串，先抽換會造成重複翻譯與 key churn。
- 執行前檢查：01–05 收斂後做一次全 UI 字串盤點再開檔，避免漏抽。
- 與 `settings-registry-restructure` 的相依：registry 說明文字的 key 化在本 spec 一併處理（registry 結構已預留）。
- zh-TW 原樣遷入的第一步可單獨出票先行（視覺零 diff、風險最低），en 翻譯後續。
