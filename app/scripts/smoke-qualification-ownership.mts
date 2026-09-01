import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  HEAVY_QUALIFICATIONS,
  QUALIFICATION_OWNERSHIP,
  expandQualificationScript,
} from './qualification-ownership.mts'

const root = resolve(import.meta.dirname, '..')
const scripts = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

const duplicateFixture = expandQualificationScript({
  root: 'npm run left && npm run right',
  left: 'node scripts/heavy.mjs',
  right: 'npm run left',
}, 'root')
assert.equal(duplicateFixture.split('scripts/heavy.mjs').length - 1, 2, 'duplicate runtime paths must not be deduplicated')

for (const entry of QUALIFICATION_OWNERSHIP) {
  assert.equal(existsSync(resolve(root, entry.qualification)), true, `${entry.id} owner is missing`)
  assert.ok(['deletion-ownership', 'public-api', 'runtime-behavior'].includes(entry.category))
}

for (const rootGate of ['smoke', 'check']) {
  const body = expandQualificationScript(scripts, rootGate)
  for (const heavy of HEAVY_QUALIFICATIONS) {
    const count = body.split(`scripts/${heavy}`).length - 1
    assert.ok(count <= 1, `${rootGate} unintentionally repeats heavy qualification ${heavy} ${count} times`)
  }
}

assert.equal(new Set(QUALIFICATION_OWNERSHIP.map((entry) => entry.id)).size, QUALIFICATION_OWNERSHIP.length)
console.log('qualification ownership registry classifies guards and keeps heavy gates single-pass')
