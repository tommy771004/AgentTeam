# 程式關聯性與實作修改報告

## 1. 報告範圍

- **分析範圍：** `4404d04^..HEAD`
- **HEAD：** `5245cf0`（`20260828-2`）
- **涵蓋 commits：** 10 個
- **產品程式：** `app/`
- **Pi Core：** `vendor/pi/`
- **累計變更量：** 1,015 個檔案；約 `+83,918 / -23,438` 行。其中 `app/` 約 97 個檔案，`vendor/pi/` 約 880 個檔案。

本報告只分析已提交的 commit。分析時工作樹另有未提交的
`app/scripts/smoke-recovery-e2e.mjs` 及未追蹤 session memory 檔，未納入本報告。

## 2. 整體結論

這批變更不是單一功能，而是三條主線同時落地：

1. **Verified Working Memory：** 將 Working State、Skill invocation、Checker、Memory-Control Package 與 Turn Record 串成 Host-owned、可驗證的控制層。
2. **Pi Core runtime cutover：** 將 Pi 升級至 v0.84.3，並維持 Electron utility process 作為唯一 production tool loop owner。
3. **桌面產品化：** 修正 GUI 啟動時的 user shell/PATH、重新命名為 AgentStudio，並調整主側欄與 release metadata。

目前的主要架構方向是正確的：renderer 只做 projection，Pi Host 才能執行、核准、產生 evidence、提交 Working State 與 settlement。可是「candidate promotion 必須經 evaluation gate」及「evaluation report 不可被偽造」目前仍不是完全由程式硬性保證。

## 3. Commit 變更總表

| Commit | 主要目的 | 主要程式關聯 |
| --- | --- | --- |
| `4404d04` | 建立 Memory-Control Package candidate lifecycle | `memoryControlPackage.ts`、`memoryControlPackageRepository.ts`、`piHostProtocol.ts` |
| `aabd7f4` | 加入 baseline/candidate evaluation gate 與持久化 report | `memoryControlEvaluationGate.ts`、`memoryControlEvaluationContract.ts`、repository settlement |
| `720a0ec` | 固化 builtin / external CLI runner capability matrix | `runners/types.ts`、`runDispatch.ts`、`agentStore.ts`、Inline/Records projection |
| `97d9392` | 限制 Meta-Agent 只能從結構化 trace 產生 candidate | `memoryControlMetaAgent.ts`、Host candidate-only adapter |
| `179a8e5` | 將 verified lifecycle 接入 smoke 與 ownership drift guards | `smoke-verified-memory-lifecycle-qualification.mts`、`package.json` |
| `caa3c5c` | 加入 memory lifecycle spec 與 Sidebar design input | `docs/specs/memorylifecycle.md`、`docs/ui/Sidebar Nav.md` |
| `4472cd1` | 統一 Hermes Desktop typography | `index.css`、PDF/OAuth/MCP sandbox HTML |
| `75c0339` | 升級 Pi 至 v0.84.3，補 runtime 與 memory provenance | `vendor/pi/`、Pi build/sync scripts、Host memory/runtime |
| `4397d71` | 恢復 GUI 啟動時的 user shell、PATH 與可配置路徑 | `userEnvironment.ts`、`main.ts`、`shellBridge.ts`、`ptyBridge.ts` |
| `5245cf0` | 產品改名 AgentStudio，保留舊資料目錄並調整 sidebar | `app/package.json`、`main.ts`、`App.tsx`、`Layout.tsx`、release workflow |

## 4. Production execution call graph

```text
UI / scheduler / webhook / Telegram / delegate / SubDesign
                         │
                         ▼
              taskRunCoordinator.runTask()
          admission → capacity → thread bind → snapshot
                         │
                         ▼
              runDispatch.dispatchThreadTask()
                 ┌───────┴────────┐
                 │                │
          runner=builtin    runner=external CLI
                 │                │
                 ▼                ▼
      agentStore.startExecution()  startLocalCliExecution()
                 │
                 ▼
      preload → Electron main → PiHostSupervisor
                 │
                 ▼
          utility process pi-host.js
                 │
                 ▼
        piHostProtocol.turn/submit
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
 package      Pi Core     Turn Record /
 admission    session     Attachment Journal
      │       + tools          │
      ▼          │             ▼
 runtime      piToolHost   session/archive projection
 compile      policy/hooks
                 │
                 ▼
             tool execution
                 │
                 ▼
 taskRunCoordinator.finalizeTaskRun()
 summary → afterRun → Archive → onSettled → release → drain
```

