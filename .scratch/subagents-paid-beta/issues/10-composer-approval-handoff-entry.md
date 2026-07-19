# 10 — 在 Composer 加入核准模式與 Handoff 入口

**What to build:** Give users direct per-run control over Approval Mode and a discoverable way to request a local Handoff from the conversation composer.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The composer exposes `要求核准`, `代我核准`, and `完整存取權` with clear descriptions.
- [ ] The selected composer mode overrides the Settings default for only the submitted task run.
- [ ] Plan mode, deny rules, capability-required approval, and unattended downgrade remain stronger constraints.
- [ ] The composer `+` menu exposes a Handoff creation action without auto-sending or uploading.
- [ ] The UI shows whether a Handoff is unavailable because no Artifact Index exists.
- [ ] Per-run approval and Handoff choices remain associated with the correct run and thread.
