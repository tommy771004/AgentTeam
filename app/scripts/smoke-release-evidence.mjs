import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReleaseEvidence,
  resolveProvenanceSource,
  resolveReleaseVersion,
  verifyArtifactManifest,
} from './release-evidence.mjs'
import {
  customerPublishCredentialReferences,
  packageSuccessQualificationFailureOutcome,
  preQualificationPublicationBarrierErrors,
  remoteUploadRequests,
  workflowJobSource,
} from './release-workflow-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml')
const packagePath = path.join(repoRoot, 'app', 'package.json')
const signingSetupPath = path.join(repoRoot, 'docs', 'RELEASE_SIGNING_SETUP.md')

let passed = 0

async function test(name, fn) {
  await fn()
  console.log(`  ✓ ${name}`)
  passed += 1
}

console.log('Release evidence smoke\n')

await test('release evidence manifest contains artifact hash, SBOM, and provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subagents-release-evidence-'))
  const artifacts = path.join(root, 'artifacts')
  await fs.mkdir(artifacts)
  await fs.writeFile(path.join(artifacts, 'AgentStudio Setup 1.0.0.exe'), 'signed-later')
  await fs.writeFile(path.join(artifacts, 'sbom.cdx.json'), '{"bomFormat":"CycloneDX"}')
  const releaseNotesPath = path.join(root, 'RELEASE_NOTES.md')
  await fs.writeFile(releaseNotesPath, '# Beta release\n\nEvidence pipeline baseline.\n')

  const manifest = await buildReleaseEvidence({
    artifactDir: artifacts,
    outputDir: root,
    platform: 'windows',
    arch: 'x64',
    version: '1.0.0',
    channel: 'beta',
    sbomPath: path.join(artifacts, 'sbom.cdx.json'),
    releaseNotesPath,
    provenance: { workflow: 'release', runId: '123' },
  })

  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.channel, 'beta')
  assert.equal(manifest.platform, 'windows')
  assert.equal(manifest.arch, 'x64')
  assert.equal(manifest.sbom.format, 'CycloneDX')
  assert.equal(await fs.readFile(path.join(root, 'sbom.cdx.json'), 'utf8'), '{"bomFormat":"CycloneDX"}')
  assert.equal(manifest.releaseNotes.path, 'release-notes.md')
  assert.equal(await fs.readFile(path.join(root, 'release-notes.md'), 'utf8'), await fs.readFile(releaseNotesPath, 'utf8'))
  assert.match(
    await fs.readFile(path.join(root, 'checksums.txt'), 'utf8'),
    new RegExp(`${manifest.artifacts[0].sha256}  AgentStudio Setup 1\\.0\\.0\\.exe`),
  )
  assert.equal(manifest.provenance.runId, '123')
  assert.equal(manifest.artifacts.length, 1)
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/)
  assert.equal(manifest.artifacts[0].name, 'AgentStudio Setup 1.0.0.exe')
})

await test('release manifest verification matches exact nested paths and rejects extras', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subagents-release-manifest-'))
  const artifacts = path.join(root, 'artifacts')
  await fs.mkdir(path.join(artifacts, 'AgentStudio.app', 'Contents'), { recursive: true })
  await fs.mkdir(path.join(artifacts, 'backup'), { recursive: true })
  await fs.writeFile(path.join(artifacts, 'AgentStudio.app', 'Contents', 'Info.plist'), 'expected')
  await fs.writeFile(path.join(artifacts, 'backup', 'Info.plist'), 'same basename, different path')
  const sbomPath = path.join(root, 'sbom.cdx.json')
  await fs.writeFile(sbomPath, '{"bomFormat":"CycloneDX"}')
  const releaseNotesPath = path.join(root, 'RELEASE_NOTES.md')
  await fs.writeFile(releaseNotesPath, '# Beta release\n')
  const manifest = await buildReleaseEvidence({
    artifactDir: artifacts,
    outputDir: path.join(root, 'evidence'),
    platform: 'macos',
    arch: 'arm64',
    version: '1.0.0',
    channel: 'beta',
    sbomPath,
    releaseNotesPath,
  })

  await fs.rm(path.join(artifacts, 'AgentStudio.app', 'Contents', 'Info.plist'))
  await assert.rejects(
    verifyArtifactManifest({ manifest, artifactDir: artifacts }),
    /Missing packaged artifact AgentStudio\.app[\\/]Contents[\\/]Info\.plist/,
  )

  await fs.writeFile(path.join(artifacts, 'AgentStudio.app', 'Contents', 'Info.plist'), 'expected')
  await fs.writeFile(path.join(artifacts, 'unexpected.bin'), 'not in manifest')
  await assert.rejects(
    verifyArtifactManifest({ manifest, artifactDir: artifacts }),
    /Unexpected packaged artifact unexpected\.bin/,
  )
})

