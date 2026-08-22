# External CLI Durable Harness

Status: 可交給代理

## Problem Statement

Users can select an external CLI runner such as Codex for demanding, high-reasoning implementation work, but SubAgents AI currently supervises the entire CLI invocation with one fixed five-minute wall-clock deadline. A healthy CLI can still be reasoning, invoking tools, waiting on a bounded tool operation, or streaming progress when that deadline expires. The desktop then terminates the process and reports a generic headless CLI timeout, losing useful distinctions between active work, inactivity, connector authentication, tool failure, user cancellation, and an actual wedged process.

The current behavior also treats incidental output such as Codex reading additional stdin input or an optional MCP server returning `AuthRequired` as part of the final timeout detail. This makes a non-fatal connector problem look like the cause of the run failure. Users cannot tell whether retrying is safe, whether the CLI run can be resumed, or whether they should authenticate a connector.

External CLI execution already enters through the Task run coordinator and participates in the external runner contract. The missing capability is a durable supervision harness around that runner: streamed activity, scoped deadlines, explicit wait states, stable identities, cancellation, recovery evidence, and one authoritative settlement.

## Solution

SubAgents AI will supervise every external CLI invocation as an External CLI Run Session rather than as one opaque subprocess with a five-minute timer. The session will stream typed lifecycle activity, retain stable run and provider-session identities, and distinguish several independent clocks:

- startup deadline before the first valid lifecycle event;
- activity-based idle deadline, reset only by meaningful model, tool, process, approval, or provider events;
- a longer absolute safety cap that prevents an indefinitely noisy or wedged run;
- tool- and MCP-scoped deadlines owned by those operations;
- short yield or observation windows that return control without terminating the underlying work.

The default interactive policy will allow ten minutes of genuine inactivity and up to sixty minutes of total execution. These values are centrally defined, bounded, observable, and overrideable only through the typed run policy. Waiting for interactive user input or approval is a first-class session phase and pauses the activity deadline; unattended runs retain their existing bounded auto-denial behavior and never wait indefinitely.

The desktop will keep consuming CLI NDJSON and process output while the session runs. A bounded observation window may return a snapshot or progress event while the same process continues. User cancellation propagates through one cancellation path to the process tree and produces one settlement. A connector authentication failure is reported against that connector and only fails the overall Task run when the requested work cannot continue without it.

The user will see whether a run is starting, active, waiting on a tool, waiting for input, idle-timed-out, safety-capped, cancelled, resumable, or failed. The generic recommendation to use headless mode will only appear when the invoked adapter is actually non-headless.

## User Stories

