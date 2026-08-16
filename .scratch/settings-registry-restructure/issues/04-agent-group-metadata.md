# 04 — 代理群組欄位宣告（含條件可見性）

**What to build:** 組態、角色模型、語言模型、CLI 授權、OpenCode、Pi Core 各節欄位完成宣告，工程調參（authLevel、minConfidence、toolSearchThreshold、maxToolRounds、maxToolPayloadKb、並行上限等）明確標為進階並各有一句話說明。Policy Admin 的「只在特定 build 顯示」規則改由 metadata 條件宣告表達，而不是散在畫面裡的 if 判斷；可見性規則本身完全不變，敏感面不因重構而擴大。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] 六節所有欄位完成宣告，並從待辦清單移除
- [ ] 工程調參一律標為進階，且每個都有一句話說明何時該調、何時該調回去
- [ ] Policy 相關設定的可見性規則以 metadata 條件表達，行為與重構前逐項相同
- [ ] Pi 的 runtime source of truth 關係不變：registry 只負責呈現與可發現性
- [ ] 複雜工作流（CLI 授權矩陣、OpenCode 匯入）內部流程未被拆散，只補宣告
