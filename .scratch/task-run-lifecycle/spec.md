# Task Run 全生命週期收口計畫（校正版）

Status: 可交給代理

> 本文件只在 Plan phase 更新；目前不修改產品程式碼、不執行 build/smoke。Build phase 必須依 dependency frontier 逐階段實作與驗收。所有產品 run 仍以 `app/src/agent/taskRunCoordinator.ts` 的 `runTask` 為唯一 ingress；本文件不是另一套 runtime。
>
> 本版以目前 source、Host protocol、`.scratch/INDEX.md`、`DEV_STATE.md` 與各 effort spec 對帳後重寫。若本文件與 source 不一致，先停工修正文件/owner，不用文件替 source 猜行為。

## 0. 寫入時發現並一併修正的問題

1. **Run Review frontier 已過時。** `run-review-workspace` #01–#09 已 resolved，目前是 #10 feedback follow-up，接著才是 #11–#15。計畫不再從 `ReviewArtifactStore` #03 重做，而是先修正下面的 historical fallback，再從 #10 繼續。
2. **Active Run Reattachment 已完成，不能重做成新 runtime。** `active-run-reattachment` #01–#12 已 resolved；它提供 Host attachment、snapshot + cursor、renderer bootstrap、CAS finalization 與 restart E2E。本計畫只做 regression integration。Pi Host current protocol 是 v5；reattach 能力是 additive `attachments-v1`，不是再升一個只為本計畫服務的 protocol。
3. **Legacy loop 的文件敘述已落後 source。** `agent/engine.ts`、`agent/loop/`、`agent/runExternal.ts` 在目前 product source 已不存在，但 `CLAUDE.md`、`CONTEXT.md`、`docs/CONVERSATION_LOOP_HERMES_FLOW.md` 與部分舊 spec 仍把它們寫成現行/過渡 owner。Build phase 必須改成 Pi Core Host 唯一 production owner；歷史比較才保留 historical note，不得留下不存在的 path、import 或測試命令。
4. **`ThreadRunSummary.diff` 仍有違反歷史語意的 fallback。** `taskRunCoordinator` 在沒有 `reviewSnapshotRef` 時可重新讀目前 working tree，`artifactIndex` 也可把它記成 working-tree diff。這不符合「artifact 遺失、capture failure、舊 archive 缺 reference 都不得冒充歷史 snapshot」。只允許明確標記的 plain-browser/legacy ephemeral projection；Electron canonical run 必須顯示 `failed/partial/missing`，不能讀現況補洞。
5. **Early finalization 的 terminal marker 順序不一致。** 正常路徑大致在 summary/archive/memory 後才記 renderer terminal marker，但 early deny/exception 路徑先記 terminal 再做 summary/archive。這會讓 recovery 把「execution ended」誤讀成「app finalization 完整」。後續要分開 durable execution terminal 與 app-finalization stage，並讓所有 early/normal path 使用同一 stage ledger。
6. **Reload 後的 automation delivery intent 不完整。** Pi attachment projection 沒有完整保存 `sourceKind`、`scheduleJobId`、delivery intent、project/review metadata；`finalizeRecoveredPiHostRun()` 可能把來源降成 `retry`，而 `onSettled` function 本身也不跨 renderer。需以 bounded durable intent 重建 scheduler/webhook/delegate bookkeeping；不能依賴消失的 callback。
7. **Terminal finalization 的 transient failure 仍可能失去同一 renderer 的 retry。** `recoveredFinalizationClaims` 與 claim unavailable 分支若直接回 synthetic result，可能讓 Host terminal record pending、但本 renderer 不再 retry。應保留 `pending-finalization`，只在 Host CAS complete 後 ack；release/drain 與 app delivery 要有明確條件，不可把「未完成」當完成。
8. **Content Publishing 目前繞過 Task run lifecycle。** `contentPublishStore.publishSchedule()` 直接更新 renderer ledger，再呼叫 `window.subagents.contentPublishing.publish` 或 browser adapter；它沒有 `runTask` admission、Host scheduler claim、run journal、pending delivery 或統一 recovery。`PublishSchedule.scheduledAt` 只是 intent，不是 scheduler evidence。
9. **Scheduler 的 due consumer 仍由 renderer ticker 觸發。** main 目前只送 `scheduler:tick`，真正 `claimDueJobs()` 與 `runTask()` 在 renderer。App 關閉、renderer reload 或 duplicate tick 可能造成 due claim 與 run admission 不在同一個原子邊界。後續由 Host/main 擁有 due claim；renderer 只做 projection/intent，避免雙 scheduler。
10. **`sourceKind` 仍是 optional，且 `queue-drain` 語意未與原始來源分清。** 新 production caller 必須帶明確 source；queue drain 不應把原本的 schedule/webhook/composer 改寫成另一個來源。若要顯示 drain 原因，增加 bounded processing metadata，不以 `sourceLabel` 猜 source。
11. **Spill owner 名稱與實作不一致。** 目前是 `electron/attachmentStore.ts` 的 functions，Host protocol/pack 已有部分接線；尚未有真正的 `ToolOutputSpillStore` 單一 interface。Phase 2 必須先收口到一個 Host owner，不可再新增 `toolspill:*`、`out-*` 或第三軌。
12. **Evaluation gate 與 issue 語意矛盾。** `package.json` 的 `smoke:gap-closure` 已包含 `smoke:evaluation`，但 `harness-gap-closure` #11 明定 evaluation tool 不應進 `npm run smoke`/`smoke:ci`。Build phase 必須二選一並對帳；本計畫採「evaluation 非 deterministic release gate，移出主 smoke，保留獨立命令」的既有 issue 語意，不用改弱 assertion 來掩蓋。
13. **Headless code 已存在但 ticket/evidence 未完全對帳。** `agent/headlessRun.ts`、`scripts/smoke-headless.mts` 與 `headless:run` 已存在；不重建第二入口，改做 ticket evidence、renderer-only dependency audit、unattended semantics 與文件狀態對帳。
14. **External CLI harness 不能因 code 存在就標 resolved。** `externalCliRunSession.ts` 已有 policy、yield、reconnect、wait、cancel、checkpoint 與 telemetry；#01–#06 尚需逐條 contract evidence，#07 仍要真機/環境 qualification。Codex/Claude partial evidence 不等於所有 provider qualified。
15. **目前 gate 結果不可在 dirty worktree 上重新宣稱。** `DEV_STATE.md` 與多份 qualification 有不同時間點 evidence；Phase 0 必須固定 baseline、owner 與 command output，再決定哪些是 regression、哪些是新工作。

