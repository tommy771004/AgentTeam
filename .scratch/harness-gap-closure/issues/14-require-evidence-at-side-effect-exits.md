# 14 — Require non-model evidence at every side-effect exit

**What to build:** Extend the trigger-evidence requirement from scheduling and proactive execution to every outward side effect.

**Blocked by:** 13 — Write the ADR: a model cannot manufacture its own execution credential.

**Status:** 可交給代理

The unforgeable-evidence guarantee currently protects one class of action — time-based and proactive execution. Every other outward action is protected only by approval flow, which is human-in-the-loop authorisation and does not constrain what happens after authorisation is granted.

Apply the same shape elsewhere: each side-effect exit requires an evidence snapshot produced by a non-model component, unrepresentable without it at the type level and refused again at runtime.

- [ ] `message_send` requires a non-model-generated evidence snapshot.
- [ ] `contentPublishing.ts` publish and schedule actions require one.
- [ ] `paidWorkflow.ts` merge, push, and deploy require one, consistent with the existing rule that they must not become automatic side effects.
- [ ] Each evidence type is structurally unrepresentable without its snapshot, matching the `LoopRequest` pattern.
- [ ] Each exit refuses again at runtime, so a type-system bypass still fails closed.
- [ ] A request carrying model-generated evidence is refused with a clear reason at every exit.
- [ ] Approval mode `full` does not bypass the evidence requirement — it is a separate axis from approval.
- [ ] Unattended runs cannot satisfy an evidence requirement by timing out into a default.
- [ ] Smokes assert, per exit, that adapter-produced evidence is accepted and model-produced evidence is refused.

Files: `app/src/agent/tools/registered/`, `app/src/agent/contentPublishing.ts`, `app/src/agent/paidWorkflow.ts`, `app/src/agent/tools/toolGuard.ts`.
