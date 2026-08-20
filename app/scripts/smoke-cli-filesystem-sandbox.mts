/**
 * CLI filesystem sandbox builders + probe contracts (ticket 06 platform).
 * Run: node --experimental-strip-types scripts/smoke-cli-filesystem-sandbox.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildBwrapArgs,
  buildSeatbeltProfile,
  verifyCliFilesystemSandbox,
} from '../electron/cliFilesystemSandbox.ts'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    throw e
  }
}

console.log('smoke-cli-filesystem-sandbox')

await test('seatbelt profile mentions view subpath and deny default', () => {
  const p = buildSeatbeltProfile('/tmp/view-abc')
  assert.match(p, /deny default/)
  assert.match(p, /subpath "\/tmp\/view-abc"/)
  assert.match(p, /file-read\*/)
})

await test('bwrap args bind view and use die-with-parent', () => {
  const args = buildBwrapArgs('/tmp/view-xyz', ['/bin/echo', 'hi'])
  assert.ok(args.includes('--bind'))
  assert.ok(args.includes('/tmp/view-xyz'))
  assert.ok(args.includes('--die-with-parent'))
  assert.ok(args.includes('/bin/echo'))
})

await test('verify probe: missing view → unavailable', () => {
  const r = verifyCliFilesystemSandbox({
    viewRoot: path.join(os.tmpdir(), 'no-such-view-' + Date.now()),
    forbiddenCanaryPath: path.join(os.tmpdir(), 'forbid.txt'),
    platform: 'darwin',
  })
  assert.equal(r.status, 'unavailable')
})

await test('verify probe never selects Seatbelt on Windows', () => {
  const view = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-win-view-'))
  try {
    const r = verifyCliFilesystemSandbox({
      viewRoot: view,
      forbiddenCanaryPath: path.join(os.tmpdir(), 'forbid.txt'),
      platform: 'win32',
    })
    assert.equal(r.status, 'unavailable')
    assert.equal(r.engine, 'none')
  } finally {
    fs.rmSync(view, { recursive: true, force: true })
  }
})

await test('verify probe runs on this host when engine exists', () => {
  const view = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-view-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-out-'))
  const forbid = path.join(outside, 'secret.txt')
  fs.writeFileSync(forbid, 'nope\n')
  try {
    const r = verifyCliFilesystemSandbox({
      viewRoot: view,
      forbiddenCanaryPath: forbid,
    })
    // Accept any of the three statuses — documents environment honestly
    assert.ok(['verified', 'unverified', 'unavailable'].includes(r.status), r.detail)
    assert.ok(r.detail.length > 0)
    if (process.platform === 'darwin' || process.platform === 'linux') {
      // engine field set when path taken
      assert.ok(r.engine === 'seatbelt' || r.engine === 'bwrap' || r.engine === 'none')
    }
  } finally {
    fs.rmSync(view, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

await test('platform wiring: IPC channels present in main/preload', () => {
  const root = path.resolve(process.cwd())
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8')
  const cliRun = fs.readFileSync(path.join(root, 'src/agent/localCliRun.ts'), 'utf8')
  const runner = fs.readFileSync(path.join(root, 'electron/localCliRunner.ts'), 'utf8')
  assert.match(main, /cliFilesystemSandbox/)
  assert.match(main, /outbound:sandboxProbe/)
  assert.match(preload, /sandboxProbe/)
  assert.match(preload, /viewMeta/)
  assert.match(preload, /sandboxWrap/)
  assert.match(cliRun, /probeFilesystemSandbox/)
  assert.match(cliRun, /sandboxWrap/)
  assert.match(runner, /wrapCommandInSandbox/)
  assert.match(runner, /sandboxed spawn/)
})

await test('wrapCommandInSandbox produces seatbelt/bwrap argv', async () => {
  const { wrapCommandInSandbox } = await import('../electron/cliFilesystemSandbox.ts')
  const view = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-view-'))
  try {
    const seat = wrapCommandInSandbox({
      engine: 'seatbelt',
      viewRoot: view,
      command: '/usr/bin/codex',
      args: ['exec', 'hi'],
    })
    assert.equal(seat.command, 'sandbox-exec')
    assert.ok(seat.args.includes('-f'))
    assert.ok(seat.args.includes('/usr/bin/codex'))
    assert.ok(seat.profilePath && fs.existsSync(seat.profilePath))
    fs.unlinkSync(seat.profilePath!)

    const bw = wrapCommandInSandbox({
      engine: 'bwrap',
      viewRoot: view,
      command: '/usr/bin/claude',
      args: ['-p', 'x'],
    })
    assert.equal(bw.command, 'bwrap')
    assert.ok(bw.args.includes('--bind'))
    assert.ok(bw.args.includes('/usr/bin/claude'))
  } finally {
    fs.rmSync(view, { recursive: true, force: true })
  }
})

console.log(`\n${passed} tests passed`)
