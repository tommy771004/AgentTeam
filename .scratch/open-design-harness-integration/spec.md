# Integrate Open Design harness contracts into SubDesign

Status: 可交給代理

Source: `docs/research/open-design-harness-integrations.md`（2026-08-20 對 `nexu-io/open-design` 與近三個月相關 GitHub repositories 的研究）。

## Problem Statement

SubDesign 已能載入 OpenDesign templates、執行五階段設計生命週期、預覽與匯出 artifacts，但目前的 OpenDesign catalog 仍主要把 plugin 當成模板資料。它尚未完整表達 upstream Open Design harness 的關鍵契約：版本化 manifest、pipeline stages、能力需求、安裝快照、可撤銷授權、evaluation、typed interactive surfaces，以及外部 context/evidence providers。

因此使用者會遇到四個產品層問題。

第一，plugin 能被看到或複製，不代表它能安全且可重現地執行。產品沒有一致呈現 plugin 版本、來源 commit、內容 hash、能力需求與實際授權；同一個 plugin 在不同時間解析成不同內容時，也缺少可稽核的 resolved snapshot。

第二，SubDesign 生成 UI 時無法穩定取得專案真實的 component stories、controls 與文件，Critique 階段也主要依靠視覺預覽，缺少 console、network、performance、goal completion 與 friction 等由可信 adapter 產生的 Execution evidence。模型可能聲稱設計可用，但使用者沒有足夠證據判斷。

第三，執行中的選擇、表單與確認仍主要是文字對話。上游 MCP Apps 已提供 sandboxed inline UI 協定，但本產品尚未有符合 Pi Core 權限與 token 邊界的 host-side surface。直接把第三方 HTML 放進 Electron renderer，或讓 iframe 直接呼叫工具，都會破壞現有安全模型。

第四，若逐一為 Storybook、Chrome DevTools、Harness 或 streaming UI 建立特例，SubDesign 會形成第二套 orchestration。這會違反 Task run 的單一 ingress、Pi Core tool loop 的 ownership、ADR-0045 的 removable seam，以及 ADR-0048 對 Execution evidence 的要求。外部 command 成功也可能被錯誤等同於 Goal-based DoD met。

## Solution

在現有 OpenDesign catalog、SubDesign lifecycle、Task run coordinator、Pi Core capabilities、artifact manifest 與 UI Projection 上，建立一個相容 upstream Open Design 思想、但由 AgentTeam 擁有的 **OpenDesign Plugin Contract v1 subset**。

Plugin contract 表達 spec version、task kind、mode、inputs、pipeline stages、capabilities、evals、preview 與 provenance。安裝或採用 plugin 時產生 project-relative resolved snapshot，記錄來源、版本或 commit、hash 與 capability grants。舊 plugin 在沒有新欄位時保持可用；未知主版本、未知 capability 或 malformed pipeline 則 fail closed，並在 UI 顯示可理解的原因。

所有可執行 plugin stage 仍以 Task run 進入，並由 Pi Core tool loop 擁有 tool execution、approval、cancel 與 settlement。SubDesign lifecycle 負責階段狀態，不自行 spawn CLI/MCP。renderer 與 inline UI 只處理結構化 projection，不能讀取 raw connector token、直接開網路或繞過 tool gate。

建立內部 provider contracts，把第三方系統輸出正規化為產品擁有的 context、evidence、interactive surface 或 streaming artifact envelope。第一批 providers 為：

- Storybook：提供 component stories、metadata、controls 與 docs 的唯讀 context evidence。
- Chrome DevTools：提供 console、network 與 performance critique evidence。
- Harness：提供 goal result、replay steps、screenshots 與 friction events，且可由 Stop targeted cancel。
- MCP Apps：先支援 direction choice、form 與 confirmation，透過 sandboxed iframe 和 schema-validated host bridge 工作。