### 4.1 關聯責任

| 層 | Owner | 輸入 | 輸出 |
| --- | --- | --- | --- |
| Task lifecycle | `app/src/agent/taskRunCoordinator.ts` | 所有 run ingress | capacity、thread、dispatch snapshot、唯一 finalization |
| Runner adapter | `app/src/agent/runDispatch.ts` | immutable snapshot | builtin Host turn 或 external CLI result |
| Renderer projection | `app/src/store/agentStore.ts` | Host settlement / CLI result | Zustand run state、archive view |
| Pi Host boundary | `app/electron/piHostSupervisor.ts`, `piHostEntry.ts` | IPC/JSONL request | supervised utility process、restart/recovery |
| Tool loop | `app/electron/piCoreRuntime.ts` + vendored Pi | Host-admitted settings/session | model calls、tool events、step settlement |
| Tool policy | `app/electron/piToolHost.ts` | frozen run policy、contract | approval、deny、execution evidence、tool audit |
| Durable authority | `app/electron/*Store.ts` | Host calls | SQLite memory、JSON package lineage |

## 5. Verified Working Memory 資料流

```text
workingGoal / delegated goal
          │
          ▼
createInitialWorkingState()  ──> revision 1
          │
          ▼
model tool draft
          │
          ├─> state-proposal（model/host）
          ├─> tool-call / approval / tool-evidence
          └─> tool-result + non-model executionEvidence
                                      │
                                      ▼
                         checkWorkingStateProposal()
                                      │
                         accepted / rebased / rejected
                                      │
                                      ▼
                         working-state revision + 1
```

關鍵關係如下：

- `app/src/agent/workingState.ts` 只提供 vocabulary、schema guard、pure Checker；沒有 bridge 或 Host mutation authority。
- `app/electron/piToolHost.ts` 包裝 Pi builtin `write`，先執行再 read-back，產生 `receiptDigest` 與 `evidenceId`。
- `app/electron/piHostProtocol.ts` 的 `commitCheckedWorkingState()` 將 exact tool result 與 proposal 綁定，不能用 model text 取代 evidence。
- `revalidateCompletedGoals()` 在後續 iteration 再 hash file-content predicate；檔案被外部或 sibling tool 改變時，已完成 goal 會退回 `pending`。
- `app/src/agent/turnRecord.ts` 以 v11 append-only record 保存 `working-state`、`state-proposal`、`state-check`、`tool-result`、`tool-evidence` 與 package identity。
- `workingStateProjection.ts`、`workingStateProjectionStore.ts`、`WorkingStateView.tsx` 只從 Host record/snapshot 投影；revision 單調遞增，tombstone 不可被 renderer resurrect。

## 6. Memory-Control Package lifecycle

### 6.1 Package 與 runtime

`app/src/agent/memoryControlPackage.ts` 定義四個可演化 component：

- `experientialSkills`
- `workingMemorySpec`
- `invocationPolicy`
- `checkers`

`app/electron/memoryControlPackageRepository.ts` 是實際 JSON authority：

```text
baseline active revision
        │
        ├─ createCandidate(JSON Patch + expectedActiveRevision)
        │       └─ candidate-created event
        │
        ├─ settleEvaluation(report)
        │       ├─ candidate-rejected event
        │       └─ candidate-activated event
        │
        └─ rollback(validated historical revision + CAS)
```

每個 component 及 package 都有 digest；未被診斷的 component 必須保留 parent digest。repository 同時負責：

- JSON Patch path、prototype-pollution token、大小與深度限制。
- atomic write、process lock、dead/stale lock recovery。
- package lineage、event sequence、status projection 驗證。
- evaluation report package binding、run pairing、report digest 驗證。

