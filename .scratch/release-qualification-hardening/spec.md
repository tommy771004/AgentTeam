# Release Qualification 與 Repository Hardening

Status: 可交給代理

## Problem Statement

AgentStudio 已有簽章、notarization、Release evidence、Paid Beta qualifier、main-process vault、Pi Core Host authority 與大量 smoke guards，但目前這些能力沒有形成一條一致且 fail-closed 的發布邊界。

最直接的使用者風險是 package matrix 可能在 Paid Beta qualification 與 `release-ready` 之前，先把 manifest 與 installer 上傳至客戶端可取得的更新通道。即使後續資格驗證失敗，未通過的版本仍可能已被下載。`beta`／`stable` 的 channel 值也沒有真正參與發布目的地，不能證明通道隔離。

Packaged-install evidence 另有 schema 漂移：producer 已輸出整理後的 `changePreview`，release-ready consumer 卻仍要求舊 `diffPreview` 與 raw unified-diff headers。這會讓正確隱藏 `diff --git`、`---`、`+++`、`@@` 雜訊的 UI 被 release gate 誤判為失敗。

Credential boundary 也尚未收口。Telegram、Webhook 與 custom-tool credentials 仍可經 legacy flat settings 進入 renderer state、localStorage 或 settings JSON；custom-tool secrets 在 OS-backed encryption 不可用時沒有從 legacy bridge fail closed，解密內容也可能回傳 renderer。這與「raw credential 僅由 Electron main vault 擁有」的安全語言矛盾。

Repository qualification 同樣存在名實落差：純編譯 build 正確維持不執行 smoke／E2E／App launch，但 CI 與 release 沒有另行執行完整 deterministic architecture guards；complexity baseline 使用 `HEAD^` 而非 PR merge-base；只修改 packaged `vendor/pi` 的 PR 不會觸發 blocking CI；macOS 特有風險要等 release 才會被發現。Settings persistence 非原子操作、initial renderer bundle 過大、control-flow hotspots 與 source-text smoke 拓撲也持續增加維護風險。

截至規格建立時，Paid Beta qualifier 仍是 **NO-GO（0/43）**。本 effort 不得把自動 smoke、CLI process success、unsigned local package 或模型文字解讀成 release readiness。

## Solution

建立一條單向、不可跳過的 release promotion lifecycle：

1. Package matrix 只負責編譯、平台簽章、notarization、packaged lifecycle 驗證、建立 signed update manifest，以及把候選 artifacts 上傳到 CI 私有 artifact storage。
2. Deterministic repository guards、平台 evidence 與 Paid Beta qualifier 完成後，`release-ready` 對同一組 immutable artifact hashes 作最後核對。
3. 只有 `release-ready` 產生 verified promotion receipt 後，唯一 publish owner 才能取得 update publish credentials，並發布到明確的 `beta` 或 `stable` channel。
4. 任何 gate failure、evidence schema mismatch、artifact hash mismatch、未知 channel 或缺少 qualification evidence 都保持未發布；重跑必須 idempotent，且不能混用不同 attempt 的 artifacts。

Packaged-install evidence 改採結構化 change presentation contract。Release qualification 驗證使用者確實能看到變更檔案、總增刪行與有界程式碼 preview，但不要求 raw patch headers 出現在 UI 或 evidence。顯示層可移除 Git patch transport 雜訊，仍需保留足以證明真實 change visibility 的 Host-owned evidence。

所有長效 integration credentials 遷入 main-process credential vault。Renderer 只投影 configured state、token hint、vault metadata 與 store/clear intent；raw token 不得進入 UI Projection、localStorage、settings JSON、Turn Record、Pi Host extension metadata 或匯出 bundle。OS-backed encryption 不可用時預設拒絕持久化。

保留 `build` 與 `dist:*` 的 compilation／packaging-only 契約。另設 deterministic qualification command 供 PR CI 與 release packaging 前執行；它不開啟 Electron App、不執行需要互動的真機流程。會啟動 Electron、安裝 package、做 clean-machine 或簽章平台驗證的測試維持在明確的 platform qualification jobs。

以既有 Paid Beta release qualifier 作唯一最高層測試 seam。它不重做下層邏輯，而是核對 update publication、packaged-install evidence、credential vault、deterministic guard 與平台 qualification 等 owning seams 發出的可信 receipts。只有該 rollup 能宣告 release promotion 為 GO。

