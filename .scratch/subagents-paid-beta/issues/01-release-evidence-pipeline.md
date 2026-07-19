# 01 — 建立雙平台 Release Evidence Pipeline

**What to build:** Make every candidate release produce verifiable Windows and macOS packaged artifacts, metadata, and evidence from required CI jobs.

**Blocked by:** None — can start immediately.

**Status:** X

- [X] Required Windows and macOS jobs run locked dependency installation, lint, build, smoke, and native packaging.
- [X] The supported macOS architecture strategy is explicit and exercised by the release matrix.
- [X] Each artifact has SHA-256 checksums, SBOM, provenance metadata, version, channel, and release notes.
- [X] Packaged artifacts and verification logs are retained as immutable CI outputs.
- [X] Release jobs are required; no packaging or marketplace gate is silently optional.
- [X] A failing release evidence job prevents a release from being marked ready.
