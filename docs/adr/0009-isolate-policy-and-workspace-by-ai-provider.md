---
status: accepted
---

# Isolate policy and sanitized workspace by AI provider

Each immutable provider connection ID owns an independent JSON Provider Supplemental Policy and receives a separately generated Sanitized Workspace. Its effective Provider Security Profile combines the shared Company Base Policy with only that provider's additive supplement. Provider-specific rules, exclusions, derived files, and caches are not merged or reused across provider connections. Processing one connection at a time lowers runtime and reasoning complexity while preventing an allowance or cached artifact for one connection from becoming visible to another.

Base and supplemental policy files live outside project directories and renderer local storage under Electron main-process control. A deployment may point `SUBAGENTS_OUTBOUND_POLICY_DIR` at a company-managed read-only directory; otherwise main owns the application-data location. Renderer code receives only constrained policy operations and summaries through IPC, never arbitrary policy-file access.

Whenever the effective protection mode is not `off`, a missing applicable policy file is not automatically an execution failure. Main creates a Company Base Policy with the built-in protection baseline when the company file is missing; when a provider supplement is missing, it detects the selected immutable provider ID and creates an empty additive supplement without duplicating base rules. It then composes the effective profile, runs its detectors, and continues with the resulting Sanitized Workspace. A request is blocked only when no valid effective profile can be established or executed, including when a company-managed read-only directory is missing a required file that main cannot create.

Missing and invalid policy files are intentionally different states. Main may establish a safe default for a missing file, but it must preserve an existing malformed file and block only the affected provider's AI request until the user explicitly repairs or rebuilds it. Silently replacing malformed company-specific rules with a less specific baseline would be an unsafe policy downgrade.

## Deferred hardening

Cryptographic signing of Company Base Policy and Provider Supplemental Policy JSON is intentionally deferred from the first implementation. The initial version can verify schema, provider identity, monotonic merge behavior, and enforcement evidence, but cannot claim resistance against a user or administrator who can modify the policy files themselves. A later version may add canonical JSON plus deployment-controlled signature verification without changing the two-layer boundary.
