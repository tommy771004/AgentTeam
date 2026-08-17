# 17 — Turn paid-workflow stage evidence into inspectable deliverables

**What to build:** Promote `paidWorkflow.ts`'s `ArtifactEvidence` from internal state to a per-stage deliverable the user can open, review, and reject.

**Blocked by:** None.

**Status:** 可交給代理

The vertical workflows are the moat. The compared harness is deliberately general — not one of its builtin tools is vertical — while this product ships 14 SubDesign tools, the SubDesign and OpenDesign studios, `contentPublishing.ts` multi-platform scheduling, and the `paidWorkflow.ts` Goal → Spec → Tickets → TDD → Review state machine.

But the value of a vertical workflow is its deliverables, not its state machine. `ArtifactEvidence` currently exists as internal state, so a user cannot see what each stage produced or tell which gate they are stuck at.

- [ ] Each workflow stage surfaces its artifact as something the user can open and read.
- [ ] The current stage and the blocking gate are visible at a glance.
- [ ] A user can reject a stage artifact and send the workflow back rather than only forward.
- [ ] A rejection records its reason and is visible in the workflow history.
- [ ] Artifacts are addressable and persist after the run settles.
- [ ] Merge, push, and deploy remain explicitly outside automatic side effects.
- [ ] The surface builds on existing `ArtifactEvidence` state without adding a second workflow store.
- [ ] `npm run smoke:paid-workflow` and `npm run smoke:artifact-index` stay green and cover the reject-and-return transition.

Files: `app/src/agent/paidWorkflow.ts`, artifact index module, workflow UI surface.
