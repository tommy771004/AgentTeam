# Pin Pi releases and sync upstream through gated PRs

Each SubAgents release pins `vendor/pi` to one reviewed upstream commit and never consumes a moving branch. Upstream changes enter only through dedicated synchronization PRs that reconcile the Core Patch Ledger and pass Pi upstream tests, Pi Host Protocol compatibility, Equivalent Tool parity, session migrations, and Electron smoke coverage before promotion.
