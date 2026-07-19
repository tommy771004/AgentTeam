# Release signing and notarization

The release workflow only produces Beta candidates from the protected `release-signing` environment. Configure these as GitHub Actions environment secrets; never commit certificates, passwords, Apple credentials, or publisher identifiers to the repository:

- `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` — the Authenticode PFX link/data and password.
- `WINDOWS_PUBLISHER_THUMBPRINT` — the expected trusted publisher certificate thumbprint.
- `MACOS_CSC_LINK` and `MACOS_CSC_KEY_PASSWORD` — the Developer ID Application certificate and password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` — the notarization credentials.
- `UPDATE_PRIVATE_KEY` — the RSA private key used to sign Beta manifests and artifact descriptors. Release CI derives its public key and rejects a mismatch with the packaged trust root.
- `UPDATE_PUBLISH_TOKEN` — a protected bearer token for the channel's authenticated HTTPS PUT endpoint.

Configure these environment variables as protected GitHub Actions variables:

- `UPDATE_BASE_URL` — the public HTTPS channel root (for example, `https://updates.example.com/beta`). CI publishes each target to `/<win32|darwin>/<x64|arm64>/` below this root.
- `UPDATE_PUBLISH_URL` — the authenticated HTTPS PUT root corresponding to the public channel root.

Keep the update private key offline except in the protected release environment. Rotate it by shipping a new application build with the replacement public key first, then replacing the CI private key; never rotate the private key alone because existing packaged versions would reject the new channel signatures.

The workflow scopes these secrets to signing, notarization, and verification steps. electron-builder signs and notarizes the application bundle; the workflow then submits the final DMG, staples it, mounts it, and verifies the app inside it. It fails before packaging when a required value is missing, forces electron-builder signing, installs the Windows NSIS candidate into a temporary directory for a second Authenticode check, and verifies the final mounted macOS disk image after notarization and stapling. The `beta-download-selection` job is a separate protected approval gate; it can run only after `release-ready` verifies all three platform/architecture bundles.

The `CSC_LINK` values may be base64-encoded certificate data or a protected file link supported by electron-builder. Keep release logs free of secret values; certificate subjects and public thumbprints may appear in verification evidence.
