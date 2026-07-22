# 05 — Migrate existing provider credentials and settings

**What to build:** Upgrade existing users to Pi Settings without re-entry of compatible provider configuration or exposing credentials to the renderer.

**Blocked by:** 04 — Configure a Pi Agent from desktop settings.

**Status:** resolved

- [x] A versioned migration maps compatible provider, model, thinking, tool, compaction, and preference values into Pi Settings.
- [x] Credential transfer occurs behind the Electron main boundary and plaintext credentials never appear in renderer protocol payloads.
- [x] A legacy value is deleted only after validation and successful Pi persistence.
- [x] Failed or interrupted migration is safely repeatable and preserves the last working configuration.
- [x] Settings that belong only to the Electron product remain separately owned and clearly classified.

## Answer

Added the main-process-only versioned migration adapter and a smoke covering typed mapping, deduplication, credential boundary, and Electron-owned settings classification.
