# 06 — Run the first Pi-backed Chat turn

**What to build:** Let a user submit a composer message, execute one real Pi agent turn in a durable session, observe streamed activity, and receive a final settlement in the existing desktop conversation.

**Blocked by:** 03 — Recover UI Projection after Host restart; 05 — Migrate existing provider credentials and settings.

**Status:** 可交給代理

- [ ] Submitting a message creates a Task run with `runId`, session identity, and immutable Effective Agent Profile.
- [ ] Pi streams assistant messages and structured items through the Host Protocol into the conversation UI.
- [ ] Success, model failure, cancellation, and Host failure produce explicit settlements.
- [ ] The renderer does not call the legacy model transport for the migrated path.
- [ ] The canonical black-box story verifies initialize, session start, turn, streamed items, settlement, and state projection.