OpenGenerativeUI 僅作 streaming contract 與 sandbox bridge 的設計參考，不引入 LangGraph、CopilotKit 或第二套 agent runtime。Playwright MCP 暫不建立重複的長駐 browser loop。TypeUI 在授權與資料條款明確前不 vendoring、不複製內容，也不成為官方 pack dependency。

最高層測試 seam 是一個從 SubDesign 發起、經 Task run coordinator admission 的完整 Task run。測試使用 fake external provider，驗證 plugin resolution、grant enforcement、pipeline stage、Pi Core tool execution、activity projection、Execution evidence、artifact、cancel 與 settlement。較低層 smokes 只驗證 malformed contract、registry drift、path confinement 與 renderer sandbox，不重複整個生命週期。

## User Stories

1. As a SubDesign user, I want every OpenDesign plugin to declare a supported contract version, so that I know whether the application can execute it correctly.
2. As a SubDesign user, I want existing legacy plugins to remain selectable, so that adopting the new contract does not remove my current templates.
3. As a SubDesign user, I want an unsupported plugin version to show a precise compatibility message, so that I know whether to update the app or choose another plugin.
4. As a plugin author, I want to declare task kind, mode and inputs, so that SubDesign can collect the correct brief before a Task run starts.
5. As a plugin author, I want to declare pipeline stages and completion conditions, so that a plugin can participate in the existing SubDesign lifecycle without inventing another runner.
6. As a plugin author, I want to declare evaluations, so that an artifact can be checked against explicit criteria rather than a model's unsupported success claim.
7. As a security-conscious user, I want to see the capabilities a plugin requests before granting them, so that installing content does not silently grant authority.
8. As a security-conscious user, I want filesystem, subprocess, network, MCP and connector capabilities denied by default, so that a plugin cannot expand its authority by omission.
9. As a user, I want capability approvals scoped to the relevant conversation and Task run, so that approval in one conversation does not authorize another.
10. As a user, I want to revoke a plugin grant, so that a previous trust decision is recoverable.
11. As an operator, I want unattended runs to deny unresolved capability requests after the existing timeout, so that automation cannot wait forever or auto-escalate.
12. As a maintainer, I want unknown capabilities to fail closed, so that a newer manifest cannot obtain accidental authority from an older app.
13. As a maintainer, I want every adopted plugin resolved to a source, version or commit and content hash, so that a run can be reproduced and audited.
14. As a user, I want the resolved plugin snapshot stored with my project, so that switching conversations or restarting the app does not change the selected plugin silently.
15. As a user, I want an upstream plugin change to require an explicit refresh, so that remote updates cannot overwrite my working project unexpectedly.
16. As a user, I want a changed capability fingerprint to trigger re-approval, so that a previously harmless plugin cannot gain authority through an update.
17. As a SubDesign user, I want plugin stages to appear in run activity, so that I can see what is executing instead of staring at a generic progress indicator.
18. As a SubDesign user, I want intermediate progress and messages to survive navigation, so that switching to another feature and returning does not erase the Task run projection.
19. As a SubDesign user, I want Stop to target the active run and its external provider session, so that cancellation actually stops the work I am viewing.
20. As a user, I want cancellation distinguished from failure, blocked state and unmet DoD, so that settlement explains what happened accurately.
21. As a user, I want external tool success kept separate from Goal-based DoD, so that an exit code cannot falsely mark a design task complete.
22. As a maintainer, I want every plugin-triggered execution to enter through the Task run coordinator, so that capacity, queueing, finalization and recovery remain consistent.
23. As a maintainer, I want different conversations to continue executing independently within the configured cap, so that plugin integration does not restore a global run lock.
24. As a maintainer, I want same-conversation follow-ups ordered, so that two plugin stages cannot race over one thread's state.
25. As a designer, I want SubDesign to discover the project's real Storybook components, so that generated designs use available building blocks.
26. As a designer, I want component docs, stories and controls summarized within a bounded context budget, so that useful design-system evidence does not exhaust the model context.
27. As a designer, I want Storybook unavailability to degrade gracefully, so that I can continue with local artifacts instead of losing the whole Task run.
28. As a maintainer, I want Storybook responses converted to an internal context evidence contract, so that unstable upstream APIs do not leak across the product.
29. As a designer, I want Critique to include console errors, failed requests and performance findings, so that visual polish does not hide runtime defects.
30. As a maintainer, I want browser evidence issued by the trusted adapter that observed it, so that model text cannot manufacture proof.
31. As a user, I want every evidence item linked to its run, stage, provider and artifact, so that I can trace why Critique reached a conclusion.
32. As a user, I want evidence attachments stored by project-relative locator, so that large traces and screenshots remain retrievable without flooding the conversation.
33. As a designer, I want to run a goal-based UX check with a persona, so that Critique can detect dead ends and ambiguous controls.
34. As a designer, I want UX checks to report success, failure or blocked with replay steps and friction events, so that findings are actionable.
35. As a macOS user, I want Harness permission requirements explained before a session starts, so that Screen Recording or Accessibility denial is not mistaken for a design failure.
36. As a cross-platform user, I want Harness to remain optional, so that unsupported platforms can still use static and browser-based Critique.
37. As a SubDesign user, I want direction choices rendered inline when a compatible interactive surface exists, so that I can compare and select without composing a textual answer.
38. As a SubDesign user, I want plugin input forms to preserve draft values at the declared conversation or project scope, so that navigation does not erase my decisions.
39. As a security-conscious user, I want third-party interactive UI sandboxed with a constrained Content Security Policy, so that generated HTML cannot access Electron authority.
40. As a maintainer, I want iframe-to-host messages schema validated and tool calls allowlisted, so that an interactive surface cannot call arbitrary tools.
41. As a user, I want a broken interactive surface to fall back to a native text/form representation, so that the workflow remains usable.
42. As a user, I want streaming artifacts visibly marked as streaming, complete or failed, so that partial output is not mistaken for a finished deliverable.
43. As a maintainer, I want each renderer to declare streaming, export and sandbox capabilities, so that unsupported behavior is rejected before rendering.
44. As a maintainer, I want raw connector tokens to remain in the encrypted main-process vault, so that no plugin, provider result or renderer can read them.
45. As a compliance reviewer, I want a plugin run to expose resolved provenance, grants and non-model Execution evidence without raw secrets, so that the result is auditable.
46. As a contributor, I want one internal provider vocabulary across Storybook, DevTools, Harness and future integrations, so that each provider does not create a bespoke lifecycle.
47. As a contributor, I want upstream packages pinned rather than installed from `latest`, so that release behavior is deterministic.
48. As a maintainer, I want provider timeout, output budget and cancellation behavior standardized, so that one integration cannot stall or flood the Pi Core tool loop.
49. As a maintainer, I want malformed manifests, escaped paths, invalid bridge payloads and model-attested evidence rejected at runtime, so that type erasure or IPC cannot bypass safety.
50. As a product owner, I want experimental providers feature flagged, so that unstable upstream integrations can be evaluated without committing the entire product to them.

