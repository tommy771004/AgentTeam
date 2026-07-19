# 09 — 交付簽章 Subscription Feature Pack

**What to build:** Let an active subscriber download and safely activate a versioned paid workflow pack while keeping the Free Core recoverable.

**Blocked by:** 02 — 交付 Windows 簽章與 macOS 公證版本; 07 — 建立 Free Core Entitlement Boundary; 08 — 完成訂閱、裝置啟用與離線寬限.

**Status:** ready-for-agent

- [ ] A feature-pack manifest declares identity, version, compatibility, permissions, and required entitlement.
- [ ] The app verifies pack signature and hash before installation or activation.
- [ ] An entitlement denial prevents download and activation without breaking the Free Core.
- [ ] Pack installation, update, disable, uninstall, and rollback are supported.
- [ ] A failed or incompatible pack cannot strand the application or make local data unreadable.
- [ ] Pack audit evidence records version and digest without storing raw secrets or full private prompts.
