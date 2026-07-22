# Vendor Pi Core behind the Electron shell

SubAgents AI will maintain a project-owned fork of Pi's four packages (`pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui`) as a Git subtree under `vendor/pi/`, allowing local core changes while retaining an explicit path for upstream synchronization. The Electron/React desktop interface remains the product shell: SubAgents uses the `pi-coding-agent` SDK, session runtime, and extension host, but does not adopt Pi's `pi` CLI or interactive TUI application as a product entry point; `pi-tui` remains available only to terminal-oriented extensions and compatibility surfaces.

This rejects both an opaque published-package dependency, which cannot absorb required core adaptations, and a Git submodule or untracked source copy, which would make builds or upstream reconciliation less reliable.