## 0.1 已鎖定的規則

- **唯一 ingress：** `taskRunCoordinator.runTask`。UI、SubDesign、review feedback、headless、queue drain、scheduler adapter 都不得直接呼叫 `dispatchThreadTask` 或 `startExecution`。
- **Pi Core Host owner：** production tool loop、approval、execution evidence、Turn Record、builtin settlement 都在 supervised Electron utility process。不存在的 `agent/loop`/`engine`/`runExternal` 不得再被當作可新增功能的 seam。
- **Runner honesty：** builtin 是 `executionKind: 'loop'`，具 Parse/DoD/iterate/continueGoal；external CLI 是 `executionKind: 'external'`，`parse`/`validateDoD`/`iterate` 為 false，`continueGoal` 僅能使用明確 prompt contract。CLI exit 0 永遠不等於 DoD met。
- **Host canonical / renderer projection：** renderer Zustand、localStorage、bubble 與 UI cache 不能覆寫 Host state，不能復活 tombstone，也不能取得 raw token、Git authority 或 canonical artifact body。
- **Trigger fail closed：** Time-based 必須由 claimed `ScheduledJob` snapshot；Proactive 必須有 event matcher evidence；聊天中的 cron/event 意圖只產生 suggestion。
- **Evidence fail closed：** model text、tool args、planned state、CLI exit code、approval decision 都不是 side-effect evidence。只有 trusted adapter/Host execution snapshot 可以證明 effect。
- **Historical review immutable：** `run-snapshot` 只讀 `ReviewArtifactStore`。Live/staged 是 mutable target，必須明示 revision/freshness，不能作 historical fallback。
- **Exactly once：** execution terminal、app finalization claim、summary/archive、delivery intent、onSettled equivalent、capacity release、queue drain、Host ack 均要可重試但不可重複 effect。
- **Bounded payload：** renderer/Turn Record/journal 只保存 metadata、hash、locator、cursor、omission；大輸出、review payload、credential body 留在其 Host authority。
- **External authority：** Codex/Claude credentials、Linux bwrap CI、clean-machine signing/notarization 等只影響 qualification/release，不可用 fixture 假裝 qualified。builtin shell 是否擴大 ADR-0022 義務仍需 maintainer/ADR 裁決，本計畫不偷改。

