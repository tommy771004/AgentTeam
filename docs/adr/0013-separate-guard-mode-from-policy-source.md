---
status: accepted
---

# Separate outbound guard mode from policy source

Outbound protection posture (`off`, `optional`, or `required`) and policy authority (`local` or `workspace`) are independent settings. Local mode reads Electron main-managed company and provider JSON files; workspace mode obtains the same two policy layers from a central company control plane. Both compile to one Provider Security Profile and use the same classification, sanitization, evidence, and write-back pipeline. Deployment policy may lock either setting, and the system never silently changes policy authority through an implicit `auto` mode.

When workspace mode is temporarily offline, Electron main may use the last policy set that synchronized and validated successfully. The UI identifies the cached policy version and offline state, the cache is replaced atomically after a successful resynchronization, and loss of connectivity never changes Policy Source Mode to `local`.

Company Base Policy defines the cached policy's `maxAgeHours` and its explicit `onExpired` behavior: `block` stops only AI egress, `basic` continues with built-in baseline inspection, and `use-stale` continues with the expired last-known-good policy. The default for `required` guard plus `workspace` source is `block`, but the company may deliberately choose another continuity trade-off.

Workspace policy synchronization is always authenticated even though a Company Classification Endpoint may explicitly allow anonymous use. The first implementation may use a bearer credential reference or mTLS resolved by Electron main. Authentication failure never retries anonymously and instead follows the last-known-good cache and expiry policy.