1. As a user running a difficult Codex task, I want active work to continue beyond five minutes, so that high-reasoning work is not terminated while healthy.
2. As a user, I want progress events to prove that a long run is alive, so that I can distinguish patience from a retry decision.
3. As a user, I want an inactive CLI to time out after a bounded idle period, so that a genuinely wedged process does not run forever.
4. As a user, I want an absolute safety cap, so that a process cannot evade supervision by emitting endless noise.
5. As a user, I want startup failure distinguished from runtime inactivity, so that I know whether the CLI failed to launch or became stuck later.
6. As a user, I want model activity, tool activity, and process output represented as typed events, so that the activity feed explains what the runner is doing.
7. As a user, I want tool waits to yield control without killing the CLI, so that long tests and builds can finish normally.
8. As a user, I want a running command to retain a stable process session identity, so that later polls and input target the correct process.
9. As a user, I want polling to return bounded snapshots, so that the app remains responsive while work continues.
10. As a user, I want concurrent processes to be observed independently, so that one slow command does not block unrelated process output.
11. As a user, I want interaction with one process serialized, so that overlapping polls cannot consume or reorder the same output.
12. As a user, I want process output to stream before completion, so that a long command never appears silently frozen.
13. As a user, I want large output safely truncated with omission evidence, so that the UI remains usable without pretending the output was complete.
14. As a user, I want user cancellation to stop the correct process tree, so that child processes do not remain orphaned.
15. As a user, I want cancellation to settle exactly once, so that the conversation does not receive conflicting final states.
16. As a user, I want cancellation distinguished from timeout, so that I can understand who ended the run.
17. As a user, I want waiting for my answer or approval represented explicitly, so that an intentional pause is not called inactivity.
18. As an unattended-run owner, I want approval and safety prompts to retain bounded auto-denial, so that automation never waits forever.
19. As a user, I want an optional MCP authentication failure shown as a connector warning, so that it is not mistaken for a dead CLI.
20. As a user, I want a required MCP tool failure to identify the server and operation, so that I know which capability blocked completion.
21. As a user, I want normal stdin EOF notices treated as diagnostics rather than failures, so that harmless Codex output does not pollute the root cause.
22. As a user, I want the CLI command and adapter mode recorded safely, so that headless configuration can be diagnosed without exposing prompt or credentials.
23. As a user, I want the Task run ID preserved through every CLI event, so that activity cannot leak into another conversation.
24. As a user, I want the provider thread or session ID retained when available, so that interrupted work has a recovery identity.
25. As a user, I want stream cursor or sequence information retained, so that renderer reload does not duplicate or lose events.
26. As a user, I want a renderer reload to rebuild the active run projection, so that an ongoing CLI run does not disappear from the UI.
27. As a user, I want different conversation threads to run independently, so that a long external task does not become a global lock.
28. As a user, I want follow-ups in the same conversation to remain ordered, so that external CLI continuity matches the Task run coordinator policy.
29. As a user, I want an interrupted external run marked honestly, so that process loss is not presented as successful completion.
30. As a user, I want automatic retry only when a Replay-safe Checkpoint permits it, so that uncertain side effects are not repeated.
31. As a user, I want a resumable run to expose an explicit resume action, so that recovery does not silently start unrelated work.
32. As a user, I want non-resumable failure to preserve the last useful output, so that diagnosis is possible after settlement.
33. As an operator, I want startup, idle, tool, connector, cancellation, and absolute-cap outcomes counted separately, so that reliability metrics identify the real failure class.
34. As an operator, I want meaningful activity timestamps without prompt or token contents, so that supervision is observable without leaking protected data.
35. As a security owner, I want the Sanitized Workspace and filesystem sandbox contract preserved for the full CLI lifetime, so that longer execution does not expand authority.
36. As a security owner, I want connector credentials to remain outside renderer events, so that authentication diagnostics never expose raw tokens.
37. As a developer, I want one External CLI Run Session contract across CLI adapters, so that Codex, Claude, Grok, Gemini, Cursor, and OpenCode do not invent separate timeout semantics.
38. As a developer, I want timeout policy defined centrally, so that adapters cannot reintroduce arbitrary wall-clock deadlines.
39. As a developer, I want a deterministic fake clock and process transport, so that long-duration behavior is tested in seconds.
40. As a developer, I want lifecycle tests to observe only public events and settlement, so that implementation can evolve without rewriting brittle source assertions.
41. As a product owner, I want external CLI success to remain distinct from Definition of Done, so that a longer harness does not weaken existing runner honesty.
42. As a product owner, I want external CLI execution to remain an optional Integration rather than becoming Pi Core, so that the established runtime ownership stays coherent.

## Implementation Decisions

- External CLI execution remains an optional Integration behind the Task run coordinator. It does not become Pi Core, a second tool-loop owner, or a direct renderer execution path.
- Introduce one External CLI Run Session contract as the durable supervision boundary. It owns provider-process identity, provider thread/session identity when available, lifecycle phase, last meaningful activity, deadline policy, cancellation state, recovery metadata, and terminal settlement.
- Every external run continues to enter through `runTask`. Admission, capacity, thread binding, before-run behavior, outbound protection, and unique finalization remain coordinator responsibilities.
- Replace the fixed five-minute whole-process deadline with five separate concepts: startup deadline, idle deadline, absolute safety cap, operation-scoped timeout, and yield/observation window.
- Interactive defaults are a ten-minute idle deadline and sixty-minute absolute safety cap. The policy is centrally bounded and included in the immutable run snapshot. Adapters may request a shorter operation timeout but may not silently change session policy.
- A meaningful activity event is a typed model-stream event, tool lifecycle transition, process output delta, provider lifecycle transition, approval/input transition, or terminal event. Raw repeated noise remains bounded by the absolute safety cap.
- `waiting_for_user` and `waiting_for_approval` are explicit phases. Interactive waiting pauses the idle clock; unattended waiting follows the existing bounded auto-denial rules.
- Long-running shell work uses a durable process identity and bounded yield semantics. A yield returns output plus live process identity without terminating the process. Later poll/input operations address that identity.
- Interactions with one process are serialized. Different process sessions may be observed concurrently within the existing run capacity and policy limits.
- Process output is streamed incrementally and retained through a bounded head/tail policy with explicit omission metadata. Output truncation never implies process completion.
- Cancellation is hierarchical and explicit: Task run cancellation reaches the External CLI Run Session, terminates the owned process tree, stops pending operations, emits a cancellation event, and enters the coordinator's unique settlement path once.
- Provider exit code zero remains execution success only. It does not by itself satisfy Definition of Done or enable builtin parse/iterate capabilities.
- MCP startup and tool deadlines remain scoped to the MCP server or call. Connector `AuthRequired` becomes a structured connector state. An unavailable optional connector does not fail unrelated work; a selected required capability returns a precise failure.
- Benign Codex diagnostics such as reading additional stdin input are preserved only as low-severity diagnostic events and never used as the primary timeout explanation.
- The session retains `runId`, conversation thread identity, adapter identity, provider thread/session identity when emitted, event sequence/cursor, timestamps, last output summary, and terminal classification. Prompt text, raw credentials, and protected payloads are excluded from durable supervision metadata.
- Renderer state remains a disposable UI Projection. Active external sessions are reconstructed from Host-owned snapshots plus events after a cursor, consistent with the canonical Host-state ADR.
- Recovery is fail-closed. A process lost during Host restart becomes interrupted unless a provider resume identity and Replay-safe Checkpoint justify continuation or retry.
- Error taxonomy includes at least startup timeout, idle timeout, absolute safety cap, operation timeout, connector authentication required, permission denied, user cancellation, process exit failure, transport failure, and interrupted/recovery-required.
- UI copy reports the terminal classification and next relevant action. The headless-mode hint appears only when adapter diagnostics prove a non-headless invocation.
- Telemetry records durations, phase changes, event counts, timeout class, adapter, and settlement without prompt, output body, secret, or protected-data contents.
- Existing adapter-specific invocation building remains responsible for correct headless flags. The durable harness supervises adapters through one contract rather than duplicating their command construction.

