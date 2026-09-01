---
status: accepted
---

# Route CLI subscription OAuth into the Pi Core loop

## Context

The product today has two disjoint execution paths. Builtin runs execute inside
Pi Core Host (`executionKind: 'loop'`) with tool loop, approvals, and settlement
owned by the utility process; external CLI runs spawn the vendor binary
(`codex`, `claude`, `gemini`, …) through `localCliRunner` and each CLI uses its
own login state. Selecting a CLI provider therefore means running that vendor's
agent, not Pi Core with the subscription credential — Pi Core can only be
driven by OpenAI-compatible endpoints (API key + `baseUrl`) because the
renderer connection presets (`src/agent/apiProviders.ts`,
`ApiProviderPreset = 'aihubmix' | 'openai' | 'openrouter' | 'custom'`) and the
model picker (`window.subagents.llm.models({ baseUrl, apiKey })`, an HTTP
`/v1/models` listing) have no concept of a native provider.

Meanwhile the substrate for the opposite behavior already exists end to end:

- `electron/piUserConfig.ts` `syncPiCliOAuth()` imports `~/.codex/auth.json`
  into provider id `openai-codex` and `~/.claude/.credentials.json` into
  provider id `anthropic`, writing `{ type: 'oauth', access, refresh, expires }`
  atomically (mode 0600) into the Pi agent dir's `auth.json`. Production main
  enables this via `SUBAGENTS_PI_SYNC_CLI_OAUTH=true`; `piHostEntry.ts` runs it
  at startup and reports `importedProviders` / `skippedProviders` /
  `conflicts`. A `subagentsSource` marker prevents a stale CLI snapshot from
  overwriting a newer Pi-side token refresh.
- Vendored Pi resolves these credentials natively: `ModelRuntime.create({
  authPath })` builds its provider catalog from the builtin providers
  (including `openai-codex` via the Codex Responses API and `anthropic`),
  and `resolveProviderAuth` gives the stored credential ownership of the
  provider, refreshing expired OAuth tokens under double-checked locking.
  `piCoreRuntime.ts` already calls `getModel(settings.provider, settings.model)`
  against exactly this runtime.

So the missing piece is only selection: nothing lets a user point a builtin run
at `openai-codex/gpt-5.4` or an `anthropic` OAuth model, enumerate those models,
or see the sync status. The Host's `settings/update` accepts arbitrary provider
strings and already tolerates an empty `baseUrl` (it skips legacy endpoint
persistence), so the constraint lives almost entirely in the renderer surface
and in model enumeration.

This ADR does not change the external CLI runner path, the runner capability
matrix (ADR-0038 semantics: builtin is `loop`, CLI success is never DoD met), or
the connector-token vault rules (AGENTS.md). It adds a second legitimate way to
credential the existing builtin loop.

## Decision

CLI subscription credentials become first-class credentials **of the builtin Pi
Core loop**. The user picks a "subscription" connection kind backed by a native
provider id (`openai-codex`, `anthropic`); Pi Core Host remains the single owner
of loop, approvals, settlement, and Turn Record for such runs, exactly as for
API-key connections.

1. **Credential flow stays where it is.** No new token transport: the utility
   process reads the synced `auth.json` itself; tokens never cross IPC to the
   renderer. The renderer receives status metadata only — per-provider
   `imported | skipped | conflict` plus source kind, never raw tokens or
   account ids. `auth.json` stays at mode 0600 inside the agent dir; this is
   Pi's own auth storage, deliberately distinct from the connector vault,
   which continues to own connector/plugin tokens.
2. **CLI account authority is explicit and Host-owned.** The persisted
   `followCliOAuthAccount` setting defaults on. When the existing credential
   carries the same `subagentsSource.kind` as the currently selected CLI, the
   Host treats that CLI login as the authority and atomically adopts both token
   rotations and account changes at startup, Settings refresh/update, and the
   pre-turn boundary. Turning the setting off restores fail-closed account
   identity: a different account reports `conflict` and is unavailable. A
   credential from another source channel is never overwritten by this policy,
   and there is no fallback to ambient keys or another provider.
3. **Model enumeration comes from the Host**, not from an HTTP `/v1/models`
   call: the protocol exposes the `ModelRuntime` view of available models for
   native providers (bounded list: id, label, context window, reasoning flag).
   Per ADR-0038 any contract addition bumps the protocol version v3 → v4;
   this change sequences **after** active-run-reattachment lands its v3, and
   reuses the same negotiation machinery rather than forking it.
4. **Honest labeling.** These runs are presented as "Pi loop on a
   `<vendor>` subscription model" — never as vendor-agent runs. Vendor CLI
   toolchains (their built-in tools, MCP config, sandboxes) are absent here;
   the external CLI runner path remains unchanged and remains the way to get
   vendor-native behavior. UI copy keeps the distinction visible at the point
   of selection.
5. **Capability matrix untouched.** Subscription runs keep
   `executionKind: 'loop'` with parse/DoD/iterate/continueGoal. Nothing about
   them may be recorded as DoD-exempt or CLI-like.

### Rejected alternatives

- *Proxy the vendor CLI binary through Pi* (drive codex/claude as a model
  transport): two process supervisors for one turn, no shared schema, and the
  vendor agent still owns tool execution — worst of both paths.
- *Keep external CLI runs but relabel them*: does not address the request;
  subscription models would remain unreachable from the governed loop.
- *Import gemini/opencode/cursor credentials now*: their local credential
  shapes differ and Pi has no matching native provider; out of scope until a
  provider exists upstream.

## Consequences

- Users with a Codex or Claude subscription can run the governed loop —
  approvals, outbound gates, sandbox evidence, Turn Record fidelity — without
  buying separate API credit, while users who want vendor-native agents keep
  the external CLI runner unchanged.
- New failure surfaces to document: subscription rate limits and program terms
  apply to API-style usage; account changes follow the selected CLI by default
  and conflicts remain visible when that policy is disabled; offline startup
  must degrade to the last cached model catalog
  (the same caveat DEV_STATE records for the vendor build's remote catalog).
- Implementation touches one renderer preset surface, one settings mapping,
  and one protocol capability; no coordinator, admission, journal, or vault
  changes. Smokes: a fixture smoke over the new enumeration projection plus a
  drift guard asserting the fail-closed presentation rules; the full
  `npm run build` / `smoke` baseline must stay green.