## 1. Canonical lifecycle

```text
request
  → trigger validation / automation suggestion
  → idempotency + capacity admission
  → queued | rejected | admitted
  → immutable RunAdmissionSnapshot
  → Pi Core builtin loop | External CLI session
  → waiting approval/input/auth | cancelling | interrupted | execution terminal
  → app-finalization claim (CAS / lease)
  → review/artifact finalization
  → summary / UI projection / afterRun / archive / memory & evidence refs
  → delivery intent settlement
  → cleanup / Host ack
  → capacity release
  → queue drain
```

### 1.1 Request與 rejection

- ingress adapter 只建立 typed request：`sourceKind`、objective、runner、thread/project、attachments、trigger evidence、delivery intent。
- 空 objective、invalid trigger、duplicate id、disabled capability、malformed review feedback 在 capacity 前拒絕；這不是 admitted run，不得建立假的 execution/archive。
- composer/slash 出現排程或事件文字時只建立 `AutomationSuggestion` bubble；不得從 parser 關鍵字直接進 Time-based/Proactive execution。
- rejected automation 仍要關閉外部 claim 的 bookkeeping（例如 schedule delivery intent），但與 admitted run 的 finalization 分開記錄。

### 1.2 Admission snapshot

成功 admission 必須固定：

- `runId`、原始 `sourceKind`、thread/session/turn identity；
- objective、loop intent、runner/execution kind、capability snapshot；
- project/workspace/repo identity、review baseline、attachments locator；
- settings、approval/unattended posture、Outbound Data Gate、Restricted Project View；
- external CLI policy/connector requirement/instruction delivery snapshot；
- schedule/event evidence、delivery intent、dedupe/idempotency key；
- capacity claim 與 queue lineage。

設定、instruction、project、connector 與 review identity 之後不得因 UI 切換或 mutable store 變更而重新推導。

### 1.3 Queue與same-thread ordering

- app-level queue 只有一個 canonical owner；Pi Host `runs/*` 若只管理 Host turn queue，必須與 app queue 的 run identity 明確分層，不得同一工作被兩個 queue 各自 claim。
- queue item 只保存 serializable bounded snapshot，不保存 function callback；scheduler/webhook/delegate 透過 delivery intent 在 drain/restart 重建。
- same-thread follow-up 依 `settings.followUpMode` steer 或 queue；different threads 在 `maxConcurrentRuns` 內並行。
- steer 的 abort 未在等待窗口釋放 slot 時，goal 進既有 queue；只有沒有 abortable run 才回 busy。原始 objective 不可遺失。
- queue drain 保留原始 source policy；`_fromQueue`/processing cause 不能把 automation 變成 composer，也不能讓 schedule trigger 重新 mint。

### 1.4 Execution

**Builtin Pi Core**：Host 產生 Turn Record、reasoning/tool/assistant entries、approval decision、trusted execution evidence、Working State、DoD/iteration、terminal settlement。renderer 只接收 event/cursor projection。

**External CLI**：Electron external session supervisor 只監督 provider process/session，提供 startup/idle/absolute/operation/yield bounds、wait state、cancel、checkpoint、output omission 與 terminal classification；不得複製 provider 內部 tool loop/MCP client，不得把 process success 轉成 DoD。

Run 可進入：

```text
starting → running → waiting_for_approval / waiting_for_user / waiting_for_auth
         → running | cancelling | execution-terminal
execution-terminal → app-finalization-pending → app-finalized → delivered/pending-delivery
```

Host/app restart 的 active process 若沒有 live witness，一律 `interrupted`；不得自動重送 effectful work。只有 provider resume identity + Replay-safe Checkpoint 同時成立，才可顯示明確人工 resume/retry action。

### 1.5 Execution terminal 與 app finalization 分離

- Host 先以 run identity 寫入不可逆 execution terminal；late success 不得復活 cancelled/failed/interrupted。
- app finalization 以 Host CAS claim/lease 取得唯一 owner；renderer reload、原 renderer 與 replacement renderer 競跑時只允許一個 stage owner。
- 每一 stage 需有 bounded status/receipt：`review-finalized`、`summary-written`、`after-run-applied`、`archive-written`、`delivery-settled`、`cleanup-complete`。已完成 stage 不重做；未完成 stage 可由同一 durable intent retry。
- 目標順序：
  1. finalize immutable review snapshot（若 canonical admission 存在）；
  2. 建立 summary/UI projection（不得讀 current tree 當 historical diff）；
  3. afterRun hooks；
  4. Archive 與 artifact/review references；
  5. memory/evidence sink（僅 Host/adapter write proof）；
  6. delivery intent / `onSettled` equivalent；
  7. spill/restricted-view/temporary cleanup；
  8. Host finalization complete + ack；
  9. capacity release；
  10. queue drain。
