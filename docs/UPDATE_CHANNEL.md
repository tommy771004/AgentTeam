# Signed Beta update channel

SubAgents AI discovers Beta metadata from `https://updates.subagents.ai/beta/{platform}/{arch}/manifest.json` (or the `SUBAGENTS_UPDATE_MANIFEST_URL` override; `{platform}` and `{arch}` are replaced at runtime). Release CI generates the channel `manifest.json` with `scripts/build-update-manifest.mjs` from the final signed/notarized installer artifacts, then publishes that manifest and the matching artifact under the same platform/architecture path. The Electron main process accepts only HTTPS, the current `win32`/`darwin` + `x64`/`arm64` target, and a semver greater than the installed version.

The packaged app carries the channel's RSA public verification key. An un-packaged development build may override it with `SUBAGENTS_UPDATE_PUBLIC_KEY` for fixture tests; packaged builds ignore that environment variable. The key is never accepted from the downloaded manifest. Both the manifest payload and the artifact descriptor are verified before an installer is opened:

```json
{
  "schemaVersion": 1,
  "product": "SubAgents AI",
  "channel": "beta",
  "version": "1.1.0-beta.1",
  "platform": "win32",
  "arch": "x64",
  "mandatory": false,
  "releaseNotes": "…",
  "publishedAt": "2026-07-18T00:00:00.000Z",
  "artifact": {
    "url": "https://updates.subagents.ai/beta/win32/x64/SubAgents-AI-1.1.0-beta.1.exe",
    "size": 123456789,
    "sha256": "<64 lowercase hex characters>",
    "signature": "<base64 RSA-SHA256 signature over canonical artifact descriptor>",
    "signatureAlgorithm": "rsa-sha256"
  },
  "signature": "<base64 RSA-SHA256 signature over canonical unsigned manifest>"
}
```

Install is transactional: renderer state is captured as a bounded migration snapshot, the main process writes a backup under the local `userData/updates` directory, and only then opens the verified installer. If the installer fails or is interrupted, the old version detects that the target version was not reached on the next launch and automatically rolls the transaction back; the Settings → 安全更新 → 回復 action remains available for manual recovery. Channel publication is an explicit authenticated CI step; the desktop app never silently installs or pushes an update.

Release CI requires `UPDATE_PRIVATE_KEY`, `UPDATE_BASE_URL`, `UPDATE_PUBLISH_URL`, and `UPDATE_PUBLISH_TOKEN` in the protected release environment. It derives the private key's public half and fails if it does not match the public key compiled into the packaged app; it also uploads the final artifacts and manifest with authenticated HTTPS PUTs. Release CI runs the signed update/migration contract on both Windows and macOS packaging jobs and stores the log with the other release evidence.
