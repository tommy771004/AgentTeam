# Paid Beta Release Qualification - current result

Evaluated: 2026-07-19
Owner: release-engineering
Decision: **NO-GO**

The fail-closed qualification is implemented in `app/src/agent/releaseQualification.ts` and is wired into the aggregate `release-qualification` job in `.github/workflows/release.yml`.

Source-level evidence currently passes:

- `npm run smoke:release-qualification`
- `npm run smoke:release`
- `npm run build`
- `npm run smoke`

The release cannot be marked ready from this workspace because no real signed Windows installer or signed/notarized macOS artifact, clean-machine install evidence, first-run task evidence, or aggregate platform evidence bundle is present locally. The qualification therefore remains **NO-GO** and explicitly prevents `release-ready` until the CI evidence bundle contains every P0 criterion.

Recorded warning: `signed-platform-evidence` | owner: `release-engineering` | mitigation: run the signed Windows/macOS matrix, retain its evidence bundles, then rerun aggregate qualification.

Required external evidence before changing this decision:

- Windows 10/11 x64 Authenticode verification, trusted timestamp, install, first task, restart, and uninstall evidence.
- macOS x64 and arm64 codesign, Gatekeeper, notarization/stapling, install, first task, restart, and uninstall evidence.
- Recovery, update/rollback, entitlement, workflow, trust-document, SBOM, checksum, and provenance records aggregated from both platform jobs.
