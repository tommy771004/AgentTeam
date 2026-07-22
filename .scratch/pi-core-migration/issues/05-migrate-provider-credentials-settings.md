# 05 — Migrate existing provider credentials and settings

**What to build:** Upgrade existing users to Pi Settings without re-entry of compatible provider configuration or exposing credentials to the renderer.

**Blocked by:** 04 — Configure a Pi Agent from desktop settings.

**Status:** 可交給代理

- [ ] A versioned migration maps compatible provider, model, thinking, tool, compaction, and preference values into Pi Settings.
- [ ] Credential transfer occurs behind the Electron main boundary and plaintext credentials never appear in renderer protocol payloads.
- [ ] A legacy value is deleted only after validation and successful Pi persistence.
- [ ] Failed or interrupted migration is safely repeatable and preserves the last working configuration.
- [ ] Settings that belong only to the Electron product remain separately owned and clearly classified.
