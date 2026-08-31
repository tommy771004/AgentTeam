import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const appRoot = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const command = packageJson.scripts['qualify:deterministic'] || ''
const required = [
  'check:build-flavor',
  'check:complexity',
  'check:release-build-once',
  'check:pi-production-owners',
  'check:pi-contract',
  'check:no-retired-provider',
  'check:agent-collaboration-boundary',
  'smoke-pi-external-sources.mts',
  'smoke:security:logic',
  'smoke:settings-persistence',
]

let previous = -1
for (const guard of required) {
  const at = command.indexOf(guard)
  assert.ok(at > previous, `${guard} must be reachable in deterministic qualification order`)
  previous = at
}
assert.doesNotMatch(command, /(?:electron-builder|playwright|smoke:built|smoke:settings-lifecycle|dist:|npm run build(?:\s|$))/, 'deterministic qualification must not compile, package, or launch UI')

for (const name of ['build', 'build:compile', 'dist', 'dist:mac', 'dist:win', 'dist:all']) {
  assert.doesNotMatch(packageJson.scripts[name] || '', /qualify:deterministic/, `${name} remains compile/package only`)
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'deterministic-qualification-'))
try {
  const marker = path.join(temporary, 'electron-launch.jsonl')
  const guard = pathToFileURL(path.join(appRoot, 'scripts/fixtures/no-electron-app-launch-guard.mjs')).href
  const env = { ...process.env }
  for (const key of [
    'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'CSC_LINK', 'CSC_KEY_PASSWORD',
    'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'UPDATE_PRIVATE_KEY', 'UPDATE_PUBLISH_TOKEN',
  ]) delete env[key]
  env.CI = 'true'
  env.DISPLAY = ''
  env.WAYLAND_DISPLAY = ''
  env.SUBAGENTS_NO_APP_LAUNCH_MARKER = marker
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${guard}`].filter(Boolean).join(' ')

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', 'qualify:deterministic'], {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 24 * 1024 * 1024,
  })
  assert.equal(
    result.status,
    0,
    `deterministic qualification failed without display/signing credentials:\n${result.stdout}\n${result.stderr}`,
  )
  assert.equal(fs.existsSync(marker), false, 'deterministic qualification must never attempt an Electron App launch')

  const rejected = spawnSync(npm, ['run', 'qualify:deterministic'], {
    cwd: appRoot,
    env: { ...env, SUBAGENTS_BUILD_FLAVOR: 'invalid-fixture' },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.notEqual(rejected.status, 0, 'a deterministic guard failure must fail the shared command closed')
  assert.match(
    `${rejected.stdout}\n${rejected.stderr}`,
    /SUBAGENTS_BUILD_FLAVOR|build flavor/i,
    'guard failure output identifies the failing contract',
  )
  assert.equal(fs.existsSync(marker), false, 'fail-closed qualification must not launch Electron while reporting failure')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

console.log('deterministic qualification: blocking guard graph passed headlessly without Electron or signing credentials')
