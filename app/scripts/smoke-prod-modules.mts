/**
 * Production-module smoke — import real TS sources (not mirrored logic).
 * Catches drift when smoke.mjs / smoke-caps.mjs re-implementations diverge.
 *
 * Run: node --experimental-strip-types scripts/smoke-prod-modules.mts
 * Via: npm run smoke:ci
 */
import assert from 'node:assert/strict'
import {
  resolveEffectiveProjectRoot,
} from '../src/agent/tools/runContext.ts'
import {
  compileToolPackage,
  effectiveOperationClass,
  packageFingerprint,
  validateToolPackage,
  type ToolPackageManifest,
  type ToolPackageTool,
} from '../src/agent/tools/toolPackage.ts'
import {
  firstExecutablePath,
  isPathInside,
  quoteShellArg,
  shellCommandSpec,
} from '../electron/platformProcess.ts'
import {
  imagePixelCountFromDataUrl,
  isVisionImageTooSmall,
} from '../electron/attachmentStore.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  process.stdout.write(`  · ${name} … `)
  try {
    await fn()
    console.log('ok')
    passed++
  } catch (e) {
    console.log('FAIL')
    console.error(e)
    process.exitCode = 1
  }
}

console.log('Production modules (real TS imports)\n')

await test('runContext resolves explicit project pins without mutable global identity', async () => {
  assert.equal(await resolveEffectiveProjectRoot('  D:/proj/A  '), 'D:/proj/A')
})

await test('toolPackage rejects read+POST', () => {
  const bad = validateToolPackage({
    schemaVersion: 1,
    id: 'demo',
    version: '1.0.0',
    tools: [
      {
        name: 'mutate',
        description: 'bad',
        operationClass: 'read',
        kind: 'http_template',
        template: { url: 'https://example.com/x', method: 'POST' },
      },
    ],
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((e) => /POST|write/i.test(e)))
})

await test('effectiveOperationClass elevates smuggled write method', () => {
  const t: ToolPackageTool = {
    name: 'sneaky',
    description: 'x',
    operationClass: 'read',
    kind: 'http_template',
    template: { url: 'https://example.com', method: 'DELETE' },
  }
  assert.equal(effectiveOperationClass(t), 'write')
  const getOnly: ToolPackageTool = {
    ...t,
    template: { url: 'https://example.com', method: 'GET' },
  }
  assert.equal(effectiveOperationClass(getOnly), 'read')
})

await test('compileToolPackage withholds privileged until review', () => {
  const manifest = validateToolPackage({
    schemaVersion: 1,
    id: 'pkg',
    version: '1.0.0',
    tools: [
      {
        name: 'list',
        description: 'list',
        operationClass: 'read',
        kind: 'http_template',
        template: { url: 'https://example.com/list', method: 'GET' },
      },
      {
        name: 'create',
        description: 'create',
        operationClass: 'write',
        kind: 'http_template',
        template: { url: 'https://example.com/create', method: 'POST' },
      },
    ],
  })
  assert.ok(manifest.ok && manifest.manifest)
  const m = manifest.manifest as ToolPackageManifest
  const unapproved = compileToolPackage(m, 'owner1', null)
  assert.ok(unapproved.needsReview)
  assert.deepEqual(unapproved.withheld, ['create'])
  assert.equal(unapproved.tools.length, 1)
  assert.equal(unapproved.tools[0]?.name, 'list')
  const fp = packageFingerprint(m)
  const approved = compileToolPackage(m, 'owner1', {
    approvedFingerprint: fp,
    approvedAt: new Date().toISOString(),
  })
  assert.equal(approved.needsReview, false)
  assert.equal(approved.withheld.length, 0)
  assert.equal(approved.tools.length, 2)
})

await test('hooks source: deny wins + no allow action + require-approval', () => {
  // hooks.ts uses extensionless relative imports (bundler-style) — cannot
  // strip-type import under plain Node. Assert the production source contract.
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/hooks.ts'), 'utf8')
  assert.match(src, /export function evaluateHooks/)
  assert.match(src, /export function sanitizeHookRules/)
  assert.match(src, /case 'deny'/)
  assert.match(src, /forceAsk:\s*true|forceAsk = true/)
  assert.doesNotMatch(src, /action:\s*['"]allow['"]/)
  assert.match(src, /POINT_ACTIONS/)
  // sanitize must drop unknown actions (allow never in POINT_ACTIONS values)
  assert.match(src, /if \(!POINT_ACTIONS\[point\]\.includes\(action\)\) continue/)
})

await test('platformProcess path + shell helpers', () => {
  if (process.platform === 'win32') {
    assert.equal(isPathInside('C:\\proj', 'C:\\proj\\src\\a.ts'), true)
    assert.equal(isPathInside('C:\\proj', 'C:\\other\\a.ts'), false)
  } else {
    assert.equal(isPathInside('/proj', '/proj/src/a.ts'), true)
    assert.equal(isPathInside('/proj', '/other/a.ts'), false)
  }
  const q = quoteShellArg('hello world')
  assert.ok(q.includes('hello'))
  // firstExecutablePath parses `where` / `command -v` output lines
  const look = firstExecutablePath(
    process.platform === 'win32'
      ? 'C:\\Windows\\System32\\node.exe\r\nC:\\tools\\node'
      : '/usr/local/bin/node\n/usr/bin/node',
  )
  assert.ok(look)
  const spec = shellCommandSpec('echo hi')
  assert.ok(spec.file)
  assert.ok(Array.isArray(spec.args))
})

await test('tiny vision image is detected at the Electron CLI boundary', () => {
  const png = Buffer.alloc(24)
  png.write('\x89PNG\r\n\x1a\n', 0, 'binary')
  png.writeUInt32BE(16, 16)
  png.writeUInt32BE(16, 20)
  const url = `data:image/png;base64,${png.toString('base64')}`
  assert.equal(imagePixelCountFromDataUrl(url), 256)
  assert.equal(isVisionImageTooSmall(url), true)
})

await test('tiny SVG and attachment payloads cannot bypass the CLI image gate', () => {
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg width="16" height="16"></svg>')
  assert.equal(imagePixelCountFromDataUrl(svg), 256)
  assert.equal(isVisionImageTooSmall(svg), true)
  const main = fs.readFileSync(path.join(appRoot, 'electron/main.ts'), 'utf8')
  assert.match(main, /isImagePayload/)
  assert.match(main, /\^data:image/)
})

console.log(`\nproduction modules: ${passed} passed`)
if (process.exitCode) process.exit(process.exitCode)
