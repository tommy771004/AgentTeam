---
status: accepted
---

# Run every AI runner against a sanitized workspace

Whenever the effective outbound protection mode is not `off`, SubAgents AI creates a temporary, provider-specific Sanitized Workspace before execution. It preserves project-relative structure and format-specific locations, replaces protected text segments with fixed non-sensitive markers, and includes non-text content only as a deterministically sanitized derivative authorized by policy. The selected builtin or external CLI runner must read only that provider's view, external CLIs receive it as their working directory instead of the real project root, and construction of the view must not modify the original project.
