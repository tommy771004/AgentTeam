# Paid Beta Release Qualification: NO-GO

- Version: unknown
- Evaluated: 2026-08-31T04:00:15.810Z
- Owner: release-engineering
- Criteria: 0/43 passed

## Failed criteria
- windows-signed-x64: Windows signed artifact
- windows-checksum-x64: Windows SHA-256 checksum
- windows-clean-install: Windows clean install
- windows-first-run: Windows first-run CLI doctor and task
- macos-signed: macOS signed/notarized artifact
- macos-checksum: macOS SHA-256 checksum
- macos-clean-install: macOS clean install
- macos-first-run: macOS first-run CLI doctor and task
- recovery-restart: Restart recovery
- recovery-crash: Forced crash recovery
- recovery-queueExactlyOnce: Queue exactly-once
- recovery-schedulerOnceJob: Scheduler once-job
- piHost-protocol: Pi Host protocol
- piHost-utilityProcess: Pi Host utility process
- piHost-sessions: Pi Host session persistence
- piHost-extensions: Pi Host extensions/resources
- update-nMinusOneToN: N-1 to N migration
- update-signatureVerified: Update signature verification
- update-failedRecovery: Failed update recovery
- update-rollback: Update rollback
- entitlement-freeCore: Free Core
- entitlement-activePro: Active Pro
- entitlement-offlineGrace: Offline grace
- entitlement-expired: Expired entitlement
- entitlement-cancelled: Cancelled entitlement
- entitlement-packRollback: Feature-pack rollback
- workflow-spec: Spec
- workflow-tickets: Tickets
- workflow-tdd: TDD
- workflow-review: Review
- workflow-artifactIndex: Artifact Index
- workflow-handoff: Handoff
- workflow-userApprovalBeforeRelease: User approval before release action
- trust-privacy: Privacy
- trust-security: Security
- trust-eula: EULA
- trust-terms: Terms
- trust-refund: Refund
- trust-support: Support
- trust-releaseNotes: Release notes
- trust-checksums: Checksums
- trust-sbom: SBOM
- trust-provenance: Provenance

## Warnings and mitigations
- None

Release remains No-Go. Do not publish or market Paid Beta as ready until every failed criterion has stored evidence.