- 任一非必要 projection 失敗不改寫 execution outcome，但要留下 stage failure與 retryability。capacity release 不能依賴 summary/UI 成功。
- `pending-delivery` 是交付狀態，不是重新執行狀態；redelivery 只敘述已保存 outcome，不重跑 tool/side effect。

### 1.6 Recovery order

1. 啟動 migration/storage recovery，先恢復可用 journal/queue snapshot。
2. 啟動 Host、協商 protocol/capability，訂閱 event，再 query active/terminal attachments。
3. 以 snapshot + events-after-cursor 重建 Turn Record/UI Projection；generation、seq、gap、terminal precedence 全部由純 reconciliation contract 決定。
4. active Pi run 回 registry、恢復容量與 HITL pending ask；terminal run 非同步交給 finalization claim，不阻塞 app boot。
5. external CLI process loss 依 session checkpoint 分 `interrupted`、manual retry、unsupported resume；不可暗中啟動第二 process。
6. queue/schedule/delivery intent 逐筆重新驗證 idempotency、trigger snapshot 與 ownership，再決定 drain、quarantine 或人工處理。
7. 最後敘述 pending delivery；找不到 owning thread 或 artifact 時顯示 unknown/missing，不改讀 live state。

## 2. Source × runner × recovery matrix

| Source | Admission / busy policy | Builtin Pi Core | External CLI | Recovery / delivery |
|---|---|---|---|---|
| `composer` / `slash` | interactive；same-thread steer/queue | full loop；無明確 pin 時只 auto classify Turn/Goal | external outcome；capability reduced | reload projection；user cancellation；不保存 function callback |
| `retry` / `review` | same-thread ordering；review feedback bundle 先 claim | new run，保留 source snapshot | new external session，保留 explicit contract | comment bundle/feedback claim exactly once；新 snapshot A→B |
| `schedule` | claimed `ScheduledJob`；unattended；overflow queue | Time-based only with snapshot | 同上；connector/auth separate | due claim、duplicate tick、restart、job result 都以 durable intent/idempotency 收口 |
| `webhook` / `telegram` | verified external input；unattended；queue | trigger/payload provenance bounded | same external policy | inbound id + delivery intent 防重；renderer 不在時 pending delivery |
| `event` | matcher evidence required；unattended；queue | Proactive only with evidence | same | matcher evidence 沿 queue/retry/archive；unmatched 不執行 |
| `delegate` | delegation budget/depth；hidden worker or linked parent | child run through coordinator | external child with no parent raw transcript | child archive/parent notification single lineage；disabled at drain fail closed |
| `headless` | explicit development/evaluation seam；unattended | Node-safe coordinator path | optional external connector path | no DOM/renderer owner；evaluation result 不自動等於 release gate |
| `queue-drain` | processing cause；不重排原始 source | re-admit with original snapshot/policy | re-admit with frozen connector/instruction policy | dispatch marker before queue removal；uncertain side effect quarantine |

### Runner capability rule

| Runner | `executionKind` | Parse | DoD | Iterate | continueGoal | Truth |
|---|---|---:|---:|---:|---:|---|
| builtin | `loop` | yes | yes | yes | yes | Host Working State/Checker/Turn Record |
| external CLI | `external` | no | no | no | only explicit prompt contract | process/session outcome；CLI success 不等於 DoD |

## 3. Owner與不可承擔責任