## User Stories

1. As an AgentStudio 使用者, I want only fully qualified builds to appear in my update channel, so that a failed candidate cannot reach my installation.
2. As a Beta 使用者, I want Beta artifacts isolated from Stable artifacts, so that channel selection cannot silently deliver the wrong risk tier.
3. As a Stable 使用者, I want Stable promotion to require its own verified destination, so that a Beta default cannot become Stable by naming alone.
4. As a release operator, I want packaging to finish before customer-visible upload, so that signing or lifecycle failures leave no partially published release.
5. As a release operator, I want only one publish owner after `release-ready`, so that matrix jobs cannot race or publish independently.
6. As a release operator, I want publication tied to immutable artifact hashes, so that the qualified files are exactly the files uploaded.
7. As a release operator, I want reruns to select one coherent workflow attempt, so that evidence and artifacts from different attempts cannot be combined.
8. As a release operator, I want unknown or missing channels rejected, so that a typo cannot fall back to a public destination.
9. As a release operator, I want failed promotion retryable without duplicate or mixed uploads, so that recovery is safe and auditable.
10. As an auditor, I want a promotion receipt containing commit, channel, artifact hashes and qualification identity, so that release readiness is reconstructable.
11. As an auditor, I want NO-GO preserved when signed-platform evidence is missing, so that unsigned packages are never presented as ready.
12. As a developer, I want packaged-install evidence to follow a versioned schema, so that producer and consumer cannot silently drift.
13. As a user reviewing Agent changes, I want changed files and `+`／`-` counts, so that I can understand the result at a glance.
14. As a user reviewing Agent changes, I want actual changed code beneath a changed-file row, so that「已編輯」is backed by useful content.
15. As a user reviewing Agent changes, I do not want `diff --git`, `---`, `+++` or `@@` headers in the normal UI, so that I see code instead of patch noise.
16. As a release verifier, I want change visibility proven through structured fields, so that presentation improvements do not break qualification.
17. As a maintainer, I want old evidence schemas rejected with a clear migration reason, so that stale evidence cannot satisfy a new release.
18. As a Telegram user, I want my bot token stored only in the main-process vault, so that renderer compromise cannot disclose it.
19. As a Webhook user, I want the shared secret stored only in the main-process vault, so that settings backups contain no reusable credential.
20. As a custom-tool user, I want secret placeholders resolved main-side, so that configuration can render without revealing values.
21. As a user whose OS secure storage is unavailable, I want credential saving to fail clearly, so that plaintext is not written silently.
22. As a user, I want credential metadata and token hints in Settings, so that I can tell whether an integration is configured without reading the secret.
23. As a user, I want clearing or rotating a credential to use an explicit vault operation, so that stale legacy copies are removed.
24. As a user importing or exporting settings, I want raw credentials excluded, so that sharing a bundle does not transfer secrets.
25. As a security maintainer, I want renderer, Turn Record and Pi extension metadata unable to read raw credentials, so that the main-only boundary is enforceable.
26. As a developer, I want `npm run build` to remain compilation-only, so that ordinary builds do not launch the app or run lengthy E2E suites.
27. As a developer, I want `dist:*` to remain packaging-only, so that creating a local installer stays predictable.
28. As a reviewer, I want deterministic architecture guards to run as blocking PR CI, so that ingress and ownership drift cannot merge unnoticed.
29. As a reviewer, I want complexity compared with the PR merge-base, so that earlier regressions in a multi-commit PR are detected.
30. As a Pi Core maintainer, I want vendored runtime changes to trigger blocking CI, so that shipped execution code cannot bypass qualification.
31. As a macOS user, I want minimal macOS PR qualification, so that platform regressions are found before release day.
32. As a maintainer, I want deterministic CI separated from interactive platform qualification, so that fast guards and true evidence stay honest.
33. As a maintainer, I want settings writes atomic and recoverable, so that interruption cannot leave truncated JSON.
34. As a user, I want last-good settings preserved after a failed write, so that configuration survives crashes or disk errors.
35. As a user, I want infrequently used pages loaded on demand, so that the initial renderer starts with less JavaScript.
36. As a maintainer, I want bundle size measured by a repeatable production build, so that lazy-loading is judged by actual payload.
37. As a maintainer, I want high-risk control flow decomposed along existing owners, so that admission, settlement, protocol and CLI changes are safer.
38. As a maintainer, I want behavior tests to cover observable contracts, so that harmless refactors do not fail only because source text moved.
39. As an architecture maintainer, I want essential deletion and ownership guards retained, so that test cleanup does not weaken guarantees.
40. As a contributor, I want unused-code warnings progressively enforced, so that Host modules do not accumulate misleading dead paths.
41. As a plain-browser user, I want documentation to identify it as UI/degraded preview, so that I do not expect production Pi Core execution.
42. As a product owner, I want README, Development State and qualification evidence to share readiness language, so that green build is not confused with Paid Beta GO.

