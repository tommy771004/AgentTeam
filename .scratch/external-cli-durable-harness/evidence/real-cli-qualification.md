# External CLI real-machine qualification

Qualified: 2026-09-01T09:13:55.086Z
Machine: darwin/arm64

| Provider | Status | Code | Installed | Attempted | Auth usable | Diagnostic | Exit code | Native proof | Checkpoint | Restart | Record |
|---|---|---|---:|---:|---:|---|---:|---|---:|---|---|
| codex | qualified | qualified | yes | yes | yes | unknown | 0 | yes | yes | interrupted | turn-start, step-start, instruction-snapshot, user-text, assistant-text, step-end, turn-end |
| claude | blocked | auth_unavailable | yes | yes | no | auth/login | 1 | no | yes | interrupted | turn-start, step-start, instruction-snapshot, user-text, assistant-text, step-end, turn-end |

The report stores only status/code, provider metadata, safe argv display values, cwd, lifecycle classifications, record metadata, byte counts, hashes, and source summaries. Prompt/output bodies and credentials are excluded.

- claude: auth_unavailable (record)