## Testing Decisions

- Use one primary behavioral seam: a Task run entering `runTask`, selecting an external runner, traversing the shipped External CLI Run Session and Electron supervision boundary, and producing streamed projection events plus one final settlement.
- The seam uses a deterministic fake clock and controllable fake CLI process transport. Tests advance minutes instantly and emit the same public process/model/tool lifecycle events as production.
- Tests assert externally observable events, current projection, process lifetime, cancellation result, and final settlement. They do not assert private timer variables, internal helper calls, or source-code text except for narrow architecture drift guards.
- A run that emits meaningful activity for more than five simulated minutes must remain active and must not be killed by elapsed wall time alone.
- A run with no meaningful activity must idle-time-out at the configured boundary, terminate its process tree, and settle once with the idle classification.
- A noisy run must reach the absolute safety cap even though its idle deadline keeps resetting.
- Startup with no valid lifecycle event must produce startup timeout rather than idle timeout.
- A yielded tool/process operation must retain its process identity, stream incremental output, accept later poll/input, and complete without a new Task run.
- Concurrent process sessions must progress independently, while two interactions against one process remain ordered.
- Waiting for interactive input or approval must pause the idle clock; unattended waiting must auto-deny within the existing bounded policy.
- User cancellation must win races against tool completion and timeout without producing duplicate terminal events or settlement.
- Optional MCP `AuthRequired` must emit a connector warning while an unrelated Codex turn still completes successfully. A required connector call must fail with connector-specific classification.
- Renderer reconstruction tests must rebuild the same active projection from a Host snapshot and events after a cursor without duplicating activity.
- Recovery tests must distinguish resumable provider identity from an interrupted run that lacks Replay-safe evidence.
- Different conversation threads must remain independently runnable up to `maxConcurrentRuns`; same-thread follow-ups must retain existing steer/queue ordering.
- Prior art includes the existing external/builtin loop-parity smoke, Pi Host initialize/session/stream/cancel smokes, subprocess cancellation coverage, external CLI filesystem-sandbox smokes, and coordinator settlement drift guards.
- The complete smoke chain and build remain the final integration gate. A focused durable-harness smoke provides the fast red/green feedback loop.

## Out of Scope

- Replacing Pi Core or moving the production tool loop back into renderer code.
- Treating external CLI exit success as Definition of Done.
- Reimplementing Codex's internal tool loop, MCP client, or unified-exec process manager inside SubAgents AI.
- Adding parse, validate-DoD, or autonomous iteration capabilities to external runners beyond their existing explicit contracts.
- Changing the Sanitized Workspace, Outbound Data Gate, filesystem sandbox, or approval authority model.
- Automatically retrying interrupted effectful work without a Replay-safe Checkpoint.
- Copying OAuth tokens into renderer state or implementing a second connector credential store.
- Building new Cloudflare functionality; only correct classification and presentation of connector authentication state is included.
- Redesigning the entire activity feed or settings page. Only the states and actions required by the durable session contract are included.
- Guaranteeing resume for providers that do not expose a stable provider thread/session identity.
- Removing all adapter-specific operation timeouts; operation-scoped bounds remain required.

## Further Notes

- The reference architecture was inspected from `openai/codex` commit `343074d4207d572809bd8cea15f4be1d09d98e0b`. Its relevant pattern is durable turn/tool/process state combined with bounded yield and cancellation, not copying its Rust implementation.
- In the reference, the same numeric five-minute value appears as an MCP tool timeout or maximum empty-poll observation window. It is not a blanket deadline that kills the entire agent turn.
- The reported failure contained an MCP `AuthRequired` event at approximately the beginning of the run and a desktop timeout exactly five minutes later. A minimal matching Codex invocation reproduced the authentication warning while still completing successfully, proving those outcomes require separate classification.
- This spec deepens the existing external runner contract. It complements the completed external `continueGoal` work and preserves ADRs that keep Pi Host canonical, external CLI isolated, and retry fail-closed.
