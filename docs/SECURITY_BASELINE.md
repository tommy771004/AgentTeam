# Security Baseline

This document is the checked-in baseline for the Electron runtime and is
validated by `app/scripts/smoke-security.mts`.

## Electron isolation

- Renderer windows use `contextIsolation: true` and `nodeIntegration: false`.
- The main window keeps `sandbox: false` only because the preload bridge uses
  Electron's controlled Node-side IPC surface; renderer code still receives no
  Node globals and all privileged operations are explicit preload methods.
- Child windows and utility processes must not widen renderer privileges.

## Navigation and content

- Production navigation is pinned to the packaged app index and external URLs
  are allowlisted before `openExternal`.
- Production Vite output injects the renderer Content Security Policy.
- IPC handlers validate inputs and do not expose raw credential material.

## Secrets and outbound data

- Secrets are stored through the OS-backed vault when available; plaintext
  persistence is rejected unless an explicit, testable policy permits it.
- Plugin and MCP boundaries disclose credential references only; raw tokens do
  not enter Pi Host extension metadata or renderer state.
- Telegram, Webhook and custom-tool credentials use `credential:*` vault records
  and typed store/rotate/clear intents. Their flat-settings fields are deleted;
  only the one-way migration ingress accepts legacy data. Migration verifies the
  vault before scrubbing the original copy and fails closed without OS encryption.
  Settings hydration, persistence and bundle export never return these secrets.
- Custom-tool HTTP/shell and MCP placeholders resolve in main at execution time.
  Reflected credential values are redacted from results and MCP session metadata;
  changing a custom-tool credential invalidates existing MCP processes.
- LLM/CLI egress passes the outbound data gate and deterministic baseline
  detectors before leaving the local workspace.