## Implementation Decisions

- The product adopts a project-owned OpenDesign Plugin Contract v1 subset rather than importing the upstream daemon or treating upstream files as runtime authority.
- The first contract version is backward compatible with legacy `SKILL.md` and existing OpenDesign manifest records. Missing optional v1 fields use explicit safe defaults; unknown major versions are incompatible.
- The manifest vocabulary includes spec version, plugin kind, task kind, mode, inputs, pipeline stages, capabilities, evaluations, preview metadata and provenance. It does not promise complete compatibility with every upstream Open Design field.
- Manifest validation has one authoritative parser/result type. Catalog presentation, installation, Task run admission and smokes consume that result instead of re-parsing fields independently.
- Adopting a plugin creates a project-relative resolved snapshot containing source identity, resolved version or commit, content hash, requested capabilities and granted capabilities. The snapshot contains no raw credential.
- Capability grants map onto existing Pi Core capability, tool approval and connector-vault boundaries. Installation alone grants no network, subprocess, shell, filesystem-write, MCP or connector authority.
- `prompt:inject` is treated as a visible content influence, not hidden authority. The composed prompt records which plugin and snapshot supplied it.
- Unknown capabilities, changed capability fingerprints and malformed grant records fail closed. A changed fingerprint requires a new user decision.
- SubDesign stages remain the user-facing design lifecycle. Plugin pipeline stages adapt into that lifecycle; they do not create a second scheduler or lifecycle owner.
- Every plugin-triggered Task run enters through the Task run coordinator. Pi Core remains the production owner of tool execution, approval and settlement.
- External providers are tools or capabilities behind Pi Core. They never call the coordinator, dispatch function or renderer state directly.
- A provider contract standardizes identity, availability, timeout, output budget, cancellation, structured result and adapter-issued evidence. Provider-specific response types end at the adapter boundary.
- Context providers return bounded, cacheable internal evidence suitable for prompt composition. Storybook is the first implementation and remains read-only.
- Evidence providers return metadata, summaries and project-relative attachment locators. Chrome DevTools is the first runtime evidence implementation.
- Goal-test providers return a terminal goal outcome, ordered steps, friction events and evidence attachments. Harness is optional and cannot become the Task run owner.
- Tool success, provider session success, stage success and Goal-based DoD are separate states. No external exit code or model claim sets DoD met.
- Stop routes by run identity and invokes provider cancellation before normal unique finalization. A late provider event cannot resurrect a cancelled or archived run.
- Run activity and conversation content are UI Projections rebuilt from Host snapshot plus events. Navigation never makes renderer-local state canonical.
- Interactive surfaces initially support only choice, form and confirmation. OAuth prompts, arbitrary dashboards and unrestricted tool invocation are deferred.
- MCP Apps-compatible content runs in a sandboxed iframe with constrained origin and CSP. The host bridge validates every message and exposes only an explicit per-surface tool allowlist.
- Interactive surfaces always have a native fallback. Surface failure does not fail the design Task run unless the input itself is required and no fallback can collect it.
- Renderer capability declarations cover supported artifact kinds, streaming support, sandbox policy and export support. The artifact manifest remains the source of truth for status and exports.
- Streaming output uses a product-owned envelope inspired by OpenGenerativeUI. CopilotKit, LangGraph and a second agent runtime are not introduced.
- External packages and binaries are pinned to reviewed versions with recorded license and provenance. Production configuration never uses an unbounded `latest` reference.
- TypeUI content is not copied or bundled until its repository and service terms permit the intended use. Playwright MCP is not added while existing browser QA and Chrome DevTools cover the required evidence.
- All project paths are normalized and confined to the resolved project root. Provider output cannot choose arbitrary host filesystem destinations.
- Raw connector tokens remain main-process-only. Renderer, plugin manifest, provider result, evidence attachment and activity event carry references or redacted metadata only.
- The implementation follows ADR-0003 concurrency, ADR-0045 removable compatibility seams and ADR-0048 non-model Execution evidence. Any temporary legacy path names its deletion gate.

