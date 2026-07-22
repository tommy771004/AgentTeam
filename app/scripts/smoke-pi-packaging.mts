import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  build?: { extraResources?: Array<{ from?: string; to?: string }> }
}
const piResource = packageJson.build?.extraResources?.find((resource) => resource.from === '../vendor/pi')
assert.deepEqual(piResource, { from: '../vendor/pi', to: 'vendor/pi' })
console.log('Packaged Electron app includes the vendored Pi Core runtime')
