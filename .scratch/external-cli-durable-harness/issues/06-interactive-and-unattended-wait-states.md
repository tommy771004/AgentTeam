# 06 — Model interactive and unattended wait states

**What to build:** Represent waits for user input or approval as explicit External CLI Run Session phases, so interactive work can pause intentionally while unattended work remains bounded and fail-closed.

**Blocked by:** 02 — Let active work survive the five-minute boundary.

**Status:** 可交給代理

- [ ] Provider lifecycle events can transition a run into and out of `waiting_for_user` and `waiting_for_approval` without ending the Task run.
- [ ] Interactive wait phases pause the idle deadline and resume it from a fresh meaningful-activity timestamp when input or approval arrives.
- [ ] The absolute safety cap remains an independent upper bound and cannot be defeated by staying in a wait phase indefinitely.
- [ ] Unattended runs never pause indefinitely and retain the existing bounded auto-denial behavior for approval and safety interventions.
- [ ] User cancellation while waiting terminates the provider process and settles exactly once as cancellation.
- [ ] Waiting phases are visible in the activity projection with an appropriate action or explanation rather than a false running or timeout state.
- [ ] Input or approval is delivered only to the matching Task run and provider session identity.
- [ ] Deterministic tests cover interactive pause/resume, unattended denial, absolute-cap interaction, cancellation while waiting, and cross-run isolation.
- [ ] Focused wait-state smokes, build, and the complete smoke chain pass.

