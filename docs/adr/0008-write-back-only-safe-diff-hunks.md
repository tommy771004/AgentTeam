---
status: accepted
---

# Write back only safe diff hunks

AI runners modify only the Sanitized Workspace. SubAgents AI maps their diff back to the original project and applies only changes that do not overlap a Protected Exclusion; overlapping changes are withheld and recorded by source name and format-specific location while independent safe changes continue. Original non-text files remain immutable unless a later format-specific write-back contract is explicitly approved. This avoids replacing original secrets with omission markers while preserving service continuity and useful non-sensitive edits.
