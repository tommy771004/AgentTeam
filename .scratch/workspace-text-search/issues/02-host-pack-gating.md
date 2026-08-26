# 02 — Host 檢索工具＋gating（唯一新測試接縫）

**What to build:** 開關 ON 時，Pi 迴圈模型取得 `workspace_grep` / `workspace_glob` 兩個唯讀工具（Host Extension Pack 工具，重用既有工作區搜尋 helper）；OFF 時三態全滅：不進目錄、tool_search 搜不到、執行（含 `run_code` 巢狀）回結構化失敗並指向設定位置。本票是整個 effort 唯一的新測試接縫。

**Blocked by:** 01 — 「工作區文字檢索」設定開關（治理根）（gating 需要設定欄位存在）

**Status:** resolved

- [x] 工具進入 pack 目錄並宣告 owning capability（漸進式揭露機制原樣適用）
- [x] OFF：目錄缺席／tool_search 不可見／execute 與巢狀皆誠實拒絕（訊息說明未啟用，不假裝零結果）
- [x] ON：fixture 目錄樹上匹配/glob/截斷/skip（.git、node_modules、超大檔）正確，越界路徑回 typed 失敗
- [x] 單一 pack 層級 smoke 以設定快照參數化涵蓋上述全部（prior art：pack 工具煙霧＋workspace-search fixture 模式），掛進 smoke 主鏈

## Closure evidence

`npm run smoke:workspace-text-search` 19/19，涵蓋 OFF／ON、catalog／capability／直接執行、缺 workspace、越界、skip、截斷、超大檔、run snapshot，以及由實際模型 tool call 進入 `run_code` 的巢狀 Host 重入；該 smoke 已掛主 `npm run smoke` 鏈。
