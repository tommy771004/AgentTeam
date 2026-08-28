# External CLI real-machine qualification

Qualified: 2026-08-28T14:35:54.702Z
Machine: darwin/arm64

| Provider | Installed | Execution | Terminal | Active checkpoint | Restart projection | Record |
|---|---:|---|---|---:|---|---|
| codex | yes | pass | success | yes | interrupted | turn-start, step-start, user-text, assistant-text, step-end, turn-end |
| claude | yes | pass | success | yes | interrupted | turn-start, step-start, user-text, assistant-text, step-end, turn-end |
| grok | yes | blocked-auth | process-exit-failure | yes | interrupted | turn-start, step-start, user-text, assistant-text, step-end, turn-end |
| gemini | no | not installed | - | - | - | - |
| cursor | no | not installed | - | - | - | - |

The report stores only version, lifecycle classifications, event kinds, byte counts, and output hashes. Prompt/output bodies and credentials are excluded.

- grok: Provider CLI authentication is unavailable on this machine.