`app/electron/memoryControlRuntime.ts` 將 JSON policy 編譯成有限的 executable runtime，禁止 package JSON 直接攜帶程式碼；`piHostProtocol.ts` 在 turn admission 時呼叫：

```text
admitMemoryControlEvaluationPackage()
        → memoryControlPackageIdentity()
        → compileMemoryControlRuntime()
        → ActiveTurnRecorder.governingPackage / memoryControl
```

因此一個已開始的 run 不會被後續 activation 改寫；新的 package 只會影響下一個 run。

### 6.2 Evaluation gate

`app/src/agent/memoryControlEvaluationGate.ts` 的 canonical flow：

```text
seal corpus（expected outcome 留在 WeakMap）
        │
        ▼
createCanonicalMemoryControlEvaluationExecutor()
        │
        ├─ baseline package
        │    runEvaluationBatch()
        │      → runHeadlessTask()
        │        → taskRunCoordinator.runTask()
        │
        └─ candidate package（同一 corpus、順序執行）
             runEvaluationBatch() ...
        │
        ▼
project observations → metrics / reasons → reportId
        │
        ▼
Host settleEvaluation()
```

評估包括 task success、false-done、required-action recall、Skill invocation precision/reach 與 prompt token budget。source-failure 必須改善，held-out anchor 不得失敗，candidate 的 DoD/evidence 必須完整。

### 6.3 Meta-Agent

`app/src/agent/memoryControlMetaAgent.ts` 只接受已持久化且無 torn tail 的 Turn Record，並從 Host-authored entries 定位四類 signal：

- Skill redraft 之後仍失敗 → `experientialSkills`
- accepted state check 但 goal 未完成 → `workingMemorySpec`
- `pass-through` 且 match count 為零後失敗 → `invocationPolicy`
- 有 execution evidence 但 Checker reject → `checkers`

`executeMemoryControlMetaMaintenance()` 再以只含 `createCandidate()` 的 candidate-only authority 呼叫它；沒有 activate/reject/settle API。patch 只能是 schema 宣告過的 bounded `replace`，且只能修改單一被診斷 component。

## 7. Runner capability 關聯

`app/src/agent/runners/types.ts` 現在是 runner capability 的單一來源：

| Runner | DoD / iterate | Working State | Skill preflight | Checker | UI guarantee |
| --- | --- | --- | --- | --- | --- |
| builtin | 支援 | Host verified | 支援 | 支援 | `host-verified` |
| external CLI | 不支援 | 不宣稱 | 不宣稱 | 不宣稱 | `reduced` |
| 無 Host / 無 snapshot | 不可用 | 不可用 | 不可用 | 不可用 | `unavailable` |

`turn-start` 將 builtin runner 與 capability snapshot 寫入 Turn Record；`agentStore` 將 snapshot 保存到 run/archive；`InlineRunPanel.tsx` 與 `RecordsPage.tsx` 透過 `projectRunnerCapabilitySnapshot()` 顯示歷史保證，不依賴目前 Settings。

External CLI 的 `continueGoal` 是例外：`runners/types.ts` 只允許透過明確 prompt contract 傳遞 objective、DoD、missing、prior digest；CLI 成功不等於 builtin DoD met。

## 8. Durable Memory 關聯

`app/electron/piDurableMemory.ts` 把 durable memory 暴露給 Pi pack，但不把 SQLite authority 帶入 renderer：

```text
Pi memory tool
   │
   ▼
createPiDurableMemoryBridge()
   │
   ├─ search → DurableMemoryStore.recall()
   └─ get    → DurableMemoryStore.getSnapshot()
                    │
                    ▼
             metadata-only memory-recall entry
```

`sqliteDurableMemoryStore.ts` 新增 `getSnapshot()` 與 transaction-bound read，確保 entry body/provenance revision 來自同一 SQLite snapshot。Turn Record 只保存 item id、logical key、scope、kind、revision，不保存長期記憶正文。

