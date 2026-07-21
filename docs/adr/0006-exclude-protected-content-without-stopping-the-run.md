---
status: accepted
---

# Exclude protected content without stopping the run

When a valid active policy identifies protected or uncertain content, SubAgents AI removes only the affected segment from the external AI-visible view and continues the run with the remaining safe content. The exclusion record retains only the source name and format-specific location so protected plaintext is not duplicated into logs; current chat input, history messages, and plain-text tool results use virtual source names plus line ranges when no file exists. Images default to whole-file exclusion. Only a policy-authorized Company Classification Endpoint with vision capability may identify image regions, and only a deterministically sanitized derivative may then enter the provider-specific workspace. An invalid mandatory policy still blocks the outbound request because safe baseline exclusion cannot then be established; classifier unavailability alone does not.