## Implementation Decisions

- Release promotion is an explicit monotonic progression: `candidate → packaged → platform-verified → qualified → release-ready → published`. A missing transition cannot be inferred from filenames, model claims or generic job success.
- Package matrix jobs may upload candidates to CI artifact storage but must not receive customer-facing update publish credentials.
- The publish job is the only remote update-channel writer. It depends on the verified promotion receipt and runs in a protected deployment environment.
- Channel is a closed enum with at least `beta` and `stable`, and participates in public download URLs, upload destinations and evidence.
- Manifest, installer and lifecycle evidence are bound by hashes, workflow run/attempt, commit and version. Promotion rejects mismatches and mixed attempts.
- Publication uploads immutable installers before making the signed manifest visible; the manifest is replaced atomically or through an equivalent server-side promotion.
- Retries are idempotent for one promotion identity. A conflicting hash at an existing version fails closed.
- Packaged-install evidence has an explicit schema version and records visibility, changed-file count, aggregate additions/removals and a bounded structured preview.
- Raw unified-diff headers are transport details, not acceptance criteria. The verifier must not require them in UI or evidence preview.
- Change evidence comes from the trusted packaged runtime or Host-owned review projection; model summaries and arbitrary fixture strings cannot prove visibility.
- Run Review Snapshot and Live Workspace Diff vocabulary remains authoritative. Historical evidence cannot silently fall back to live state.
- Telegram, Webhook and custom-tool credentials become vault records addressed by stable IDs. Flat settings retain only enablement, non-secret configuration and credential metadata/reference.
- Raw credential store, read-for-use, rotate and clear terminate in Electron main. Preload exposes typed intents and metadata, never a raw-token getter.
- Runtime consumers receive credentials main-side at the last responsible moment. Pi Host resources, capability catalogs, Turn Record and UI Projection receive references or redacted metadata only.
- Legacy migration is one-way and idempotent: vault write and verification must succeed before raw fields are removed. Failure reports a blocking migration state rather than duplicating plaintext.
- OS-backed encryption unavailable means persistence refusal by default. The legacy settings path is never a plaintext exception.
- Settings persistence uses temporary write, flush where supported, atomic rename and last-good recovery. Parse failure reports degraded recovery state rather than silently pretending no settings existed.
- `build` and `dist:*` remain compile/package-only public contracts. Repository qualification is separate.
- Deterministic qualification contains architecture ownership, complexity regression, security drift and stable non-interactive smokes; it must not open Electron or require signing credentials.
- Interactive Electron lifecycle, install/uninstall, signing, notarization and clean-machine checks remain platform qualification jobs whose receipts feed the rollup.
- Complexity comparison resolves the PR base SHA and computes a merge-base. PR CI never defaults to `HEAD^`.
- Blocking CI scope includes every shipped runtime and governing contract, including vendored Pi sources and pin metadata.
- macOS PR coverage is the smallest blocking job that honestly tests platform-specific runtime contracts without production signing.
- Route-level lazy loading starts with low-frequency pages. Startup bootstraps and primary conversation stay eager until measurement supports another split.
- Complexity remediation follows existing deep-module owners and extracts pure decisions/side-effect coordinators rather than rewriting whole systems.
- Source-text guards remain only where text shape is itself a deletion/ownership contract. Behavioral semantics move to shipped-module smokes at the highest seam.
- Unused-code enforcement is progressive: remove current warnings, then make unused imports/locals blocking in production scopes.
- Plain-browser documentation states that it is UI/degraded preview without production Pi Core Host guarantees.
- Paid Beta qualifier remains the sole GO/NO-GO rollup. Tracker `resolved` continues to require the project’s one-hop evidence rules.