Memory-Control package repository 則完全獨立於 durable-memory SQLite；`piHostEntry.ts` 明確分開兩者，避免 memory CRUD、migration、export/import 變成 package authority。

## 9. Pi v0.84.3 升級關聯

`75c0339` 是此次變更量最大、風險最高的 commit：923 個檔案，約 `+80k/-23k`。主要結構變更：

```text
packages/storage/sqlite-node
          │
          └─> packages/session-backends/sqlite-node

新增 runtime workspace：
telemetry、protocol、client
          │
          ▼
Pi coding-agent / server / session runtime
          │
          ▼
app/electron/piCoreRuntime.ts deep-import + dynamic import
```

配套修改：

- `build-pi-vendor.mts` 改用新的 workspace build order。
- `piBuildWorkspaceLinks.mts` 重建 staging workspace links。
- `sync-pi.mts` 改讀 `packages/coding-agent/package.json` 的 release version。
- Pi source archive 以固定 asset SHA-256 hydrate model data，再執行 `build:offline`。
- `PI_UPSTREAM_PIN.json` 固定 v0.84.3、commit、archive checksum、tree hash。
- `PI_CORE_PATCH_LEDGER.md` 保留 Electron Host、session binding、tool policy 等產品 adapter 差異。

產品實際 runtime 仍依賴 `vendor/pi/packages/coding-agent/dist/core/auth-storage.js` 這類非 package export deep import；這是每次 Pi 升級都必須單獨驗證的 compatibility point。

## 10. GUI environment 與產品化變更

### 10.1 User environment

`app/electron/userEnvironment.ts` 統一處理：

- `~` path expansion。
- `SHELL` / `COMSPEC` 選擇。
- GUI 啟動時從 account login shell 捕捉 PATH。
- merge login PATH 與 inherited/explicit PATH，並保留去重。

關聯路徑：

```text
main.ts PiHostSupervisor env
        │
        ├─ piUserConfig / piSkills path resolution
        ├─ shellBridge child process environment
        └─ ptyBridge interactive shell environment
```

`cliDiscover.ts` 移除固定 `/usr/local/bin`、`/opt/homebrew/bin` 掃描，改依使用者 shell/PATH；這降低固定機器假設，但也讓 login-shell PATH recovery 成為 CLI discovery 的重要依賴。

### 10.2 AgentStudio rename / sidebar

`5245cf0` 將產品 user-facing identity 從 SubAgents AI 改為 AgentStudio，涵蓋：

- `app/package.json` description/author/productName。
- Electron window、tray、notification、OAuth callback、PPTX metadata。
- renderer notifications、prompt copy、release/update evidence 與 CI labels。
- `Layout.tsx` 將 sidebar collapse 移到 header，移除原本 footer toggle。

為避免升級後變成 clean install，`main.ts` 在 packaged mode 將預設 `userData` 固定回舊的 `SubAgents AI` 目錄；`appId` 與 npm package name 仍保留舊值，這是相容性而非漏改。

## 11. 驗證與證據

已提交的驗證入口包括：

- `smoke:verified-memory-lifecycle`：8 個 real workflow 加 ownership/gating guards。
- `smoke:pi-host`：Host protocol、session、tool、Skill、Working State、record、restart、packaging 等 smoke。
- `smoke:platform`：GUI login shell、PATH、user path expansion。
- `smoke:runner-contract`：runner capability matrix。
- `smoke-memory-control-evaluation-gate.mts`：candidate behavior、token regression、promotion、rollback。
- `release-evidence/pi-host-qualification.json` 與 `pi-sync-release-record.json`。

但是：

- `pi-sync-release-record.json` 是 `75c0339` 產生的歷史證據；之後仍有 `4397d71`、`5245cf0` 修改，不能視為 current HEAD 的完整 release qualification。
- `qualify-pi-sync.mts --all-gates` 目前只是把 gate booleans 設為 true，不會自行執行 gate。
- 本次分析環境沒有 `node`/`npm`，因此無法重跑 `npm run build` 或 smoke。
- `git diff --check` 對近期 commit 曾報 trailing whitespace，主要位於 `.gitignore` 與 qualification 文件。

