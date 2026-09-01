# 11 — 外部 CLI instruction delivery modes

**What to build:** 讓每個 external CLI run 誠實說明自訂指令如何抵達 provider：explicit snapshot injection、native filesystem discovery 或 unverified。Codex／Claude 的原生專案檔案行為保持可用，同一來源不重複注入；無法凍結或證明 exact snapshot 時，UI 與 Turn Record 不宣稱與 builtin Pi 等價。

**Blocked by:** 09 — Instruction budget、去重與 context usage.

**Status:** 待補資訊

- [x] Runner capability contract 宣告 instruction delivery mode 與是否可證明 exact effective snapshot。
- [x] Explicit mode 傳遞 admission 時凍結的有效文字與 hash，runner 不在執行途中重新解析 mutable settings。
- [x] Native mode 保留真實 AGENTS／CLAUDE filesystem discovery，不另 prepend 同一 project source 造成重複。
- [x] DB-owned global custom instruction 若 provider 無 native equivalent，使用 bounded explicit wrapper 或清楚標示未送達，不可默默丟失。
- [x] Turn Record 與 run UI 顯示 explicit/native/unverified、source summary、effective hash 可用性與限制原因。
- [x] External CLI success 仍不等於 Definition of Done met，instruction delivery 不改變 runner capability matrix。
- [x] Adapter contract tests 覆蓋 duplicate suppression、argv/prompt handoff、project cwd、queue/restart snapshot 與 unsupported provider。
- [x] 真機 Codex qualification 驗證 native discovery、active checkpoint、restart projection 與 metadata-only Turn Record。
- [ ] 真機 Claude qualification 驗證 native discovery；目前安裝但未授權，維持 `auth_unavailable`／unqualified evidence。

**Qualification note（2026-09-01 fresh rerun）：** [qualification](../qualification.md) 與 retained metadata report 已從 shipped admission／adapter owner 重跑。先修正舊 qualification 的不可觀察設計（專案檔只有 token、未要求 provider 回傳），再由不含檔名與 native token 的 user prompt 驗證 discovery。Codex CLI 0.152.0 exit 0，native marker／checkpoint／restart projection／record 全部通過，provider-specific 項目已完成；Claude Code 2.1.246 實際啟動後仍回報 `auth_unavailable`，不得宣稱已驗證。
