# 07 — 工具自己宣告呈現方式，產出檔案不再用正則猜

**What to build:** 一個指令看起來像終端機、一次改檔看起來像 diff、一次搜尋看起來像搜尋結果 —— 而且這件事由工具自己在定義處講一次，不由中央的檔名正則猜。同時，一次 run 產出的檔案清單改由「工具宣告自己改了什麼」推導：模型忘了在結語提到的檔案照樣列出來，只讀不改的檔案不會混進去。

型別骨架（來自 spec 的決策，僅保留決定性的部分）：

```ts
type ToolPresentation =
  | { card: 'generic'; title: string; kind?: 'read' | 'search' | 'edit'; content?: string; locations?: ToolLocation[] }
  | { card: 'terminal'; title: string; description?: string; cwd?: string }
  | { card: 'diff'; title: string; diffs: Array<{ path: string; oldText: string | null; newText: string }>; locations?: ToolLocation[] }
  | { card: 'search'; shape: 'matches' | 'paths'; truncated: boolean }
```

`presentCall(args)` 與 `presentResult(args, result)` 都必須是輸入的純函式 —— 它們會在帳本重播時再跑一次。

**Blocked by:** 06

**Status:** 可交給代理

- [ ] 工具定義新增選填的 `presentCall` / `presentResult` 與 `locations`；兩者為 replay-pure：無 I/O、不讀 session、不用時鐘或亂數
- [ ] 參考工具接上：改檔類 → `diff`、shell → `terminal`、搜尋類 → `search`、其餘 → `generic`
- [ ] 未宣告呈現的工具安全退回通用卡；畸形或較舊的已記錄參數回傳 undefined 走通用卡，**不得**丟例外
- [ ] 產出檔案由 `diff` 卡與 `locations` 推導；只讀與失敗的呼叫不貢獻；同一檔案每回合只出現一次
- [ ] 中央的檔名正則（`/write|edit|create|patch/i`）與檔案 map 啟發式刪除
- [ ] UI-only 的格式（console 圍欄、渲染後的 diff、相對化路徑）不得進入模型可見結果
- [ ] 新增 ADR：呈現是工具定義的一部分，且必須 replay-pure
- [ ] Seam 2 smoke：各卡片型別以 fixture 斷言；產出檔案清單含「模型未提及但確實改過」的檔案
