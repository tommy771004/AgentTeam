# 22 — Full lifecycle qualification 與 release decision

**What to build:** 在單一 frozen baseline 上驗證完整 Task run source × runner × recovery matrix，並依自動、Electron、真機與平台 evidence 做出可查核的 release Go/No-Go。

**Blocked by:** 21 — Runtime owner 文件與 tracker 收口

**Status:** 可交給代理

- [ ] 每個 run source 搭配 builtin/external 都覆蓋 reject、admit、queue、run、wait、cancel、timeout、restart、finalization、delivery與recovery
- [ ] Turn Record/live/replay、reattach、finalizer race、Host restart、external process loss、spill、scheduler/publish與Run Review完整鏈通過
- [ ] OpenDesign/SubDesign provider、interactive/streaming fallback與adaptive status完成 Electron/UI qualification
- [ ] build、lint、deterministic smoke、Electron E2E與diff check指向同一 baseline且全綠
- [ ] signing/notarization、Linux sandbox、provider credentials等缺失固定導致No-Go或明確blocked狀態，不以fixture替代
- [ ] release report列出 Go/No-Go、所有外部 residual、重跑命令與一 hop evidence
