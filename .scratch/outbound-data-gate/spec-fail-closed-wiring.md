# Outbound Data Gate — Fail-closed production wiring

**Status:** 可交給代理  
**Parent effort:** [outbound-data-gate](./spec.md)（01–15 pure modules + 初版 platform 已 resolved）  
**Source:** code review `grok-review-e0a55c86` Issues 1–11（bugs）

## Problem Statement

公司出站閘門的 pure modules 與 smoke 已能在隔離測試中證明「模式正交、淨化、受控視圖、CLI sandbox 契約」。但 **Electron 正式執行路徑把安全決策留在 renderer 可信任邊界之外**：部署 `SUBAGENTS_OUTBOUND_GUARD` 只影響 main 顯示的狀態、不驅動 runtime；LLM 出站只用內建 baseline 而非磁碟上的 company policy；Policy Admin 寫入 IPC 在 standard build 仍可用；CLI sandbox 與 evidence 由 renderer 選擇性呼叫；builtin shell 僅 pin cwd 仍可用絕對路徑讀原始專案。結果是 **UI 可能顯示「公司強制」而實際出站仍 fail-open**，與 ADR-0004 及既有 product spec 的 fail-closed 承諾不一致。

## Solution

把 **effective guard mode、Restricted Project View 生命週期、company Provider Security Profile 於 LLM 出站、CLI 程序建立前的 filesystem sandbox、Policy Admin 管理面、Security Evidence Ledger 寫入** 全部收斂到 **Electron main 為權威** 的控制面；renderer 只消費不可竄改的 mode/view 快照並在 `required` 下無法 soft-continue。保護啟用時，所有 builtin LLM round、external CLI spawn、以及可逃出視圖的 shell，都必須在同一 company profile 與同一 view root 下 fail-closed；standard build 不得暴露政策寫入；probe 不得修改原始專案。

## User Stories

1. As a 公司安全管理員, I want deploy-time `SUBAGENTS_OUTBOUND_GUARD` to be the runtime source of truth in Electron, so that host configuration cannot be ignored by renderer preferences or missing env injection.
2. As a 公司安全管理員, I want only main-owned status to feed Settings and Dashboard posture labels, so that「公司強制」never appears while egress still runs as off.
3. As a 公司員工 under required mode, I want a Task run that cannot prepare a Restricted Project View to be blocked for outbound work, so that I am not silently working against the original project.
4. As a 公司員工 under required mode, I want missing project root or policy-load failure to block LLM and external CLI egress, so that a broken policy tree cannot degrade to a weaker floor without notice.
5. As a 公司員工 under optional mode, I want explicit degraded or unprepared states when I choose to continue without a view, so that optional remains usable without pretending isolation holds.
6. As a 公司員工, I want every tool that reads the project under protection to resolve the same Restricted Project View root, so that smoke-only in-memory pins are not the only path that works.
7. As a 公司員工, I want prompts, history, attachments and tool results sanitized with the same Provider Security Profile used for the Restricted Project View, so that company detectors and supplements apply at LLM egress.
8. As a 公司員工, I want external CLI processes under required mode to be refused unless main verifies a filesystem sandbox bound to the run’s view, so that skipping wrap in the renderer cannot bypass isolation.
9. As a 公司員工, I want sandbox probes never to create files under the original project tree, so that protection construction cannot pollute source control.
10. As a 公司員工, I want builtin shell tools under active protection to be unable to read the original project via absolute paths, so that cwd pinning is not the only control.
11. As a 公司安全管理員, I want Policy Admin draft save/activate/rollback IPC denied on standard builds, so that management code is not a soft UI hide.
12. As a 公司安全管理員, I want evidence of outbound decisions written only by main at true egress points, so that the renderer cannot spoof or omit the ledger.
13. As a 公司安全管理員, I want evidence records to stay metadata-only (action, mode, isolation status, locators), so that the ledger never reintroduces protected content.
14. As a CLI user, I want a verified sandbox profile that still allows the minimum network and binary paths real adapters need, so that required mode does not force operators to disable isolation to get work done.
15. As a reviewer, I want scenario smokes that exercise main-owned mode, required fail-closed prepare, company profile at LLM gate, main CLI refuse-without-sandbox, flavor-denied policy writes, and bash isolation, so that the fail-open regressions cannot return unnoticed.
16. As a developer, I want off mode and unattended paths to keep existing success/failure semantics when protection is truly off, so that non-company installs do not regress.
17. As a security administrator, I want invalid deploy guard values to fail configuration validation rather than silently selecting a weaker mode, so that misconfiguration is visible.
18. As a Policy Admin user on a policy-admin flavor build only, I want draft lifecycle unchanged in behaviour once gated, so that management remains available where intended.
19. As a concurrent-run user, I want each runId’s view and mode pin to stay isolated, so that one run’s dispose cannot rebind another run to the original root.
20. As an auditor, I want Settings/Dashboard posture, gate effective mode, and evidence mode fields to agree for the same process, so that support can trust a single story.

## Implementation Decisions

