# 03 — 工具目錄是「自動探索」與「自己安裝」的聯集，不可用要說原因

**What to build:** 使用者打開設定看到的工具清單，就是實際可用的工具清單。每一筆要嘛是 Host 自動探索到的（builtin pack、Pi resource loader），要嘛是使用者自己裝的（MCP server、啟用的 extension pack），兩種來源併在同一份清單裡。某一筆這次不可用時，它自己說原因 —— 而不是整批變灰。

今天設定頁讀的是 renderer 的 `toolDefinitions.ts`，那是一份與實際執行完全無關的清單：48 個工具列在那裡，production 只有 6 個叫得動，而且不會報錯。使用者唯一觀察得到的是「agent 好像變笨了」。

**這張票不做 Marketplace 安裝流程**（spec Out of Scope）。它只讓「使用者已經裝好的東西」出現在同一份目錄裡，讀既有的 `extensions/list`。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] 設定頁的工具清單由 Host catalog 投影而來，不再讀 `toolDefinitions.ts`
- [ ] 清單同時涵蓋 Host 自動探索的工具與使用者已安裝來源提供的工具，每筆標示來源
- [ ] 每筆帶自己的可用狀態；不可用時附可讀的原因（尚未由 Host 提供 / 被 active tools 停用 / 來源未啟用）
- [ ] 沒有「整批不可用」的呈現：pack 還在陸續落地期間，已落地與未落地的項目並列
- [ ] Host 無法產生目錄時 fail closed：明確告知目錄不可用，**不得**回退到 renderer 目錄
- [ ] 測試在單一接縫：`tools/list` 與 `extensions/list` 的投影結果，含 fail-closed 路徑
