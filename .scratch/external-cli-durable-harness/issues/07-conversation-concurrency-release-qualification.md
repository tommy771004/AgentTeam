# 07 — Qualify conversation-scoped durable CLI execution

**What to build:** Qualify the complete durable external CLI harness across conversation concurrency, security boundaries, runner honesty, observability, and shipped adapters, so it can replace the legacy fixed-deadline path without regressions.

**Blocked by:** 02 — Let active work survive the five-minute boundary; 03 — Yield, snapshot, and reconnect long CLI work; 04 — Cancel once and recover only when replay-safe; 05 — Classify connector authentication separately; 06 — Model interactive and unattended wait states.

**Status:** 可交給代理

## 2026-08-28 real-machine evidence

`app/scripts/qualify-external-cli-real.mts` now exercises the shipped
`runLocalCliAgent` boundary with installed provider binaries and writes a
metadata-only report to
`../evidence/real-cli-qualification.md` / `.json`. The prompt and provider
output bodies are deliberately excluded.

- Codex CLI 0.150.1: pass. Real response marker observed; active checkpoint
  captured; a fresh Host registry projected the captured run as `interrupted`
  with `automaticRetry: false`; external Turn Record ownership passed.
- Claude Code 2.1.246: pass with the same execution, checkpoint, restart, and
  Turn Record assertions.
- Grok 0.2.106: runner/checkpoint/restart path executed, but provider execution
  is `blocked-auth` because this machine's authentication is unavailable.
- Gemini and Cursor Agent are not installed on this machine and are
  not claimed as qualified.

During qualification, Codex exposed a real adapter defect: `codex exec` waits
for EOF when its stdin is a pipe. The shipped process contract now closes stdin
only for the one-shot Codex invocation; Claude and Grok retain interactive
stdin. The qualification ticket remains open until the blocked/absent shipped
adapters and the complete release suites have evidence.

## 2026-08-31 fresh rerun

最新 metadata-only report 已覆寫至 `../evidence/real-cli-qualification.md`／`.json`：Codex CLI 0.150.1 的 process、checkpoint、restart projection 與 Turn Record 通過，但 native discovery marker 未出現，故為 `native_discovery_unproven`；Claude Code 2.1.246 實際啟動後回報 `auth_unavailable`。這次未安裝、登入或改動 provider；ticket 維持 open。

## 2026-09-01 qualification repair and fresh rerun

舊 probe 的專案 instruction 只包含 token，並未要求 provider 在回答中帶回 token，因此「marker 未出現」不能區分 discovery 未發生與 discovery 已發生但無可觀察行為。修正 probe 後，user prompt 仍不含檔名或 native token；Codex CLI 0.152.0 透過 shipped admission／adapter 回傳 expected marker 一次、forbidden marker 零次，且 checkpoint、restart projection、metadata-only Turn Record 均通過，現標為 `qualified`（native mode，非 exact snapshot parity）。Claude Code 2.1.246 仍為 `auth_unavailable`，ticket 維持 open。

- [ ] Two different conversation threads can run external sessions independently up to `maxConcurrentRuns` without sharing activity, deadlines, output, cancellation, or settlement.
- [ ] Same-thread follow-ups retain the configured steer/queue ordering and do not start an overlapping external process accidentally.
- [ ] Every shipped external adapter uses the common session lifecycle and centrally defined timing policy or returns an explicit unsupported capability.
- [ ] External provider exit success remains execution success only and never becomes Definition of Done by itself.
- [ ] Sanitized Workspace, Outbound Data Gate, filesystem sandbox, Approval Mode, and unattended policy remain effective for the session's entire lifetime.
- [ ] Telemetry distinguishes startup, idle, absolute-cap, operation, connector-auth, cancellation, interrupted, and process-exit outcomes without storing prompt, output body, secrets, or protected data.
- [ ] Renderer reload, Host snapshot, event replay, cancellation, timeout, completion, and recovery scenarios preserve one authoritative Host state and one final settlement.
- [ ] Architecture drift guards prove UI code does not bypass `runTask`, invoke lower-level execution owners, or become canonical session storage.
- [ ] The focused durable-harness smoke exercises the highest approved seam with fake time and fake transport and completes in seconds.
- [ ] Existing loop parity, Pi Host protocol, coordinator, sandbox, outbound, automation, provider, build, lint, and complete smoke suites pass.
- [ ] Legacy blanket five-minute deadline logic and obsolete generic timeout copy are removed only after every adapter is qualified on the new path.
