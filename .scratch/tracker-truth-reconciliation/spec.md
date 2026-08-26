# Tracker truth reconciliation: 追蹤器與文件對齊程式碼現實

Status: 可交給代理

Source: 本 session 的 frontier 排查（五個訊號來源：pi-host-tool-and-skill-parity、pi-agent-runtime-contract、harness-gap-closure、external-cli-durable-harness＋turn-record-fidelity 残留、追蹤器／文件本身）。對帳時發現漂移比排查摘要記載的**更深**：摘要寫「piTurnContext 止血似已部分退場」，實際上技能注入分支已整段移除並在 header 註明由 parity #18 收口；摘要寫 parity「19 張全開」，實際上 19 張票的驗收框幾乎全勾。漂移以天為單位複利——這份 spec 擁有把追蹤器拉回現實的**對帳 pass 本身**，以及防止再漂移的一條明文規則與恰好一支 drift guard。所有功能 effort 都已有 spec，本 effort 不重述任何一個的功能內容。

## Problem Statement

維護者打開 `.scratch/INDEX.md` 想決定下一步做什麼，看到的卻是一張說謊的地圖：

1. **Status 說謊。** pi-agent-runtime-contract 22 張票全部標 `可交給代理`，但每一張都有大量勾選框，#20 更記錄了 2026-08-25 的完成收口（gate 實跑測試檔 99 → 152）；pi-host-tool-and-skill-parity 19 張全標 `可交給代理`，驗收框幾乎全勾（僅 #18 一個 `[~]`）；harness-gap-closure 17 張裡有 10 張勾選框全滿卻仍標 open。
2. **地圖指向不存在的地。** INDEX.md 引用的 `.scratch/subagents-paid-beta/` 與 `.scratch/loop-runner-deepening/` 目錄不存在於檔案系統——後者應已由 remove-legacy-engine（PR #11–13）收口，但索引留著死連結。
3. **敘述停在實作前。** 多份 spec 的問題陳述描述的是動工前的世界（「Host 只有 6 個 builtin tool」「ADR-0034 衝突未解」「builtin shell 長期只能 fail-closed」），而 `electron/piExtensionPacks/` 已有十個 pack、`piTurnContext` 技能注入已退場、seatbelt／bwrap 真機 smoke 已掛進 gate。拿這些敘述做排序或風險判讀會得出錯誤結論——例如把已有真機證據的安全面描述成未驗證。
4. **DEV_STATE.md 凍結在過去。** 檔案停在西元 2026-08-15（mtime 08-17），晚於它的 reattachment 決策（08-26）、Pi Host Protocol v3 attachment persistence、remove-legacy-engine 合併全都未反映。

共同性質：**它不會報錯。** 追蹤器照常渲染、票照常可讀，只是內容與現實脫鉤——與 parity effort 要消滅的「Settings 列的能力叫不動」是同一種靜默失效。後果：排序失真、AFK 代理重做已完成的工作、安全敘述誤導下一個 session、唯一待維護者裁決的懸點（harness-gap-closure #09）被埋在雜訊裡。

## Solution

一次對帳 pass 加兩條長效機制，讓「宣稱」重新等於「證據」：

- **Pass**：逐 effort 以 smoke gate 為唯一證據來源核對——驗收框全滿且其宣稱的 smoke 在 gate 上跑得到 → Status 翻 `resolved`，並在該票 Comments 記下證據連結；敘述過期的 spec 在頂部補一段對帳日期與現況註記；死連結修復或如實改記。
- **規則**：`resolved` 的定義寫進 `docs/agents/`——Status 可翻 resolved，唯當（a）其引用的 smoke 檔在 gate 上且綠，或（b）該票本質是非程式碼決議（ADR accepted、維護者裁決）並留下決議連結。
- **Guard**：恰好一支新 drift guard——`.scratch/INDEX.md` 內每一個相對路徑引用必須存在，掛進 `npm run smoke`。早就有它能抓到那兩個死目錄。

