# 14 — Require non-model evidence at every side-effect exit

**What to build:** Extend the trigger-evidence requirement from scheduling and proactive execution to every outward side effect.

**Blocked by:** 13 — Write the ADR: a model cannot manufacture its own execution credential.

**Status:** 可交給代理

The unforgeable-evidence guarantee currently protects one class of action — time-based and proactive execution. Every other outward action is protected only by approval flow, which is human-in-the-loop authorisation and does not constrain what happens after authorisation is granted.

Apply the same shape elsewhere: each side-effect exit requires an evidence snapshot produced by a non-model component, unrepresentable without it at the type level and refused again at runtime.

- [x] `message_send` requires a non-model-generated evidence snapshot.
- [x] `contentPublishing.ts` publish and schedule actions require one.
- [x] `paidWorkflow.ts` merge, push, and deploy require one, consistent with the existing rule that they must not become automatic side effects.
- [x] Each evidence type is structurally unrepresentable without its snapshot, matching the `LoopRequest` pattern.
- [x] Each exit refuses again at runtime, so a type-system bypass still fails closed.
- [x] A request carrying model-generated evidence is refused with a clear reason at every exit.
- [x] Approval mode `full` does not bypass the evidence requirement — it is a separate axis from approval.
- [x] Unattended runs cannot satisfy an evidence requirement by timing out into a default.
- [x] Smokes assert, per exit, that adapter-produced evidence is accepted and model-produced evidence is refused.

Files: `app/src/agent/tools/registered/`, `app/src/agent/contentPublishing.ts`, `app/src/agent/paidWorkflow.ts`, `app/src/agent/tools/toolGuard.ts`.

## Comments

**2026-08-17.** The first implementation stamped evidence on the way *out* —
`message_send` minted its own snapshot from `r.ok`, and the publish registry
validated the adapter's snapshot and then discarded it in favour of one it
minted itself, despite not having performed the effect. That inverted the
principle: evidence became a reporting convention rather than a gate.

Now:
- Evidence is issued by the component that performed the effect —
  `gatewaySendMessage` in Electron main, and the platform publishers in
  `contentPublishBridge.ts`. The renderer never mints one.
- `SideEffectOutcome` and `PublishAdapterResult`'s success variant require the
  snapshot at the type level (layer one), and `gateSideEffect` re-validates at
  the exit (layer two).
- `rejectModelSuppliedEvidence` refuses tool arguments naming an evidence field
  with an explicit reason instead of dropping them silently.
- `recordWorkflowDelivery` gates merge/push/deploy on explicit user approval
  *and* adapter evidence, giving `acceptWorkflowDeliveryEvidence` a real caller.
  Approval mode `full` reaches the approval gate only; an unattended timeout
  produces no adapter call and therefore no evidence, so nothing is recorded.

`smoke:side-effect-evidence` asserts accept/refuse per exit (12 groups).
