# 25 — Cut over to Electron-only runtime and qualify release

**What to build:** Make Pi Core Host the only production runtime, remove browser/simulation execution, and prove the complete product works and packages through Electron.

**Blocked by:** 22 — Remove legacy Settings, Model, and Session owners; 23 — Remove legacy Tools, Capabilities, and Resource owners; 24 — Remove legacy Orchestration, Automation, and Memory owners.

**Status:** 可交給代理

- [ ] Production contains one settings owner, session owner, tool loop, resource loader, Task run ingress, and Host protocol.
- [ ] Plain browser and simulation runtime paths, flags, docs, and browser-only smoke assumptions are removed.
- [ ] UI development and automated integration tests launch Electron against the real Pi Core Host.
- [ ] Full smoke, build, lint, restart/recovery, update-migration, security, and release qualification pass.
- [ ] Packaged macOS and supported Windows artifacts start the utility process and preserve sessions, extensions, resources, and native dependencies.