| Owner | Canonical responsibility | Explicitly不能做 |
|---|---|---|
| `taskRunCoordinator.runTask` | normalize、trigger gate、idempotency、capacity、queue handoff、admission snapshot、finalization claim、delivery/release order | 不執行 Pi tool loop，不自行 mint side-effect evidence |
| Pi Core Host / protocol v5 | builtin tool loop、approval、Turn Record、Working State、trusted evidence、execution terminal、attachment truth | 不讓 renderer/localStorage 覆寫 canonical state |
| external CLI session supervisor | process/session identity、deadline/yield/cancel/reconnect/checkpoint、terminal classification | 不重做 provider loop，不宣稱 DoD |
| app queue owner | FIFO、dedupe、bounded persistence、dispatch marker、drain | 不保存 callbacks，不繞過 coordinator |
| Host scheduler/main due consumer | ScheduledJob claim、tick idempotency、due dispatch intent、restart reconciliation | 不讓 renderer ticker 成為第二 scheduler |
| content publishing Host adapter/pack | vault token、platform API、publish idempotency、adapter evidence、failure classification | 不由 renderer store/browser adapter直接發布 |
| `ReviewArtifactStore` / review Host | immutable snapshot、manifest/hash/payload paging/tombstone | 不以 live workspace補 historical snapshot |
| `ToolOutputSpillStore` Host seam | bounded write/readPage/authorize/dispose/TTL/restart GC | 不把 raw output放 renderer/localStorage或讓 locator繞過 Outbound Gate |
| Archive/memory stores | durable refs、provenance、retention、tombstone | 不把模型宣稱當 write proof |
| renderer/Zustand/UI | disposable projection、interaction intent、focus/layout、bounded copy | 不成為 run/scheduler/Git/token/artifact authority |

## 4. 實作順序與 exit gate

### Phase 0 — Frozen baseline、tracker與文件對帳

**目標：** 先釐清 WIP、現況與文件，不在 dirty checkout 猜 ownership。

工作：

- 建立 tracked/untracked path owner、commit boundary、frozen checkout 與 gate evidence index。
- 以 source 為準修正 `CLAUDE.md`、`AGENTS.md`、`CONTEXT.md`、`docs/CONVERSATION_LOOP_HERMES_FLOW.md` 的不存在 path、舊 global lock、舊 source list、舊 browser engine 敘述。
- 對 `.scratch/INDEX.md`、`DEV_STATE.md`、effort Status、qualification 與 package scripts 對帳；已 resolved 不重開，open code 與 open evidence 分開。
- 修正 harness-gap #11「evaluation 非 smoke gate」與 headless ticket evidence 的矛盾；不因綠燈就把尚未逐條驗收的 ticket 標 resolved。

Exit gate：

- `rtk npm --prefix app run build`
- `rtk npm --prefix app exec -- oxlint src`
- `rtk npm --prefix app run smoke`
- `rtk git diff --check`
- 四項結果均指向同一 frozen baseline；失敗即記為 baseline blocker，不進下一 phase。

### Phase 1 — Lifecycle contract、durable intent與finalization stage ledger

**目標：** 補齊 execution terminal、app finalization、delivery、cleanup、recovery 之間的斷層。

工作：

- 讓所有 new production `runTask` callers 帶 explicit `sourceKind`；在 boundary 區分 original source 與 queue-drain processing cause。
- 定義 bounded `RunAdmissionSnapshot`/delivery intent；保存 schedule/event/review/delegate identity、project/runner policy 與可重建的 settlement callback semantics。
- 將 normal、early deny、dispatch exception、cancel、timeout、Host restart、renderer reload 全部接到同一 finalization stage ledger。
- 修正 transient claim failure/retry：未 `finalize-complete` 不 ack；pending stage 可重試；release/drain 不會遺失；已完成 stage 不重做。
- 對 recovery 先行 query Host truth，保留 active-run-reattachment 現有 Protocol v5/attachments-v1 行為，不新增第二 coordinator。

Exit gate：

- 每個 terminal outcome 有 execution status、app-finalization status、delivery status、recovery action 四個可查欄位。
- summary/archive/onSettled-equivalent/release/drain 在 crash point、競跑與 reload 下各最多一次。
- source × runner matrix 的 rejection/queue/run/cancel/restart cases 有 shipped-module smoke。

### Phase 2 — Host large-output spill與External CLI durable harness

**目標：** 收口大型輸出 authority，並完成 external session 的 implementation/evidence/qualification 分層。

工作：

- 將 `electron/attachmentStore.ts` 現有 functions 深化為唯一 Host `ToolOutputSpillStore` interface；reconcile Pi pack、protocol、builtin bash、external output 的 locator envelope。
- locator 綁 run/session/thread/project identity；readPage 有 byte/round bound；retrieval 再通過 Outbound Data Gate；dispose/TTL/restart orphan cleanup 共用政策。
- 確認 no-Host/browser path 明確 non-canonical，不建立第三套 spill authority。
- 依 `.scratch/external-cli-durable-harness` #01–#06 驗證共同 session seam、五種 clocks、yield/reconnect、wait states、connector classification、cancel/replay safety。
- #07 只在可用 provider/OS/credentials 上做 real qualification；Codex/Claude/Grok/Gemini/Cursor 分別記 `qualified`、`blocked-auth`、`unavailable`、`unsupported`。
- 明確區分 Pi Host turn idle deadline 與 External CLI session policy；不可把任何單一五分鐘值寫成全域 run deadline。

