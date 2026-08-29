# External CLI real-machine qualification

Qualified: 2026-08-29T11:37:51.658Z
Machine: darwin/arm64

| Provider | Status | Code | Installed | Attempted | Auth usable | Diagnostic | Exit code | Native proof | Checkpoint | Restart | Record |
|---|---|---|---:|---:|---:|---|---:|---|---:|---|---|
| codex | failed | native_discovery_unproven | yes | yes | yes | unknown | 0 | no | yes | interrupted | turn-start, step-start, instruction-snapshot, user-text, assistant-text, step-end, turn-end |
| claude | blocked | auth_unavailable | yes | no | no | auth/login | - | no | - | - | - |

The report stores only status/code, provider metadata, safe argv display values, cwd, lifecycle classifications, record metadata, byte counts, hashes, and source summaries. Prompt/output bodies and credentials are excluded.

- codex: native_discovery_unproven (record)
- claude: auth_unavailable (auth)