## Testing Decisions

- The primary behavioral test uses one highest-level seam: a SubDesign action starts a Task run through coordinator admission with a fake provider, then observes plugin resolution, capability enforcement, one pipeline stage, Pi Core tool execution, activity events, evidence, artifact output, cancellation and terminal settlement.
- Tests assert externally visible contracts and state transitions, not parser helper calls, private Zustand fields or internal function ordering beyond the coordinator's established unique-finalization invariant.
- The primary seam includes a successful run, denied capability, provider timeout, targeted cancel, malformed evidence and app-navigation/reprojection cases.
- Concurrency coverage proves that runs in different conversations can proceed independently within `maxConcurrentRuns`, while follow-ups in the same conversation remain ordered.
- A cancellation case proves the external provider receives a targeted cancel and that late events cannot change `cancelled` settlement.
- An evidence case proves model text and tool arguments cannot create successful Execution evidence; only the fake trusted adapter can issue an accepted snapshot.
- A DoD case proves external provider success does not imply Goal-based DoD met and that unmet DoD remains distinguishable from tool failure.
- Contract-level smokes cover legacy manifest compatibility, unknown major versions, unknown capabilities, malformed pipelines, changed fingerprints and deterministic snapshot hashes.
- Path smokes follow the existing sanitized-workspace precedent and reject absolute paths, traversal and provider-selected destinations outside the project root.
- Tool and capability registration follows the existing real-module smoke pattern so a green test imports the shipped registry and owning capability rather than a mirrored implementation.
- Coordinator coverage follows the existing coordinator smoke precedent and verifies admission, run-scoped activity, targeted cancellation and unique finalization.
- Pi Host parity coverage proves the production path owns provider execution and no renderer or browser compatibility seam gains a new execution owner.
- Storybook tests use a deterministic fake server response and cover context budget, cache, timeout, unavailable fallback and unstable extra fields.
- Chrome DevTools tests use captured deterministic protocol fixtures and verify console, network and performance findings normalize to internal evidence without raw page secrets.
- Harness tests use fake session events and verify goal outcome, ordered steps, friction records, permission-denied handling, optional-platform fallback and Stop propagation.
- MCP Apps tests reject an untrusted origin, disallowed tool request, malformed bridge payload and prohibited navigation, while accepting a valid choice/form response.
- Renderer tests prove content is visible without entrance animation, streaming status is explicit, unsupported streaming is refused and native fallback remains usable.
- Persistence tests rebuild UI Projection from Host snapshot plus events after navigation or reload, rather than asserting renderer localStorage as canonical state.
- Verification uses the existing toolchain: build/typecheck, lint and shipped-module smoke suites. No new unit-test framework is introduced solely for this effort.
- Each provider ticket includes a manual demo under the desktop app where browser protocol behavior or OS permission UI cannot be fully represented in a smoke.

