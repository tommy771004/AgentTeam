# 05 — 建立安全更新與 N-1→N Migration

**What to build:** Update a signed installation safely while preserving user data and providing a recoverable path when an update fails.

**Blocked by:** 02 — 交付 Windows 簽章與 macOS 公證版本; 04 — 建立 Durable Run Journal 與啟動復原.

**Status:** resolved
- [x] The app discovers signed Beta update metadata over a documented channel.
- [x] Users can defer a non-critical update and see version, release notes, and download progress.
- [x] Downloaded update artifacts are signature/hash verified before installation.
- [x] N-1→N preserves threads, settings, vault metadata, projects, queue, schedules, and Artifact Index data.
- [x] Failed update installation has a tested recovery or rollback path that returns to a launchable version.
- [x] Update and rollback evidence is captured on Windows and macOS.
