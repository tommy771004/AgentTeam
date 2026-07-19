# 02 — 交付 Windows 簽章與 macOS 公證版本

**What to build:** Turn the release artifacts into trusted installable Windows and macOS applications that pass platform verification.

**Blocked by:** 01 — 建立雙平台 Release Evidence Pipeline.

**Status:** X

- [X] Windows installer and installed executable have valid Authenticode signatures, trusted publisher identity, and timestamp.
- [X] macOS application and disk image pass codesign verification, Gatekeeper assessment, notarization, and ticket stapling.
- [X] Signing and notarization credentials are injected only through protected release secrets and never enter artifacts or logs.
- [X] Clean verification commands and their reports are retained with each release.
- [X] Unsigned or unverifiable artifacts cannot be selected as Beta downloads.
