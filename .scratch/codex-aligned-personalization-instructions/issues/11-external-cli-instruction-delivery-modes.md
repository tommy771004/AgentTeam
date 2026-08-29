# 11 — 外部 CLI instruction delivery modes

**What to build:** 讓每個 external CLI run 誠實說明自訂指令如何抵達 provider：explicit snapshot injection、native filesystem discovery 或 unverified。Codex／Claude 的原生專案檔案行為保持可用，同一來源不重複注入；無法凍結或證明 exact snapshot 時，UI 與 Turn Record 不宣稱與 builtin Pi 等價。

**Blocked by:** 09 — Instruction budget、去重與 context usage.

**Status:** 可交給代理

- [x] Runner capability contract 宣告 instruction delivery mode 與是否可證明 exact effective snapshot。
- [x] Explicit mode 傳遞 admission 時凍結的有效文字與 hash，runner 不在執行途中重新解析 mutable settings。
- [x] Native mode 保留真實 AGENTS／CLAUDE filesystem discovery，不另 prepend 同一 project source 造成重複。
- [x] DB-owned global custom instruction 若 provider 無 native equivalent，使用 bounded explicit wrapper 或清楚標示未送達，不可默默丟失。
- [x] Turn Record 與 run UI 顯示 explicit/native/unverified、source summary、effective hash 可用性與限制原因。
- [x] External CLI success 仍不等於 Definition of Done met，instruction delivery 不改變 runner capability matrix。
- [x] Adapter contract tests 覆蓋 duplicate suppression、argv/prompt handoff、project cwd、queue/restart snapshot 與 unsupported provider。
- [ ] 真機 Codex／Claude qualification 驗證 native discovery；未安裝或未授權 provider 保持 explicit blocked/unqualified evidence。