await test('release provenance labels local and GitHub runs truthfully', () => {
  assert.equal(resolveProvenanceSource({ githubActions: 'true' }), 'github-actions')
  assert.equal(resolveProvenanceSource({ githubActions: 'false' }), 'local')
  assert.equal(resolveProvenanceSource({ githubActions: undefined }), 'local')
})

await test('release workflow requires Windows and macOS packaging evidence', async () => {
  const workflow = await fs.readFile(workflowPath, 'utf8')
  const signingSetup = await fs.readFile(signingSetupPath, 'utf8')
  const packageJob = workflowJobSource(workflow, 'package')
  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /macos-15-intel/)
  assert.match(workflow, /macos-15(?:[^-]|$)/)
  assert.match(workflow, /electron-builder --win/)
  assert.match(workflow, /electron-builder --mac/)
  assert.match(workflow, /release:evidence/)
  assert.match(workflow, /npm run smoke:marketplace/)
  assert.match(workflow, /npm run smoke:recovery/)
  assert.match(workflow, /npm run smoke:update/)
  assert.match(workflow, /UPDATE_EVIDENCE_OUTPUT=release-evidence\/update-rollback-evidence\.json/)
  assert.match(workflow, /build-update-manifest\.mjs/)
  assert.match(workflow, /verify-update-signing-key\.mts/)
  assert.match(workflow, /secrets\.UPDATE_PRIVATE_KEY/)
  assert.match(workflow, /vars\.UPDATE_BASE_URL/)
  assert.deepEqual(customerPublishCredentialReferences(packageJob), [])
  assert.deepEqual(remoteUploadRequests(packageJob), [])
  assert.match(packageJob, /environment: release-signing/)
  assert.match(signingSetup, /release-publishing/)
  assert.doesNotMatch(signingSetup, /secret set UPDATE_PUBLISH_TOKEN --env release-signing/)
  assert.doesNotMatch(signingSetup, /variable set UPDATE_PUBLISH_URL[\s\S]{0,120}--env release-signing/)
  assert.match(signingSetup, /UPDATE_PUBLISH_TOKEN --env release-publishing/)
  assert.match(signingSetup, /UPDATE_PUBLISH_URL[\s\S]{0,120}--env release-publishing/)
  assert.match(signingSetup, /secret delete UPDATE_PUBLISH_TOKEN --env release-signing/)
  assert.match(signingSetup, /variable delete UPDATE_PUBLISH_URL --env release-signing/)
  assert.match(packageJob, /electron-builder --win --x64 --publish never/)
  assert.match(packageJob, /electron-builder --mac --\$\{\{ matrix\.arch \}\} --publish never/)
  assert.match(packageJob, /path: app\/release-evidence/)
  assert.match(packageJob, /path: app\/release/)
  assert.match(workflow, /UPDATE_PLATFORM/)
  assert.match(workflow, /name: Smoke matrix/)
  assert.match(workflow, /extraMetadata\.version/)
  assert.match(workflow, /release-ready:/)
  assert.match(workflow, /release-qualification:/)
  assert.match(workflow, /npm run release:qualification/)
  assert.match(workflow, /needs\.release-qualification\.result == 'success'/)
  assert.match(workflow, /if: needs\.release-gate\.result == 'success'/)
  assert.match(workflow, /needs: \[package, release-gate\]/)
  assert.match(workflow, /Checkout verification tooling/)
  assert.match(workflow, /release-evidence\.mjs --verify-manifest/)
  assert.doesNotMatch(workflow, /path\.basename\(artifact\.name\)/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /tee release-evidence\//)
  assert.match(workflow, /verification\.log/)
  assert.match(workflow, /- name: Write verification log\r?\n\s+if: always\(\)/)
  assert.match(workflow, /- name: Upload verification logs\r?\n\s+if: always\(\)/)
  assert.match(workflow, /path: app\/release-evidence/)
  assert.match(workflow, /- name: Upload packaged artifacts\r?\n\s+if: success\(\)/)
  assert.match(workflow, /secrets\.WINDOWS_CSC_LINK/)
  assert.match(workflow, /secrets\.WINDOWS_CSC_KEY_PASSWORD/)
  assert.match(workflow, /secrets\.MACOS_CSC_LINK/)
  assert.match(workflow, /secrets\.MACOS_CSC_KEY_PASSWORD/)
  assert.match(workflow, /APPLE_ID: \$\{\{ secrets\.APPLE_ID \}\}/)
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ secrets\.APPLE_APP_SPECIFIC_PASSWORD \}\}/)
  assert.match(workflow, /APPLE_TEAM_ID: \$\{\{ secrets\.APPLE_TEAM_ID \}\}/)
  assert.match(workflow, /forceCodeSigning=true/)
  assert.match(workflow, /codesign --verify --deep --strict/)
  assert.match(workflow, /spctl --assess --type execute/)
  assert.match(workflow, /xcrun notarytool submit/)
  assert.match(workflow, /xcrun stapler validate/)
  assert.match(workflow, /environment: release-signing/)
  assert.match(workflow, /WINDOWS_PUBLISHER_THUMBPRINT/)
  assert.match(workflow, /Start-Process/)
  assert.match(workflow, /Get-AuthenticodeSignature/)
  assert.ok(workflow.indexOf('Get-AuthenticodeSignature') < workflow.indexOf('Start-Process -FilePath $installer.FullName'), 'Windows installer must run only after signature verification')
  assert.ok(workflow.indexOf('Verify packaged install lifecycle') > workflow.indexOf('Verify macOS codesign, Gatekeeper, and notarization'), 'packaged lifecycle must run after platform trust gates')
  assert.match(workflow, /Get-Command signtool\.exe/)
  assert.match(workflow, /verify \/pa \/all \/tw/)
  assert.match(workflow, /TimeStamp|timestamp/i)
  assert.match(workflow, /hdiutil attach/)
  assert.match(workflow, /spctl --assess --type open/)
  assert.match(workflow, /mounted_app/)

  const qualificationFailure = packageSuccessQualificationFailureOutcome(workflow)
  assert.deepEqual(qualificationFailure.executedJobs, ['package', 'release-gate', 'release-qualification'])
  assert.deepEqual(qualificationFailure.unsupportedConditions, [])
  assert.deepEqual(qualificationFailure.customerPublishCredentialReferences, [])
  assert.deepEqual(qualificationFailure.remoteUploadRequests, [])
  assert.deepEqual(preQualificationPublicationBarrierErrors(workflow), [])

  const earlyAlternateUpload = workflow.replace(
    '      - name: Generate release evidence',
    "      - name: Illicit early upload\n        run: aws s3 cp release/ s3://customer-channel/ --recursive\n\n      - name: Generate release evidence",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(earlyAlternateUpload).join('\n'),
    /package contains a remote publication mechanism/,
  )

  const earlyNodeUpload = workflow.replace(
    '      - name: Generate release evidence',
    "      - name: Illicit scripted upload\n        run: node scripts/publish-update.mjs\n\n      - name: Generate release evidence",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(earlyNodeUpload).join('\n'),
    /package contains a remote publication mechanism/,
  )

  const earlyPythonUpload = workflow.replace(
    '      - name: Generate release evidence',
    "      - name: Illicit Python upload\n        run: python scripts/deploy.py\n\n      - name: Generate release evidence",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(earlyPythonUpload).join('\n'),
    /package contains a remote publication mechanism/,
  )

  const earlyActionUpload = workflow.replace(
    '      - name: Generate release evidence',
    "      - name: Illicit action upload\n        uses: vendor/customer-channel-publish@v1\n\n      - name: Generate release evidence",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(earlyActionUpload).join('\n'),
    /package contains a remote publication mechanism/,
  )

  const reverseDeclaredUpload = workflow.replace(
    'jobs:\n',
    "jobs:\n  early-publish:\n    needs: package\n    runs-on: ubuntu-latest\n    steps:\n      - name: Illicit reverse-declared upload\n        run: aws s3 cp release/ s3://customer-channel/ --recursive\n\n",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(reverseDeclaredUpload).join('\n'),
    /package success plus qualification failure can issue a customer publication request/,
  )

  const wrappedAlwaysUpload = workflow.replace(
    '  release-ready:\n',
    "  qualification-failure-publish:\n    needs: release-qualification\n    if: ${{ always() }}\n    runs-on: ubuntu-latest\n    steps:\n      - name: Illicit qualification-failure upload\n        run: aws s3 cp release/ s3://customer-channel/ --recursive\n\n  release-ready:\n",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(wrappedAlwaysUpload).join('\n'),
    /package success plus qualification failure can issue a customer publication request/,
  )

  const unsupportedCondition = workflow.replace(
    '  release-ready:\n',
    "  unknown-condition-job:\n    needs: release-qualification\n    if: needs.release-qualification.result != 'success'\n    runs-on: ubuntu-latest\n    steps:\n      - name: Unknown condition\n        run: echo guarded\n\n  release-ready:\n",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(unsupportedCondition).join('\n'),
    /workflow contains an unsupported job condition/,
  )

  const partiallyRecognizedCondition = workflow.replace(
    "if: needs.release-gate.result == 'success' && needs.release-qualification.result == 'success'",
    "if: needs.release-qualification.result == 'success' || always()",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(partiallyRecognizedCondition).join('\n'),
    /workflow contains an unsupported job condition/,
  )

  const unknownFailedJobOutput = workflow.replace(
    '  release-ready:\n',
    "  failed-job-output-publish:\n    needs: release-qualification\n    if: needs.release-qualification.outputs.publish == 'true'\n    runs-on: ubuntu-latest\n    steps:\n      - name: Illicit output-guarded upload\n        run: aws s3 cp release/ s3://customer-channel/ --recursive\n\n  release-ready:\n",
  )
  assert.match(
    preQualificationPublicationBarrierErrors(unknownFailedJobOutput).join('\n'),
    /workflow contains an unsupported job condition/,
  )

  const bypassedQualification = workflow
    .replace('needs: [package, release-gate, release-qualification]', 'needs: [package, release-gate]')
    .replace(
      "if: needs.release-gate.result == 'success' && needs.release-qualification.result == 'success'",
      'if: always()',
    )
  const bypassErrors = preQualificationPublicationBarrierErrors(bypassedQualification).join('\n')
  assert.match(bypassErrors, /release-ready does not depend on release-qualification/)
  assert.match(bypassErrors, /release-ready does not require successful release-qualification/)
  assert.match(workflow, /github\.run_attempt/)
  assert.match(workflow, /actions\/download-artifact@v4/)
  assert.match(workflow, /verified=true/)
  assert.match(workflow, /windows-signature-verification\.json/)
  assert.match(workflow, /codesign-mounted\.log/)
  assert.match(workflow, /gatekeeper-mounted\.log/)
  assert.match(workflow, /stapler-dmg-validate\.log/)
  const packageEnv = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'))
  assert.doesNotMatch(packageEnv, /CSC_|APPLE_|WINDOWS_PUBLISHER/)
  assert.doesNotMatch(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/)
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/) 
})

await test('macOS packaging keeps hardened runtime and notarization enabled', async () => {
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  assert.equal(packageJson.build.mac.hardenedRuntime, true)
  assert.equal(packageJson.build.mac.gatekeeperAssess, true)
  assert.equal(packageJson.build.mac.notarize, true)
})

await test('release version falls back to package version for branch dispatch', () => {
  assert.equal(resolveReleaseVersion({ requested: '', refName: 'feature/release', packageVersion: '1.0.0' }), '1.0.0')
  assert.equal(resolveReleaseVersion({ requested: '', refName: 'v1.2.3', packageVersion: '1.0.0' }), '1.2.3')
  assert.equal(resolveReleaseVersion({ requested: 'v2.0.0-beta.1', refName: 'main', packageVersion: '1.0.0' }), '2.0.0-beta.1')
})

console.log(`\n${passed} release evidence tests passed`)