## Testing Decisions

- The highest seam is the existing Paid Beta release qualifier. It consumes trusted receipts from owning tests and asserts that publication is impossible before every required receipt is coherent.
- A release workflow contract test exercises dependency graph, credential placement, channel resolution and publication order. Package success plus qualification failure must perform zero customer-facing writes.
- A promotion integration fixture uses a local fake update endpoint to verify installer-before-manifest ordering, channel isolation, hash binding, retry and conflict refusal.
- Packaged-install qualification runs against the shipped app and verifies result visibility plus structured change presentation: changed files, additions/removals and code preview, without raw patch-header assertions.
- Evidence tests cover current/old schema, missing fields, forged visibility, mismatched hashes and mixed workflow attempts.
- Credential tests use the main-process vault seam and cover store, metadata, use, rotate, clear, restart and migration while asserting no raw token in renderer payloads, localStorage, settings JSON, exports or Turn Record.
- A safe-storage-unavailable fixture verifies fail-closed persistence and no plaintext legacy settings.
- Settings durability tests inject failure before temporary write completion, before rename and after rename. Restart recovers old or new complete data, never truncated JSON.
- Deterministic qualification is tested as a no-App-launch command. Drift fixtures prove single Task ingress, Pi ownership and collaboration violations fail it.
- Complexity tests use a multi-commit branch with a regression before the tip; merge-base comparison must catch it.
- CI trigger tests cover changes limited to vendored Pi, pin metadata, release contracts, security baseline and authority ADRs.
- The macOS blocking job tests platform runtime behavior without claiming signing/notarization; signed evidence remains release-only.
- Bundle tests use production output and record initial/route chunks. Existing built Electron smoke remains green.
- Control-flow refactors keep behavioral smokes at coordinator, Host protocol and external CLI seams; tests assert outcomes and receipts, not helper names.
- Source-text guards are inventoried as deletion/ownership, API contract or accidental implementation shape. Only the last class migrates.
- Documentation checks distinguish compile success, deterministic qualification, platform qualification and Paid Beta GO.
- Final qualification includes lint, deterministic guards, compile, focused owning smokes, platform evidence rollup and tracker-link health. Full smoke is declared qualification, never an implicit side effect of `build` or `dist:*`.

## Out of Scope

- Obtaining Apple Developer, Windows signing, update-service or external CLI credentials.
- Declaring Paid Beta GO without clean-machine signed installation, N-1→N update, entitlement, workflow and trust-publication evidence.
- Replacing the update hosting provider or building a general deployment platform.
- Rewriting the Task run coordinator, Pi Host Protocol, external CLI runner or entire smoke suite in one effort.
- Changing Pi Core upstream except through the pinned sync and Core Patch Ledger process.
- Moving production execution back into renderer or plain-browser compatibility code.
- Displaying raw Git patch headers in the normal assistant review surface.
- Adding renderer access to credential values for debugging.
- Making `build` or `dist:*` launch Electron or run the full test matrix.
- A full Git client, semantic AST diff or collaborative multi-user review system.
- Treating unused-code cleanup, lazy routes or README polish as blockers for the initial Critical release fix unless they break qualification.

## Further Notes

- Delivery order: evidence schema repair → pre-qualification publish removal/channel isolation → main-vault credential migration → deterministic CI/merge-base/vendor triggers → atomic settings → minimal macOS CI → lazy routes and control-flow/test-topology debt.
- The first releasable slice must fix both the stale `diffPreview` consumer and remote publication order. Fixing only one leaves release blocked or unsafe.
- CI artifact upload is not customer-facing publication. Candidate artifacts may remain available to maintainers while the update manifest stays unavailable to clients.
- The current five complexity regressions and seventeen lint warnings are checkout-specific evidence and may change; the policy requirement remains stable.
- The existing NO-GO record stays authoritative until external signed-platform evidence is captured. This effort enforces that truth; it does not manufacture evidence.
- This spec synthesizes the repository audit and code verification while preserving the compilation-only build contract and Traditional Chinese／English domain vocabulary.
