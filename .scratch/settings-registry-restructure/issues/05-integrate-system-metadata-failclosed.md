# 05 — 整合與系統群組宣告，關閉待辦清單

**What to build:** Git、Webhook、訊息閘道、MCP 伺服器、外掛 OAuth、安全更新、匯出匯入完成宣告，於是二十節全部到齊。這一票收尾把過渡期的待辦清單清空，fail-closed 檢查從此真正生效：任何人新增一個設定欄位卻沒宣告 tier／關鍵字／節／錨點，檢查就會失敗。匯出匯入的遮敏行為一個字都不能變。

**Blocked by:** 03, 04

**Status:** resolved

- [x] 七節所有欄位完成宣告
- [x] 待辦清單清空；刻意排除的非 UI 欄位各自附上理由
- [x] 蓄意加一個未宣告欄位時 fail-closed 檢查會失敗（以測試證明，不是口頭保證）
- [x] 匯出匯入的遮敏行為與對話框完全不變
- [x] webhook token 等敏感欄位仍以遮蔽方式呈現

## Answer

Git、Webhook、訊息閘道、MCP 共 16 個 key 完成宣告並全部接上渲染錨點，`PENDING_SETTINGS_KEYS` 清空為 `[]`，並在註解寫明「往這裡加東西等於把檢查關掉」。最終分布：81 個 settings key = 已宣告 73 ＋ 非 UI 8（各附理由）＋ 待辦 0。

tier：連線類開關留 basic（啟用 Webhook／Telegram／MCP）；埠號、token、白名單、自動執行、回覆結果、Git 全部收進 advanced——敏感或少動的東西不該擋在一般使用者面前。

fail-closed 以兩條規則證明，不是口頭保證：
- 「過渡期待辦清單已清空」——`PENDING_SETTINGS_KEYS` 必須恆為空陣列
- 「蓄意加一個未宣告欄位時，覆蓋率檢查真的會失敗」——模擬有人在 `LlmSettings` 加了 key 卻沒宣告，斷言它會被抓出來

安全語義未動：`settingsExport.ts` 與 `settingsStore.ts` 零 diff，匯出匯入的遮敏提示與流程完全不變；`webhookToken`、`telegramBotToken`、`apiKey` 仍以 password／遮蔽輸入呈現，registry 只描述呈現與可發現性，不碰值。

驗證：`smoke-settings-registry` 20 項、`npm run build` BUILD_EXIT=0、`npm test` 93 passed、`oxlint` 0 errors。