完成後：INDEX 的 frontier 是可信的指令；代理不會重做已 ship 的工；決策懸點以顯式佇列呈現；DEV_STATE 反映今天。

## User Stories

1. As a maintainer, I want INDEX.md's Active frontier to list only efforts whose Status matches code reality, so that 「implement next」是一條可信的指令而不是猜謎。
2. As a maintainer, I want a ticket's Status to flip on the same evidence that checked its last box, so that bookkeeping never lags the work by days.
3. As a maintainer, I want every path referenced from INDEX.md to exist, so that following the map never dead-ends.
4. As a maintainer, I want pending maintainer-decision items (like the builtin-shell sandbox scope ADR) surfaced as one explicit queue, so that 待分流 is a visible docket rather than buried rows.
5. As a maintainer, I want DEV_STATE.md refreshed at effort boundaries, so that the next session starts from today rather than eleven days ago.
6. As an AFK agent picking up a ticket, I want open tickets to be genuinely undone work, so that I never re-implement something already shipped and qualified.
7. As an AFK agent, I want each resolved claim to cite a named, gate-reachable smoke, so that my qualification bar is checkable instead of narrative.
8. As an AFK agent, I want spec narratives annotated when reality has moved past them, so that I don't trust a problem statement that describes a pre-implementation world.
9. As a reviewer, I want to audit any 「resolved」 from claim to evidence in one hop, so that sign-off is verification rather than reading prose.
10. As a contributor, I want the build to go red when I add a dead path to INDEX.md, so that link rot is caught at authoring time, not discovery time.
11. As a contributor, I want the build to go red when I delete or rename a directory INDEX.md still references, so that structural moves carry their bookkeeping with them.
12. As a contributor, I want a new ungated test file to keep failing the build via the existing gate-reachability guard, so that no second orphan-smoke debt can accumulate.
13. As a maintainer returning after a break, I want the deliberate `[~]` residuals (turn-record-fidelity seam-1 real-CLI assertion、trajectory 視窗虛擬化、parity #18) still marked and explained, so that known gaps are never silently closed or forgotten.
14. As a maintainer, I want the two dead directory references replaced with truthful fate notes, so that the history (loop-runner-deepening closed by remove-legacy-engine) survives without a broken link.
15. As a maintainer, I want the subagents-paid-beta #14 residual (the only unfinished P0) to remain tracked even though its directory vanished, so that a tracking fix never loses a release blocker.
16. As an AFK agent working on external-cli-durable-harness, I want its seven tickets verified as genuinely open, so that my scheduling estimate reflects untouched work rather than hidden progress.
17. As a security-minded reader, I want the builtin-shell story stated with its real evidence status (real-turn denial qualification green; seatbelt/bwrap tracers on the gate), so that risk assessments use facts instead of stale fail-closed framing.
18. As a security-minded reader, I want ADR-0034 compliance described as it is (renderer skill injection removed), so that a settled conflict is not re-flagged as open.
19. As a new session (fresh context), I want INDEX.md plus DEV_STATE.md to reconstruct the true frontier within minutes, so that onboarding does not depend on tribal memory.
20. As a maintainer, I want the Status-flip rule written once in `docs/agents/`, so that every future effort applies the same bar without renegotiation.
21. As a contributor starting a new effort, I want the conventions doc to tell me when to update INDEX.md and DEV_STATE.md, so that my effort is born reconciled.
22. As a maintainer, I want reconciliation edits confined to tracker/docs/script files, so that this effort cannot change product behavior even by accident.
23. As a maintainer, I want the reconciliation itself to be reviewable as normal Markdown diffs, so that truth-restoration has the same review bar as code.
24. As an AFK agent, I want the guard's failure message to list the exact offending paths, so that I can fix a red build without reverse-engineering the checker.
25. As a maintainer, I want the guard to skip nothing and exempt nothing (no allowlist), so that the INDEX cannot grow a silent exception pile.
26. As a reviewer, I want each per-effort reconciliation recorded as Comments on that effort's own ticket, so that the reasoning trail lives beside the work it vouches for.
27. As a maintainer, I want checkbox state to remain a human/agent judgement rather than inferred automatically, so that a checked box awaiting qualification is never auto-promoted to resolved.
28. As a maintainer, I want exactly one evidence mechanism (the gate-reachability set), so that claims are judged against a single oracle instead of competing ledgers.
29. As a contributor, I want the INDEX guard to live inside the existing smoke chain, so that no new test infrastructure or runner is introduced.
30. As a product owner, I want prioritization made on a truthful map, so that effort sequencing decisions stop being distorted by stale labels.

## Implementation Decisions

**Scope is the five signal sources, one reconciliation ticket each.** pi-agent-runtime-contract、pi-host-tool-and-skill-parity、harness-gap-closure、external-cli-durable-harness（含 turn-record-fidelity 兩處 `[~]` 残留的核對）、追蹤器／文件本身（INDEX.md＋DEV_STATE.md＋`docs/agents/` 規則）。每張對帳票的產出是：翻正的 Status、補註的 spec、Comments 裡的證據清單。

**One evidence oracle.** 宣稱的唯一裁判是既有 gate-reachability 機制展開出的測試檔集合（`npm run smoke` / `build` / `dist*` 實際執行的腳本）。某票引用的 smoke 必須在該集合內；在 `KNOWN_UNGATED_TESTS` 清單上等於沒有證據。本 effort 不建立第二個證據登記簿。

**The rule lands in `docs/agents/triage-labels.md`.** `resolved`（及 INDEX 的 effort-level Status）的定義補一句：需指名一支 gate 上的綠 smoke，或本質為非程式碼決議者需連結決議文件。同處補上 DEV_STATE 於 effort 收口時更新的紀律。這是流程文字，不是新工具。

**Spec annotation, not rewrite.** 對已落後的 spec（問題陳述過期者），在頂部加一段帶日期的「對帳註記」說明哪些段落已成歷史、現在的真相與證據何處可查；原文保留——問題陳述是當時決策的紀錄，不是被竄改的對象。

**INDEX.md rewrite rules.** 只引用存在的路徑；消失的目錄以文字註記其下場（含收口 PR），不留死連結也不丟失資訊；subagents-paid-beta #14 的追蹤殘餘遷入「Remaining blocked」文字區（對帳票負責自 git 歷史查明目錄去向後裁決還原或遷記）；harness-gap-closure #09 以顯式「待維護者裁決」條目呈現，本 effort 不代答其內容。

**`[~]` is a record, not a debt to close.** 所有刻意未完成項（seam-1 真 CLI 斷言、TrajectoryPanel 虛擬化、parity #18 的 migration-report 渲染缺口）保持 `[~]`，對帳只把它們彙整為 INDEX 上的 known residuals，確保可見。

**One new drift guard, house style.** 一支 source-text guard：解析 INDEX.md 的相對路徑引用，逐一驗存在；任一不存在即 build 失敗，訊息列出完整路徑。無豁免清單。掛進既有 smoke chain，不引入新 runner 或 loader dependency。

**No product surface changes.** 變更僅限 `.scratch/**`、`docs/agents/**`、`DEV_STATE.md`、與那支 guard 腳本及其 package.json 接線。不動 `app/src`、不動 protocol、不需新 ADR——本 effort 是流程修復，所有技術爭議（如 builtin-shell sandbox 範圍）都只被**指出**，不被裁決。

**No automation of judgement.** 不做 checkbox↔Status 推論器、不做 spec 內容與程式碼的自動比對。機器守可機器驗的不變量（路徑存在、測試上gate）；判斷（「這張票真的做完了嗎」）永遠是人或代理對著證據下的結論。

## Testing Decisions

**What a good test is here.** 只測 guard 的外部可觀察行為：給它一個會說謊的輸入，build 必須紅；給它誠實的輸入，必須綠。不測 markdown 解析的內部形狀，不測「文件寫得好不好」——那是人審的範圍。

**What gets tested.**
- 新增 guard：fixture 一個含不存在相對路徑的索引 → 失敗且訊息列出該路徑；全部存在 → 通過；引用目錄而非僅檔案也驗存在（死目錄正是這次的案例形態）。
- 既有 gate-reachability guard 維持雙向斷言（新孤兒測試檔 → 紅；上gate 後未從 `KNOWN_UNGATED_TESTS` 移除 → 紅），本 effort 只消費其輸出，不修改其語意。
- 整體 qualification（最後一張票的人工可核清單）：INDEX 每個 `resolved` 列都能在一 hop 內指到 gate 上的綠 smoke；零死路徑（guard 保證）；DEV_STATE 日期等於對帳日；五個訊號來源各有對帳 Comments。

**Prior art.**
- `check-pi-contract.mts` 的 `KNOWN_UNGATED_TESTS` 模式——「列出、不是豁免」與雙向斷言是新 guard 的行為範本。
- 各種 source-text drift guard（frozen renderer seam、second-timeline 禁令）——「守衛對準擁有者、搬移時改指向而不弱化」的房法。
- `smoke-release-qualification.mts` 的 fail-closed No-Go——qualification 清單不通過就不宣告完成的模式。

## Out of Scope

- **裁決 harness-gap-closure #09** 的內容（builtin shell 是否納入 ADR-0022 sandbox 義務）。那是維護者判斷，本 effort 只讓它在 INDEX 上無所遁形。
- **任何功能 effort 的實作**：external-cli durable harness 的七張票、harness-gap-closure 其餘未完成票、parity 的功能殘項等，各歸其 spec；對帳不改變它們的驗收條件。
- **自動化狀態推論**（checkbox 掃描器、spec-vs-code diff 檢查）——刻意不做，見 Implementation Decisions。
- **遷離本地 Markdown 追蹤器**或引入真正的 issue tracker 服務。
- **paid-beta #14 的真機簽署證據**——本質需人工，維持 `blocked-pending-real-signed-platform-evidence`。
- **重新辯論任何已接受的 ADR**（ADR-0022/0027/0028/0034/0038/0045/0047 等）。對帳引用它們的現狀，不翻案。
- **把 checkbox 變成機器權威狀態**、或為 `.scratch` 建置任何 schema 化的資料模型。

## Further Notes

- 本次排查的已驗證事實（對帳票可直接引用）：runtime-contract 22/22 標 open 但 #20 記錄 2026-08-25 完成、gate 測試檔 99→152；parity 19/19 標 open 但驗收框幾乎全勾、`electron/piExtensionPacks/` 已有十個 pack、`piTurnContext` 技能注入分支已移除；harness-gap-closure 17 張中 10 張框全滿仍標 open、#09 為真實 `待分流`；external-cli-durable-harness 七張確實全未動（x=0）；turn-record-fidelity #11 為 done 含刻意 `[~]`；INDEX 引用的兩目錄不存在；DEV_STATE mtime 2026-08-17、header 2026-08-15，而 reattachment decision.md 日期 2026-08-26。
- 最有力的動機紀錄：**連這次排查摘要自己都在幾天內過期了**（「止血部分退場」實為完全退場、「全開」實為近乎全完成）。這正是「翻牌需附證據」規則要終止的複利模式。
- 拆票建議：01 為規則文件＋新 guard（先行，guard 紅即示範價值）；02–06 五張 per-effort 對帳可並行（互不相依，各自以 01 的規則為據）；07 收口——重寫 INDEX＋DEV_STATE＋跑整體 qualification 清單。
- 本 effort 完成的判定極簡：**照著 INDEX 做下一個決定時，不需要懷疑它。**
