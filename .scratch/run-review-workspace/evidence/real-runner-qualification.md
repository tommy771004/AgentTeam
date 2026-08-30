# Run Review real-runner qualification

Qualified: 2026-08-30T06:44:02.587Z
Machine: darwin/arm64

| Runner | Status | Safe diagnostic |
|---|---|---|
| builtin | failed | provider=openai-codex; model=gpt-5.6-luna; settlement=failed; proof=false; iterations=1 |
| codex-cli | passed | code=0; terminal=unknown; proof=true |

Prompt/output bodies and credentials are not retained. The Electron test separately proves snapshot reload/restart, A→B immutability, comments, keyboard tabs, large diff paging, and responsive layout.
