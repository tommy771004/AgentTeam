# 04 — Configure a Pi Agent from desktop settings

**What to build:** Allow users to configure a Pi-backed agent through explicit desktop controls and capture an immutable Effective Agent Profile when work is submitted or queued.

**Blocked by:** 02 — Show Pi Core Host health in Electron.

**Status:** resolved

- [x] The Settings Registry renders named, explained, validated controls without exposing raw JSON or internal keys.
- [x] Model, provider, thinking level, active tools, compaction, and role settings persist through Pi Settings.
- [x] Profile precedence is Pi defaults, role profile, then Task run override.
- [x] Active and queued runs retain their submission-time profile while later runs use newly saved settings.
- [x] Settings and profile behavior are verified through the real Pi Host Protocol.

## Answer

Added typed Pi Settings/Profile models, validation and precedence compilation, versioned Host Protocol settings methods, Electron IPC, and an explicit Pi Core settings section. The settings black-box smoke covers defaults, invalid updates, persistence, and role/task precedence; the app build passes.
