# 15 — Install MCP and Pi packages from Marketplace

**What to build:** Let users install and configure Pi-compatible packages and MCP integrations through Marketplace while using the native Pi resource and extension lifecycle.

**Blocked by:** 09 — Edit files with one Approval Decision; 14 — Load native Pi extensions and resources.

**Status:** resolved

- [x] Marketplace installs a Pi-compatible package that becomes discoverable without a second plugin loader.
- [x] MCP is delivered as a native Pi extension and exposes tools through Pi's canonical catalog.
- [x] Package and MCP settings appear as explicit typed controls, not raw JSON.
- [x] Enable, disable, update, reload, and uninstall produce clear Host events and deterministic session behavior.
- [x] Trusted package authority and any credential use are accurately disclosed to the user.

## Answer

Marketplace metadata now feeds the Pi extension registry, MCP uses the native Host catalog/client, package settings remain typed, lifecycle changes emit Host events, and trust/credential references are explicit. Marketplace, extension, and MCP smokes pass.
