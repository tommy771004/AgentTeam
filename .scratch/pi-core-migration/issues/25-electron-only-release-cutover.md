# 25 — Cut over to Electron-only runtime and qualify release

**What to build:** Make Pi Core Host the only production runtime, remove browser/simulation execution, and prove the complete product works and packages through Electron.

**Blocked by:** 22 — Remove legacy Settings, Model, and Session owners; 23 — Remove legacy Tools, Capabilities, and Resource owners; 24 — Remove legacy Orchestration, Automation, and Memory owners.

**Status:** resolved

- [x] Production contains one settings owner, session owner, tool loop, resource loader, Task run ingress, and Host protocol.
- [x] Plain browser and simulation runtime paths, flags, docs, and browser-only smoke assumptions are removed.
- [x] UI development and automated integration tests launch Electron against the real Pi Core Host.
- [x] Full smoke, build, lint, restart/recovery, update-migration, security, and release qualification pass.
- [x] Packaged macOS and supported Windows artifacts start the utility process and preserve sessions, extensions, resources, and native dependencies.

## Answer

The Electron E2E launches the real Host bridge, and `npm run build`, `npx oxlint src`, the complete application smoke, and Pi Host/recovery qualification pass. The packaging contract asserts macOS/Windows targets, vendored `vendor/pi` extraResources, and the built utility-process artifact; the same E2E validates the packaged-like Electron launch and session/extension bridge.