Exit gate：

- large output 可 bounded read、cross-run locator fail、dispose/restart cleanup，且沒有 raw output進 renderer。
- external session 的 startup/idle/absolute/operation/cancel/interrupted classifications、event cursor、wait/auth、one settlement 全部可重現。
- 真機缺環境時只留下 blocked evidence，不將 fixture 綠燈升格為 qualified。

### Phase 3 — Scheduler、Content Publishing與side-effect delivery

**目標：** 將自動化與所有 outward effect 接到同一 lifecycle，消除 renderer direct side effect。

工作：

- Host/main 成為 ScheduledJob due consumer；claim、advance、idempotency key、duplicate tick、restart 與 `runTask(sourceKind='schedule')` admission 要有一致 transaction/receipt。renderer `startTicker` 只投影或請求 intent，不再是唯一執行者。
- 將 `PublishSchedule` 定義為 content publish intent，與一個 Host-owned scheduled/delivery record 連結；到期後由 coordinator admission 啟動，不由 `contentPublishStore.publishSchedule()` 直接 API call。
- content publish adapter 只在 Host/main 使用 encrypted vault token；成功必須有 adapter-issued `content_publish` evidence；auth/config/media/API/unknown outcome 分類，unknown 不自動重送。
- `message_send`、MCP、workspace write、merge/push/deploy、publish、external CLI effect 逐一列出 approval、Outbound Gate、evidence、idempotency、recovery policy。
- webhook/telegram/event/delegate delivery intent 在 reload/Host restart 可重建；pending delivery 只 redeliver summary/result，不重跑 side effect。

Exit gate：

- schedule 建立→due→claim→queue→admit→execute→settle→callback/recovery 全程有同一 identity。
- Content Publishing 不再有 renderer/browser direct production publish path；plain browser 明確 unsupported。
- duplicate tick、crash before/after API response、auth failure、missing media、retry 與 cancellation 都 fail closed 且不重送 unknown effect。

### Phase 4 — Run Review remaining workflow

**目標：** 在已 resolved #01–#09 上完成 #10–#15，並先關閉 historical diff fallback。

工作：

- `ReviewArtifactStore`、snapshot capture、workspace projection、comment/review state 使用既有 Host owner；不重做已 resolved tickets。
- 移除 Electron canonical run 在 review admission/capture failure 時的 `legacySummaryDiff`/working-tree fallback；`ThreadRunSummary.diff` 只標 legacy/ephemeral compatibility。
- #10 feedback follow-up：comment bundle 在 claim/admission 凍結；same-thread ordering、different-thread concurrency、external capability、retry/cancel/reload exactly once。
- #11 verification：每筆結果綁 snapshot/revision與Host evidence；workspace改變即 stale。
- #12 stage/unstage/revert：typed mutation intent、expected revision CAS、preview/approval、partial mutation refusal。
- #13 commit/push/PR：分步 idempotency、auth/hook/remote/force policy、evidence與failure recovery。
- #14 restart/export/import/retention：WAL recovery、collision preview、tombstone、reference-aware GC、hard delete boundary。
- #15 做完整 review chain qualification。

Exit gate：

- snapshot A 在 workspace mutate/commit/B 後 hash/manifest/patch byte-for-byte 不變。
- live/staged/branch/snapshot target 互不 fallback；stale CAS 不產生部分 Git side effect。
- feedback→new run→snapshot B→A/B comments/reviewed/verification state 可在 reload/restart replay。

### Phase 5 — SubDesign/OpenDesign provider workflow與adaptive status projection

**目標：** 讓 provider、interactive surface、streaming artifact與側欄狀態都服從同一 Task run lifecycle。

工作：

