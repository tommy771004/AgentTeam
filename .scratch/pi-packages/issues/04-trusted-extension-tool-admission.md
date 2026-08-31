# 04 — Trusted Extension Tools admission

**What to build:** 讓已安裝 Pi Package 中的相容 extension tools 經明確 trust 與 enable 後，才可在 Agent Chat 與 Pi-backed SubDesign 使用。Installed 與 active 必須分離；Host-issued tool contract 記錄 package source/version provenance，並保留既有 approval、Outbound Data Gate、Turn Record 與 execution evidence。與安全敏感 builtin 同名的工具預設不可啟用，不自動改名或建立相容層。

**Blocked by:** 02 — Pinned npm 安裝、移除與安全 reload

**Status:** 可交給代理

- [ ] 新安裝 package 的 extension tools 預設 inactive，且不出現在 model-visible active-tool set
- [ ] 使用者必須再次明確接受 Trusted Extension 完整本機權限語意後，Host 才能啟用相容 package tools
- [ ] 啟用後的工具帶 package name、exact version 與 resource origin provenance，並由 Host-issued tool contract 發布 schema identity
- [ ] Agent Chat 與 Pi-backed SubDesign 只可呼叫當輪 contract 中 active 的 package tool，不各自維護 enable 狀態
- [ ] Package tool calls 沿用既有 approval、Outbound Data Gate、Turn Record、execution evidence 與 settlement，不新增繞過路徑
- [ ] Package tool 與安全敏感 builtin 發生名稱 collision 時 fail-closed 並回報 diagnostics，不靜默覆寫或自動改名
- [ ] 停用或移除 package 後，安全 reload 的下一輪 contract 不再包含其 active tool
- [ ] Unsupported lifecycle hooks、TUI custom UI、prompts、commands、themes 與 provider extensions 不被標示為可用 tools
