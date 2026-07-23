import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { hashPiVendorTree } from './piVendorTree.mts'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const vendorRoot = resolve(repositoryRoot, 'vendor/pi')
const pin = JSON.parse(await readFile(resolve(vendorRoot, 'PI_UPSTREAM_PIN.json'), 'utf8')) as {
  repository?: string
  commit?: string
  tag?: string
  packageVersion?: string
  treeSha256?: string
}
assert.equal(pin.repository, 'https://github.com/earendil-works/pi.git')
assert.match(pin.commit || '', /^[0-9a-f]{40}$/)
assert.equal(pin.tag, 'v0.81.1')
assert.equal(pin.packageVersion, '0.81.1')
assert.match(pin.treeSha256 || '', /^[0-9a-f]{64}$/)

assert.equal(await hashPiVendorTree(vendorRoot), pin.treeSha256, 'vendored Pi tree differs from its recorded synchronization pin')

const ledger = await readFile(resolve(vendorRoot, 'PI_CORE_PATCH_LEDGER.md'), 'utf8')
assert.match(ledger, /Core Patch Ledger/)
assert.match(ledger, /No undocumented core edits/)
assert.match(ledger, /Host Protocol/)
assert.match(ledger, /SessionManager/)

const manifest = JSON.parse(await readFile(resolve(vendorRoot, 'package.json'), 'utf8')) as { version?: string }
assert.equal(manifest.version, '0.0.3')

console.log(`Pi upstream sync gate is pinned to ${pin.tag} (${pin.commit})`)