- **Effort location:** Continue under `outbound-data-gate` as tickets **16–23** (01–15 remain historical / resolved). This document is the active wiring spec; the parent product spec stays the domain bible.
- **Seams (prefer existing, highest useful point):**
  1. **Main outbound control plane** — authoritative effective mode snapshot, prepare/dispose Restricted Project View, evidence append, Policy Admin write handlers.
  2. **Existing Outbound Data Gate / LLM egress** — must consume main-backed mode + run-scoped Provider Security Profile (not a second soft path).
  3. **Existing external CLI spawn (main)** — sandbox gate before process creation; do not trust renderer-supplied wrap flags alone.
  4. **Existing tool project-root resolution** — single source of truth for view root under protection (including shell tools).
- **Deploy guard is main-owned.** Renderer must not derive company posture from its own process env as the primary source. Boot/status refresh publishes an immutable deploy + effective mode snapshot into the store or a dedicated IPC read used by coordinator, LLM, and CLI paths.
- **`required` fail-closed on view lifecycle.** Missing project root, prepare failure, or company profile load failure blocks outbound for that run; optional/demo may continue only with explicit degraded marking (evidence + UI), never silent baseline substitution when company files exist but are invalid.
- **One view-root truth.** Prefer main’s run-bound view as the only registry; renderer in-memory bind used only for Node smokes must not diverge from production semantics. Tool resolution under protection must not fall through to the UI project store when a protected run is active.
- **LLM egress uses the same compiled Provider Security Profile as the Restricted Project View** for that connection (company base + supplement). Builtin baseline alone is insufficient when company policy is active.
- **CLI sandbox enforcement in main.** Under `required`, refuse spawn unless isolation is verified against the bound view root and cwd is inside that view. Forbidden canaries live outside the original project (and outside the view).
- **Builtin shell under protection.** Deny unbounded shell or wrap it with the same filesystem isolation as required CLI; cwd pin is not enough (ADR-0007 / ADR-0022).
- **Policy Admin write surface.** Main and preload must refuse mutation channels when build flavor is not `policy-admin`; UI hide alone is not compliance with ADR-0016.
- **Evidence append is main-only** at true egress (view prepare, CLI gate, LLM path as applicable). Renderer must not be able to freely append spoofable outbound-decision records (ADR-0015).
- **Seatbelt/bwrap profile** may be expanded for adapter viability only after forbid of original project paths remains proven; “verified” must not mean “only cat canary passed” if that makes required CLI unusable in production without documenting residual openings.
- **No new Task run ingress** and no build-flavor bypass of the gate.
- Domain vocabulary: Outbound Data Gate, Guard Mode (`off`/`demo`/`optional`/`required`), Restricted Project View / Sanitized Workspace, Provider Security Profile, Provider Supplemental Policy, Security Evidence Ledger, build flavor `standard` | `policy-admin`, filesystem isolation `verified` | `unverified` | `unavailable`.

## Testing Decisions

- Prefer **external behaviour** over internal map identity: effective mode under host env, blocked vs allowed egress, view root vs original root for tools, spawn refuse, IPC deny, evidence presence without content.
- **Highest seams:** main outbound status/prepare/dispose/evidence/policy-admin; LLM gate with loaded profile; main CLI spawn; tool root under protection.
- **Prior art:** existing `smoke-outbound-*`, `smoke-cli-filesystem-sandbox`, `smoke-policy-admin-bridge`, `smoke-outbound-run-scenario`, `check-build-flavor`, platform smokes that assert static contracts in Electron main/preload sources.
- **Regression matrix (minimum):**
  - Host `required` + empty renderer env → runtime effective `required`, not `off`.
  - `required` + prepare fail → no LLM/CLI outbound success path.
  - Protected run tool root ≠ original project when view exists.
  - LLM payload uses company detector beyond baseline when company policy present.
  - `cli:runAgent` without verified wrap under `required` → denied in main.
  - Canary path not under original project.
  - Standard flavor → policy write IPC hard-deny.
  - `bash`/shell under protection cannot read a sentinel only present on original root.
  - Evidence append from renderer spoof path denied or no-op; main appends on real egress.
- Node strip-types smokes remain first class; add main/preload static contract assertions where full Electron process is not available in CI.

## Out of Scope

- Redesigning company policy JSON schema or monotonic merge rules already covered by tickets 01–15.
- Format-preserving PDF/Office editing, OCR, or external vision providers.
- Full CI multi-OS packaging of every CLI adapter binary.
- Transferring HMAC keys or pending evidence across devices.
- Unrelated hermes/tool-registry refactors outside outbound wiring.
- Making Policy Admin a remote multi-tenant console.

## Further Notes

- Review source: local review id `e0a55c86` (11 bugs, 5 suggestions, 2 nits). This wiring pass targets **bugs only**; suggestions (gate pass-through consolidation, SettingsPage split, safe writeback wiring, import-extension consistency) may follow as a later batch.
- Parent ADRs still bind: 0004 fail-closed egress, 0007 sanitized workspace, 0008 writeback, 0015 evidence without content, 0016 policy-admin flavor, 0022 required CLI sandbox.
- Ticket DAG: 16 → 17 → 18 → 19; 16+18 → 20 → 21; 22 parallel; 23 after 16/19/20.
