---
status: accepted
---

# Policy admin is a management build flavor, not a bypass

`SUBAGENTS_BUILD_FLAVOR=policy-admin` compiles company-policy editing, Workspace bundle publishing, and Security Evidence verification surfaces into the application. Standard and policy-admin flavors share one Outbound Data Gate and sanitization core; the admin flavor cannot bypass protection or reveal protected plaintext. This is a packaging distinction rather than a divergent Free/Pro product binary. No runtime administrator login or role check is required: possession of the policy-admin artifact is the management authority, so secure build distribution becomes part of the trust boundary.

Policy-admin does not use a separate application ID, artifact identity, or update channel. It remains the same product identity as standard, and the build flavor alone determines whether management surfaces exist. Consequently the first version does not claim distribution-level separation between standard and policy-admin binaries.

Build flavor defaults to `standard` when `SUBAGENTS_BUILD_FLAVOR` is absent or explicitly `standard`; only the exact value `policy-admin` includes management code, and every other value fails the build. The compiled flavor is immutable at runtime, renderer code can only read the compiled constant, and About/Settings displays it so a management build cannot be mistaken for standard during operation.
