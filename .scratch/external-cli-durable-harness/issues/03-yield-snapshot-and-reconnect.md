# 03 — Yield, snapshot, and reconnect long CLI work

**What to build:** Keep a long-running external CLI process alive across bounded observation windows and renderer reconnection, so users continue receiving ordered progress without tying process lifetime to one IPC request or renderer instance.

**Blocked by:** 01 — Expand the External CLI Run Session seam.

**Status:** 可交給代理

- [ ] A bounded observation window may return current output and live session identity without terminating the underlying process.
- [ ] The Host retains stable process identity and any provider thread/session identity emitted by the adapter.
- [ ] Streamed lifecycle events carry a monotonic sequence or cursor scoped to the Task run.
- [ ] The Host exposes an active-session snapshot and events-after-cursor contract that reconstructs the same renderer projection after reload.
- [ ] Snapshot plus replay does not duplicate, reorder, or leak events between Task runs.
- [ ] Output is retained through a bounded head/tail policy with explicit omitted-byte or omitted-token evidence; truncation never implies completion.
- [ ] Interactions with one process session are serialized, while different process sessions can progress independently within existing capacity limits.
- [ ] Process completion observed after an earlier yield emits one terminal lifecycle event and one coordinator settlement.
- [ ] The implementation supervises the external CLI process and does not reimplement the provider's internal tool loop or MCP client.
- [ ] Deterministic yield/reconnect smokes, build, and the complete smoke chain pass.