## 12. 風險與建議

### 高優先

1. **Direct activation 仍可繞過 evaluation gate。**
   `memoryControlPackageRepository.ts` 仍公開 `activateCandidate()`，Host maintenance 也接受 `activate-candidate`。只要有 maintainer token，結構合法的 candidate 可以不經 `settleEvaluation()` 直接啟用。若 promotion 必須 gate，應移除 direct activation，或改成 emergency path 並要求已持久化、綁定 candidate 的 evaluation report。

2. **Host settlement 沒有重新計算 evaluation semantics。**
   `validateEvaluationReport()` 驗證 schema、digest、package identity 與 run pairing，但沒有從 runs 重新計算 `metrics`、`reasons`、source improvement 或 held-out success。知道 maintainer token 的 caller 可以重新計算 `reportId` 後提交邏輯上不一致但格式合法的 promoted report。建議由 Host 重算，或使用 Host 內部不可偽造的 evaluation claim/簽章，而不直接信任 caller 傳入的 report。

3. **Pi 升級的 deep import 與 runtime artifact coupling。**
   `piCoreRuntime.ts` 直接載入 `dist/core/auth-storage.js`，而 workspace layout、server/client/session backend 也大幅變動。應在 release pipeline 固定執行 packaged cold-start、OAuth、session migration、restart/recovery、builtin tool 與 Windows native binary qualification。

### 中優先

4. **Pi model data 的 reproducibility 還不完整。**
   `piVendorTree.mts` 排除 `packages/ai/src/providers/data`，build cache 也不含其 checksum；只要現有 model data 能通過 offline build，就可能使用未經 pin archive 驗證的舊資料。建議把 model-data manifest checksum 納入 cache/pin，或每次 build 強制使用 pinned snapshot。

5. **Checker 可被 package 設為 disabled。**
   `memoryControlRuntime.ts` 將 `fileContent`、`delegatedGoal` 的 `0` 解讀為停用；meta patch 雖有限制，但一般 candidate/`activate-candidate` 路徑仍可建立此設定。若 Checker 是不可退讓的安全 invariant，應在 runtime compile 與 settlement 同時禁止 `0`。

6. **Evaluation trace 上限與 corpus 上限不一致。**
   corpus 最多 100 tasks，但 report 只保留最多 64 個 runs（baseline + candidate）。超過 32 tasks 時，report 可能在 evaluator 產生，卻因 `assertEvaluationRunPairing()` 看見不完整 pair 而無法 settlement。應將 corpus 上限降至 32，或改用完整 run pairing / 分頁 trace。

7. **User environment 的同步 shell probe 可能阻塞 main process。**
   `buildUserEnvironment()` 第一次遇到新 shell/home/PATH 組合時會 `spawnSync()`，timeout 可達 4 秒；若由頻繁的 shell/CLI IPC 呼叫觸發，可能造成 Electron main UI 或 IPC 延遲。建議改非同步預熱、背景 cache，或設定明確 timeout/degraded telemetry。

### 低優先

8. **品牌字串仍有刻意與非刻意混用。**
   npm package name、appId、舊 userData path 是相容性設計；但 `app/.tmp-asar-check/package.json`、歷史文件及 `ptyBridge` 的 `SubAgents terminal` 仍保留舊名稱。應標註 intentional legacy，並清理真正會出現在使用者介面的殘留字串。

9. **格式品質。**
   清除近期 commit 的 trailing whitespace，避免嚴格 lint/CI 因非功能性格式失敗。

## 13. 建議後續實作順序

1. 將 promotion authority 收斂成 `settleEvaluation()`；封鎖或隔離 direct `activateCandidate()`。
2. 在 Host 端重算 evaluation report 的 metrics/decision，並將 corpus identity、expected answer key 與 report binding 一起驗證。
3. 將 model-data checksum 納入 Pi build cache 與 release evidence。
4. 補跑 current HEAD 的 build、完整 smoke、macOS/Windows packaged cold-start/restart/OAuth。
5. 最後再清理品牌 legacy 字串與 trailing whitespace。
