---
status: accepted
---

# Sync company and provider policy as one atomic bundle

Workspace policy source returns one versioned Policy Bundle per immutable provider connection ID, containing the matching Company Base Policy and Provider Supplemental Policy. The server validates that the supplement only tightens the base, Electron main independently repeats schema and monotonic-composition validation, and only the complete valid bundle atomically replaces last-known-good cache. Workspace ID, provider ID, bundle version, and ETag prevent cross-tenant, cross-provider, and mixed-version policy use.

Policy consistency follows the effective Outbound Guard mode. A `required` task run pins one validated bundle version at coordinator admission and uses it for every LLM round, CLI execution, tool-result sanitization, and write-back in that run. An active `optional` guard resolves the latest valid policy at each outbound boundary so setting changes apply immediately; each decision records the version it actually used but the run does not claim single-version reproducibility. `off` resolves no policy.