- OpenDesign #01 plugin contract、#02 resolved snapshot/grants、#03 first contract-driven pipeline run 依序實作；已完成 Storybook #04、DevTools #05、Harness #06 不重做，只接 qualification。
- #07 MCP Apps interactive surface 與 #08 streaming artifact 只建立 sandboxed Host bridge、schema validation、native fallback、cursor replay；不建立第二 runtime。
- #09 provider integration qualification 記 pin/version/license/integrity與平台限制。
- `subdesign-architecture-deepening` #05 只做 protocol internal domain extraction/deletion tests；不得改變 external protocol owner。
- `adaptive-agent-run-status-surface` #01 只消費 frozen runner capability、Host lifecycle、Working State、bounded activity/settlement；不把 instruction/context/objective當 status source。
- 所有 provider stage、evidence、artifact、cancel、late event、reload 與 terminal state 回到 coordinator/Host。

Exit gate：

- SubDesign success/blocked/failed/cancelled/DoD unmet 可區分；provider success 不等於 DoD。
- interactive/streaming failure 有 native fallback；必要 input 不會因 iframe fail 被跳過。
- status surface live/replay/archive/reload 使用同一 projection；essential content 不依賴 animation。

### Phase 6 — Headless/evaluation、renderer seam與文件收口

**目標：** 把已存在但未完整對帳的 Node seam、evaluation與文件治理收口。

工作：

- `headlessRun.ts` 維持 development/evaluation-only seam；明確 sourceKind=`headless`、unattended policy、No DOM、Host bridge feature detection與 no renderer-only imports。
- evaluation harness 維持獨立命令，不進 deterministic `smoke`/`smoke:ci`；其輸出從既有 journal/artifact refs 產生，不新增不受治理 telemetry。
- 確認 `tools/registered/*` frozen seam、Pi extension pack owner、Outbound Gate、vault與Git authority 文件不再有過時處方。
- 更新 `.scratch/INDEX.md`、各 open/resolved ticket、`DEV_STATE.md`、qualification reports；所有 Status 都有一 hop evidence或明確 blocked reason。
- vendor TODO/FIXME只列 upstream residual，不在本 effort 修改 vendor。

Exit gate：

- no active documentation references to deleted runtime owners; historical references explicitly labeled。
- headless/evaluation implementation status、主 gate status、manual qualification status 三者不混用。
- INDEX 無死連結、無把 blocked 寫 qualified、無把既有 resolved work列為 active。

### Phase 7 — Full qualification與release decision

**目標：** 同一 frozen baseline 上完成自動、Electron、真機、平台與 release evidence。

必測：

- every `RunSourceKind` × builtin/external：admission、queue、normal、approval/input/auth、cancel、timeout、restart、terminal delivery、recovery。
- Pi Host Turn Record/live/replay、active reattach、finalization race、Host restart interrupted、external CLI process loss/retry refusal。
- large spill、review snapshot A/B、comments/follow-up、verification stale、Git CAS/mutation、content publish schedule/idempotency/evidence。
- SubDesign provider/interactive/streaming fallback、adaptive status、narrow/desktop keyboard/focus/overflow。
- `rtk npm --prefix app run build`
- `rtk npm --prefix app exec -- oxlint src`
- `rtk npm --prefix app run smoke`
- `rtk npm --prefix app run dist:mac` 僅在 clean-machine signed/notarization authority 可用時執行；否則 release No-Go。

固定結果：`qualified`、`blocked-auth`、`unavailable`、`unsupported`。任何 blocked 都不能以 fixture 或模型宣稱代替。

## 5. Testing與evidence策略

### 5.1 Contract / pure fixture

- `taskRunTypes` source matrix：explicit source、queue processing cause、trigger evidence、dedupe。
- lifecycle stage ledger：early deny、dispatch exception、cancel/timeout、claim race、crash at every stage、pending delivery、release/drain exactly once。
- reattach reconciliation：snapshot/live overlap、seq reorder/duplicate、gap、generation stale、late success、terminal precedence、watermark monotonic。
- review target/attribution/status、comment anchor/rebase、stale CAS、snapshot immutability。
- external session fake clock/transport：startup/idle/absolute/operation/yield/wait/auth/cancel/interrupted/recovery。
- content publish/scheduler idempotency：duplicate tick、API unknown、auth/media error、recovery intent。

### 5.2 Shipped-module smoke

- 每支 smoke import shipped `.ts/.mts` owner；不得 inline mirror production algorithm，也不得新增 loader 只為測試。
- source-text drift guard 只守 ownership/禁止旁路/刪除 path；若已有較高層 behavior seam，將舊 brittle assertion repoint 到新 owner。
- 新 smoke 必須進正確 gate；evaluation smoke 保持獨立，不得以 `smoke:gap-closure` 偷混入 deterministic release gate。
- `smoke:review-settlement-integration` 必須新增「canonical review failure 不讀 live diff」斷言。
- lifecycle qualification 必須看到 stage receipt、source/runner identity、delivery intent與recovery action，不能只看 final status string。

