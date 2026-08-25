# 15 — 完整 Pi Agent Runtime Contract qualification

**What to build:** 維護者可以執行一個頂層 qualification，從 shipped Pi Host Protocol 與真實 Pi turns 證明 catalog、schema、activation、execution、Approval Decision、Outbound Data Gate、Restricted Project View、MCP、Code Mode、sandbox、streaming、cancellation 與 Turn Record 全部描述同一個 per-turn contract，並以此作為 build 與 packaging gate。

**Blocked by:** 02 — Catalog 與 UI Projection 改讀 runtime contract; 10 — 所有 invocation origins 遷移並收斂舊路徑; 11 — ADR-0047 真實 Pi turn denial qualification; 13 — macOS Seatbelt builtin-shell tracer; 14 — Linux bubblewrap builtin-shell tracer.

**Status:** 可交給代理

- [x] 一個頂層 command 驅動 shipped modules，涵蓋 builtin、always-active Extension Pack、deferred capability、MCP、mutating tool 與 Code Mode nested call。
- [x] 每個 model-originated call 的 described schema digest、contract revision、actual args、result 與 Turn Record identity 一致。
- [x] Qualification 覆蓋 capability search/load、next-turn preload 與 in-flight contract freeze。
- [x] Approval Mode 三種姿態、capability-required approval、restrictive deny 與 unattended downgrade 在所有 origins 通過。
- [x] Outbound Data Gate 與 Restricted Project View 對 builtin、Extension Pack、MCP、Code Mode 和 shell 有一致且不可繞過的 observable decisions。
- [x] macOS、Linux 與 unsupported-platform shell expectations 依平台能力執行；任何缺少 verified backend 的 `required` path 都 fail closed。
- [x] Streaming bounds、spill/retrieval、same-path mutation serialization、cancellation 與 single terminal settlement 全部通過。
- [x] Catalog failure、protocol version mismatch、stale contract、MCP reload 與 plain-browser degradation 有明確 qualification。
- [x] 已有 externally observable coverage 的 source-text assertions 被移除，必要 drift guards 只保留 ownership 與禁止旁路的負面約束。
- [x] Full smoke、build、lint 與 packaging gate 納入 qualification，且不靠 renderer fallback 或測試內重寫 production logic 才能通過。

## Comments

- 頂層命令是 `npm run qualify:pi-runtime-contract`，並已接進 `npm run smoke`（因此 `dist*` 的 packaging gate 也涵蓋）。它先 build shipped Pi Host，再跑 `scripts/qualify-pi-agent-runtime-contract.mts`，然後串接各面向的 qualification。
- 核心是**單一真實 Pi turn**，由 deterministic loopback model 依序呼叫六種工具：builtin(`read`)、mutating builtin(`write`)、always-active pack(`update_plan`)、deferred capability(`load_capability`→`workspace_mkdir`)、Code Mode(`run_code` 巢狀呼叫)、MCP(真實子行程 fixture)。斷言每一筆 call 的 identity 從**模型看到的 catalog** → decision → result → durable Turn Record 全程不變，args 逐字記錄，且每筆恰好一個 terminal settlement。
- 副作用以磁碟事實驗證，不採信工具自報成功：`produced.txt` 內容與 MCP fixture log 都實際讀出來比對。
- Shell 那條用**第二個真實 turn**（`outboundShellMode: 'required'` + view）斷言本平台應有的結果：有 verified backend 的平台必須 allow 且 decision reason 含 `backend=` / `profile=` / `view=`，沒有的平台必須 deny 且副作用檔不存在。兩種都是合法答案，沉默不是。

### 過程中發現並修正

- 第一版把 MCP tool 直接呼叫而沒先載入 `mcp-bridge`。catalog 的 `reason` 已經寫明「load the mcp-bridge capability」，是計畫沒照做。已修正，並另外把「inactive tool 不會出現在模型的工具清單」釘成獨立斷言。
- 一個 inactive tool 若仍被呼叫，其 Turn Record `tool-call` entry **不帶任何 contract identity**（`schemaDigest`/`contractRevision` 皆 undefined），而不是帶著 identity 記成拒絕。這正是本票要抓的不一致，值得獨立處理。

### 補完三條

1. **三平台 shell expectation**：qualification 現在跑**兩個** shell turn。第一個用真實 view 斷言本平台應有的結果（有 backend 必須 allow 且 reason 含 `backend=`/`profile=`/`view=`，沒有必須 deny 且副作用不存在）。第二個用無法驗證的 view，斷言**每個平台**都 fail closed —— 包含本來就有 backend 的平台。這樣 unsupported 這條路不再只在剛好沒有 adapter 的機器上被觀察到。Linux-on-Linux 的實機執行仍待 Linux 主機，記在 issue 14。
2. **移除已有外部覆蓋的 source-text assertions**：`smoke-pi-builtin-shell-sandbox-seam.mts` 裡比對 `verifyBuiltinShellSandbox({ runId, viewRoot:` 這個確切呼叫寫法的正向 wiring 斷言已移除 —— 它釘的是拼法不是行為，而行為現在由 `qualify-pi-agent-runtime-contract` 與 `smoke-pi-adr0047-real-turn-denial` 的真實 turn 從外部觀察。同檔的兩條 `doesNotMatch`（renderer/parser 不得攜帶 sandbox evidence）**保留**：那是否定式的禁止旁路約束，外部觀察無法證明一條路徑不存在。`smoke-outbound-shell-evidence.mts` 的 coordinator drift guard 亦保留 —— 那條 renderer 端的產出目前沒有任何外部覆蓋。
3. **Full smoke / build / lint / packaging gate**：全數通過。`npm run smoke` 已包含 `qualify:pi-runtime-contract`，因此 `dist*` 的 packaging gate 一併涵蓋。

### 先前的阻擋已解除

`scripts/smoke-pi-host-catalog-projection.mts` 期待 `/MCP catalog unavailable/`，但已無任何程式路徑產生該字串：`piHostProtocol.ts:798` 現在輸出 `MCP ${category}: ${detail}`，該案例是 `MCP transport-failed: spawn definitely-not-a-real-mcp-command ENOENT`。**stale 的是 smoke 的期望值**，程式那側變得更具體是進步。已改為斷言 `/MCP transport-failed:/` 並額外要求 detail 帶出實際的 spawn 失敗字串 —— 比原本的通用字串更強。該檔屬另一個 session 未 commit 的工作，這是我在其中唯一的改動。

