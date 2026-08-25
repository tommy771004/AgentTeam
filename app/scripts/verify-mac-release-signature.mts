/**
 * A mac artifact must be what package.json says it is.
 *
 * `mac.hardenedRuntime` / `mac.notarize` / `mac.gatekeeperAssess` declare a
 * distributable, notarized app. electron-builder does NOT fail when it cannot
 * honour that: with no Developer ID identity it logs "skipped macOS
 * application code signing", with no Apple credentials it logs "skipped macOS
 * notarization", and then exits 0. The DMG that falls out is ad-hoc signed,
 * still carries `Identifier=Electron`, and Gatekeeper refuses it on any other
 * machine — a build that reported success handed over an artifact nobody can
 * open.
 *
 * This is the step that says so. It runs after electron-builder and reads the
 * artifact itself rather than the log.
 *
 * A deliberately unsigned local build is legitimate; a silently unsigned
 * release is not. Set ALLOW_UNSIGNED_MAC_BUILD=1 to state that intent — the
 * check then reports the same findings and lets the build pass.
 *
 * Run: node --experimental-strip-types scripts/verify-mac-release-signature.mts
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowUnsigned = process.env.ALLOW_UNSIGNED_MAC_BUILD === '1'

if (process.platform !== 'darwin') {
  console.log('verify-mac-release-signature: not macOS, nothing to verify')
  process.exit(0)
}

const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).build || {}
const mac = config.mac || {}
const claims: string[] = []
if (mac.hardenedRuntime === true) claims.push('hardenedRuntime')
if (mac.notarize === true || (mac.notarize && mac.notarize !== false)) claims.push('notarize')
if (mac.gatekeeperAssess === true) claims.push('gatekeeperAssess')

const releaseDir = path.join(appRoot, 'release')
if (!fs.existsSync(releaseDir)) {
  console.error('verify-mac-release-signature: no release/ directory — run the packaging step first')
  process.exit(1)
}
const apps = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
  .flatMap((entry) => {
    const dir = path.join(releaseDir, entry.name)
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.app'))
      .map((name) => path.join(dir, name))
  })

if (!apps.length) {
  console.error('verify-mac-release-signature: release/ holds no .app bundle to verify')
  process.exit(1)
}

// `codesign -dv` and `spctl -vvv` both report on stderr even when they
// succeed, so both streams are read: taking stdout alone silently produced an
// empty report here, and every check that parsed it passed by accident.
const run = (file: string, args: string[]) => {
  const result = spawnSync(file, args, { encoding: 'utf8' })
  return { ok: result.status === 0, out: `${result.stdout || ''}${result.stderr || ''}` }
}

const problems: string[] = []
for (const app of apps) {
  const rel = path.relative(appRoot, app)
  const details = run('codesign', ['-dv', '--verbose=2', app]).out
  const adhoc = /Signature=adhoc/.test(details) || /\badhoc\b/.test(details)
  const identifier = /^Identifier=(.*)$/m.exec(details)?.[1] || '(none)'
  const expectedId = config.appId || ''

  if (claims.length && adhoc) {
    problems.push(
      `${rel}: ad-hoc signed, but package.json build.mac declares ${claims.join(' + ')}. ` +
        'No Developer ID identity was available, so electron-builder skipped signing and exited 0.',
    )
  }
  if (claims.length && expectedId && identifier !== expectedId) {
    problems.push(
      `${rel}: signed as "${identifier}", expected the configured appId "${expectedId}" — ` +
        'the bundle carries Electron\'s own placeholder identity, not this app\'s.',
    )
  }
  const assess = run('spctl', ['-a', '-vvv', '-t', 'exec', app])
  if (!assess.ok) {
    problems.push(`${rel}: Gatekeeper refuses it — ${assess.out.trim().split('\n').slice(0, 2).join(' / ')}`)
  }
}

if (!problems.length) {
  console.log(`verify-mac-release-signature: ${apps.length} bundle(s) signed and accepted by Gatekeeper`)
  process.exit(0)
}

const heading = allowUnsigned
  ? 'verify-mac-release-signature: UNSIGNED BUILD (ALLOW_UNSIGNED_MAC_BUILD=1)'
  : 'verify-mac-release-signature: NOT DISTRIBUTABLE'
console.error(`\n${heading}`)
for (const problem of problems) console.error(`  · ${problem}`)
if (allowUnsigned) {
  console.error('\n  Allowed because the build declared itself unsigned. Do not publish these artifacts.\n')
  process.exit(0)
}
console.error(
  '\n  To produce a distributable build, set a Developer ID identity plus notarization credentials\n' +
    '  (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER).\n' +
    '  For a local test build, re-run with ALLOW_UNSIGNED_MAC_BUILD=1 to state that intent.\n',
)
process.exit(1)