### 5.3 Real Electron/Host E2E

- renderer reload during tool execution；terminal append before finalization；replacement finalizer race；Host child restart active→interrupted。
- external CLI long activity > 5 min、idle timeout、absolute cap、yield/reconnect、wait/auth/cancel/process loss。
- scheduled due run with app open/reload/restart、duplicate tick、content publish API response lost、unknown outcome no retry。
- review A→B、comment follow-up、verification stale、stage/revert CAS、commit/push/PR approval/evidence。
- SubDesign fake provider highest seam、MCP native fallback、stream replay、Harness permission/cancel、Storybook unavailable。

## 6. Definition of Done

整體 effort 只有在以下條件全部有 evidence 才能標 resolved：

1. 每個 `RunSourceKind` 與 runner 組合都有 request/reject/admit/queue/execute/terminal/finalization/delivery/recovery owner。
2. Execution terminal 與 app finalization 分離；任何 crash/reload/retry 不會重複 settlement、archive、delivery、effect、release或drain。
3. Review historical data 永遠來自 immutable Host snapshot；live diff 只在 mutable target顯示，canonical failure 不 fallback。
4. Large output、review payload、comments、verification、archive、memory 與 delivery intent都有 durable owner或明確 non-canonical degrade。
5. 所有 outward effect 都有 policy/approval/Outbound Gate/idempotency/evidence/recovery分類；model/CLI success不能製造 evidence。
6. Scheduler、content publishing、webhook、telegram、delegate、headless 與 queue drain 都不會因 renderer 消失而遺失或重放 side effect。
7. UI 只做 projection/intent；沒有第二 runner、scheduler、Git、token、artifact、status truth。
8. Build、lint、deterministic smoke、Electron E2E、真機 qualification與release evidence能在一 hop 查核。
9. blocked-auth/unavailable/unsupported 與 qualified 明確分列；release gate 對缺證據保持 No-Go。
10. 文件、tracker、source與package scripts一致；不存在的 runtime owner 不再出現在現行操作指引。

## 7. 外部權限與 unresolved questions

**需要額外權限的項目：**

- Codex/Claude/Grok/Gemini/Cursor 真實 binary、login/connector credentials與 provider configuration。
- Linux CI kernel + bubblewrap/bwrap，完成 runtime-contract #14 三項真機框。
- clean-machine macOS signing/notarization/installer/upgrade/rollback/entitlement evidence。
- 若要擴大 builtin shell sandbox scope，需 maintainer 接受 ADR-0022 變更；本計畫不自行決定。

**不阻塞本地 implementation 的狀態：** 缺少以上環境時固定記 `blocked-auth`、`unavailable` 或 `unsupported`，不以 fake fixture 升格。

**仍需在 Phase 0 對帳的問題：**

1. evaluation 是否移出 `smoke:gap-closure` 後，哪一個獨立 command 成為其正式 operator entry；不改 issue 原本「非 release gate」語意。
2. app-level `runQueue` 與 Pi Host `runs/*` 的邊界是否已在 source/ADR 清楚；若同一 run 兩邊都可 claim，必須先裁定單一 owner。
3. content publish intent 是否直接映射現有 `ScheduledJob`，或由 Host 建立 typed child delivery record；兩者都必須只有一個 due claim owner。
4. early finalization stage ledger 的 durability 應落在既有 Host attachment journal 或另一個既有 durable coordinator journal；不得新增兩份 lifecycle truth。若無法沿用既有 authority，先寫 ADR。

## 8. Dependency frontier

```text
Phase 0
  → Phase 1
      ├→ Phase 2 (spill + external session)
      ├→ Phase 3 (scheduler + content side effects)
      └→ Phase 4 (review #10–#15; fallback fix first)
Phase 1 + Phase 2 + Phase 3
  → Phase 5 (SubDesign/OpenDesign/status)
Phase 1 + Phase 6
  → Phase 7 (full qualification)
Phase 4 + Phase 5 + Phase 6
  → Phase 7
Phase 7
  → tracker/document closeout and release decision
```

不可先做 UI 再補 authority；不可先宣稱 scheduler/publish/review/recovery 完成再補 idempotency；不可用 current working tree、model prose、CLI exit code 或 fixture credentials 冒充歷史、effect或真機證據。