## Out of Scope

- Forking or embedding the complete `nexu-io/open-design` daemon.
- Replacing Pi Core, the Task run coordinator, SubDesign lifecycle or the Electron product shell.
- Supporting every upstream Open Design plugin field, runtime adapter or marketplace behavior in contract v1.
- Treating external CLI, MCP or provider success as Goal-based DoD met.
- Giving renderer code direct filesystem, process, network, connector or token access.
- General-purpose arbitrary MCP App hosting in every conversation surface.
- OAuth UI through MCP Apps in the first release.
- Adding LangGraph, CopilotKit or OpenGenerativeUI's full runtime.
- Adding a second long-running browser automation loop through Playwright MCP.
- Bundling or copying TypeUI material before license and service-term review.
- Making Harness mandatory on Windows, Linux or macOS installations without its required permissions.
- Automatic remote plugin updates or silent replacement of project-owned plugin files.
- A public plugin marketplace submission, ratings, billing or remote distribution service.
- A new test framework, broad UI redesign or replacement of existing OpenDesign templates.

## Further Notes

- The upstream research and source links are recorded in `docs/research/open-design-harness-integrations.md` and should be rechecked before pinning a dependency because upstream APIs remain active.
- Storybook MCP is experimental and moving toward Storybook monorepo/skills-first ownership. Its adapter must be feature flagged and isolate upstream response types.
- Harness is alpha and macOS permission-sensitive. A permission refusal is provider unavailability or blocked setup, not evidence that the user's design failed.
- MCP Apps publishes an Apache-2.0 license in its repository even though GitHub's API did not identify it during the 2026-08-20 query. Dependency review should inspect the exact pinned package and license file.
- The first implementation frontier is the versioned plugin contract and resolved trust snapshot. Every external provider depends on that stable boundary.
- Work proceeds one unblocked tracer-bullet ticket at a time. Tickets are published only after their granularity and blocking edges are approved.
