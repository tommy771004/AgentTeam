---
status: accepted
---

# Classify protected data before external provider disclosure

Outbound protection uses a hybrid classifier: explicit organization rules and labels are authoritative, deterministic local detectors provide the mandatory baseline, and an available Company Classification Endpoint may supplement them for unlabelled credentials, personal data, and other configured patterns. The endpoint may only add exclusion locations; it cannot override, remove, or weaken a match from organization policy or deterministic detection. Outbound Guard `required` checks for a configured company endpoint, uses it when available, and falls back to baseline inspection without stopping service when it is absent or unavailable. Candidate content must not be sent to any unapproved classifier. A protected exclusion record persists only the source name and format-specific location, never protected plaintext or a content digest.
