# 11 — SubDesign design_* pack

**What to build:** SubDesign 的 brief → direction → build → critique → deliver 流程在出貨的 app 裡真的跑得起來。那 12 個 `design_*` 工具今天在 production 一個都叫不動，等於整條設計工作流在桌面版是壞的。

Host 已經有 `subDesignProviderRuntime` 與 plugin execution 路徑，這張票把模型面向的工具接上去。

**Blocked by:** 01

**Status:** 可交給代理

- [ ] 12 個 `design_*` 工具註冊為 SubDesign pack 的 extension tools
- [ ] brief / direction / artifact / critique / gate / export 各階段在一個真的 turn 裡串得起來
- [ ] artifact 註冊與 revision 走 Host 既有的 artifact 路徑，不新增第二份 store
- [ ] gate 與 critique 的 fail-closed 語意保持（證據不足不得通過）
- [ ] 會產出檔案的工具走 Approval Decision 與 file mutation queue
- [ ] 測試在單一接縫，比照既有的 open-design qualification pattern
