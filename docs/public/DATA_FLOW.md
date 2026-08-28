# AgentStudio 資料流說明（Data Flow）

> 狀態：**Draft 草稿** — 公開前需審閱。

## 總覽

```
[你的裝置]
  Renderer UI ──IPC 白名單──▶ Electron main
      │                          │
      │ localStorage/檔案         │ userData 檔案（設定、排程、執行日誌、
      │ （UI 狀態）               │  Hermes 技能/記憶、加密憑證 vault）
      ▼                          ▼
  ──────────────── 全部留在本機 ────────────────
                                 │
             （只有你設定的端點才會收到資料）
                                 ▼
   你設定的 LLM API ・ 你安裝的 MCP servers ・ 你授權的連接器
```

## 會離開裝置的資料

| 流向 | 內容 | 觸發條件 |
| --- | --- | --- |
| 你設定的 LLM 端點 | 對話內容、工具結果摘要、注入的專案文件（AGENTS.md/CLAUDE.md） | 你執行任務時 |
| 你安裝的 MCP server / 連接器 | 該工具呼叫的參數（含 main 端解析的 `{{secret:key}}`） | 代理呼叫該工具且通過授權時 |
| 更新伺服器 | 版本查詢（目前版本、平台、架構） | 檢查更新時 |

## 不會離開裝置的資料

- 憑證原文（vault 僅 main process 可讀；`{{secret:key}}` 於 main 端注入）
- 執行歷史、排程定義、Hermes 技能與記憶（除非你自己匯出）
- 我們**不收集**遙測、使用分析或對話內容 — 沒有我們自營的資料後端

## 進入裝置的資料

- Webhook / Telegram gateway：你自行啟用後，本機伺服器才會接收事件
- 更新通道：簽章驗證通過的 manifest 與安裝檔

## 匯出

「匯出設定包」會先以 pattern 遮罩所有金鑰/token/secret，並在下載前
說明檔內仍含排程、事件與 Hermes 記憶等可能敏感的內容，經你確認才產生檔案。
